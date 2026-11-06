// Créer une recette d'après des recettes publiées : sources gardées par le code (jamais une adresse
// inventée), vérification d'une proposition (rejets), chiffres calculés en code, bornes de coût, cache de
// la recherche, plafond, et le parcours complet avec un faux client IA (recherche en pause puis reprise).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { eq, inArray } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { aiCalls, equipment, recipeNotes, recipes } from "@/lib/db/schema";
import { setAiClient, WEB_SEARCH_USD, type AiClient, type AiMessage } from "@/lib/ai";
import type { ResolveResponse } from "@/lib/chronocatalog";
import { RecipeInput } from "@/lib/recipes/format";
import { upsertRecipe } from "@/lib/recipes/store";
import { getRecipe } from "@/lib/recipes/queries";
import { householdMembers } from "@/lib/eaters/store";
import { portions } from "@/lib/atelier/verify";
import { toAiRecipe } from "@/lib/atelier/schema";
import {
  budgetRefusal,
  canonicalUrl,
  checkCreation,
  composeProposals,
  CreationRefused,
  estimateComposeUsd,
  estimateCreationUsd,
  estimateRefineUsd,
  estimateResearchUsd,
  keepSources,
  kitchenOf,
  latestCreation,
  LIMITS,
  markSides,
  sourceIds,
  normalizeCreation,
  refineProposal,
  saveCreation,
  startCreation,
  tasteOf,
  type CreationRecipe,
  type ResearchReport,
} from "@/lib/creation";
import { seedTest } from "./helpers";

const offline = async (q: string): Promise<ResolveResponse> => ({ query: q, source: "test", matchedTypes: [], none: null });

const OWNED = ["hob-28", "hob-21", "oven", "poele-28", "cocotte", "casserole-18", "plat-four"];

function freshDb() {
  const { db } = openDb(":memory:");
  seedTest(db);
  db.update(equipment).set({ owned: true }).where(inArray(equipment.id, OWNED)).run();
  process.env.AI_MONTHLY_CAP_USD = "30";
  return db;
}

/** Une proposition correcte : le poulet basquaise des fiches, renommé (la bibliothèque de test est vide). */
function goodRecipe(name = "Poulet aux pois chiches et poivrons fondants"): CreationRecipe {
  const r = RecipeInput.parse(JSON.parse(fs.readFileSync("src/seed/recipes/poulet-basquaise.json", "utf8")));
  return { ...toAiRecipe(r), slug: "poulet-pois-chiches", name };
}

const SOURCES: ResearchReport = {
  sources: [
    { url: "https://www.cuisine.exemple.test/poulet-pois-chiches/", title: "Poulet aux pois chiches", site: "Cuisine exemple", servings: 4, keyIngredients: ["800 g de poulet", "400 g de pois chiches"], technique: "Saisi, puis mijoté.", whyGood: "Une sauce qui nappe.", batch: null },
    { url: "https://blog.exemple.test/curry", title: "Curry de pois chiches", site: "Blog exemple", servings: null, keyIngredients: ["pois chiches", "lait de coco"], technique: "Base d'oignon et d'épices.", whyGood: "Doux et parfumé.", batch: "Se congèle." },
    { url: "https://invente.exemple.test/jamais-vu", title: "Page inventée", site: "?", servings: 4, keyIngredients: [], technique: "?", whyGood: "?", batch: null },
  ],
  notes: "Deux façons : mijoté à la tomate, ou curry.",
};

/** Les résultats que l'API a vraiment renvoyés (les deux premières sources seulement). */
const SEARCH_BLOCKS = [
  { type: "server_tool_use", name: "web_search", input: { query: "poulet pois chiches one pot" } },
  {
    type: "web_search_tool_result",
    content: [
      { type: "web_search_result", url: "https://cuisine.exemple.test/poulet-pois-chiches", title: "Poulet aux pois chiches", page_age: null, encrypted_content: "x" },
      { type: "web_search_result", url: "https://blog.exemple.test/curry?utm_source=x", title: "Curry", encrypted_content: "y" },
    ],
  },
];

const promptOf = (params: Record<string, unknown>) => String((params.messages as { content: string }[])[0].content);

/** Faux client : la recherche part en pause (pause_turn), reprend et rapporte ; la composition rend des recettes. */
function fakeClient(opts: { compose?: (params: Record<string, unknown>) => unknown } = {}) {
  const seen = { create: 0, parse: 0, models: [] as string[], resumed: false };
  const client: AiClient = {
    messages: {
      create: async (params): Promise<AiMessage> => {
        seen.create++;
        seen.models.push(String(params.model));
        const tools = params.tools as { type?: string; name: string; max_uses?: number; strict?: boolean }[];
        // Les recherches déjà faites sont retirées du tour suivant : 3 en tout, pas 3 par tour.
        assert.equal(tools.find((t) => t.name === "web_search")?.max_uses, seen.create === 1 ? LIMITS.searches : 1, "recherches bornées");
        assert.equal(tools.find((t) => t.name === "web_fetch")?.max_uses, LIMITS.fetches, "pages lues bornées");
        assert.equal(tools.find((t) => t.name === "noter_sources")?.strict, true, "rapport par outil strict");
        const msgs = params.messages as { role: string; content: unknown }[];
        if (seen.create === 1) return { usage: { input_tokens: 5000, output_tokens: 300, server_tool_use: { web_search_requests: 2 } }, stop_reason: "pause_turn", content: SEARCH_BLOCKS };
        // Reprise : le tour en pause est renvoyé tel quel, sans message de relance.
        seen.resumed = msgs.length === 2 && msgs[1].role === "assistant";
        return { usage: { input_tokens: 6000, output_tokens: 900 }, stop_reason: "tool_use", content: [{ type: "tool_use", name: "noter_sources", input: SOURCES }] };
      },
      parse: async (params) => {
        seen.parse++;
        seen.models.push(String(params.model));
        return { usage: { input_tokens: 3000, output_tokens: 9000, cache_creation_input_tokens: 7000 }, stop_reason: "end_turn", parsed_output: opts.compose?.(params) ?? (/idée n° 1,/.test(promptOf(params)) ? { recipe: goodRecipe(), pitch: "Des sucs, une sauce qui nappe.", inspiredBy: "s1, s9", changes: ["Pois chiches rôtis à part"] } : { recipe: goodRecipe("Curry doux de pois chiches au poulet"), pitch: "Doux.", inspiredBy: "s2", changes: [] }) };
      },
    },
  };
  return { client, seen };
}

// ─── Pur ───

test("sources : seulement des pages renvoyées par l'API, adresses comparées sans www ni paramètres", () => {
  assert.equal(canonicalUrl("https://www.Site.test/a/b/?x=1#y"), "site.test/a/b");
  assert.equal(canonicalUrl("ftp://site.test/a"), null);
  const seen = [
    { url: "https://cuisine.exemple.test/poulet-pois-chiches", title: "Poulet" },
    { url: "https://blog.exemple.test/curry?utm_source=x", title: "Curry" },
  ];
  const { sources, dropped } = keepSources(SOURCES, seen);
  assert.deepEqual(sources.map((s) => s.id), ["s1", "s2"]);
  assert.equal(sources[0].url, "https://cuisine.exemple.test/poulet-pois-chiches", "l'adresse gardée est celle de l'API");
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].why, /absente/);

  // Résumé court, pas une copie : textes tronqués, 10 ingrédients au plus ; deux pages par site ; réseaux sociaux écartés.
  const long = { ...SOURCES.sources[0], technique: "mot ".repeat(500), keyIngredients: Array.from({ length: 30 }, (_, k) => `ingrédient ${k}`) };
  const many = ["a", "b", "c"].map((p) => ({ ...long, url: `https://cuisine.exemple.test/${p}` }));
  const social = { ...long, url: "https://www.instagram.com/p/xyz" };
  const r = keepSources({ sources: [...many, social], notes: "" }, [...many, social].map((s) => ({ url: s.url, title: null })));
  assert.equal(r.sources.length, 2);
  assert.ok(r.sources[0].technique.length <= 320);
  assert.equal(r.sources[0].keyIngredients.length, 10);
  assert.ok(r.dropped.some((d) => /deux recettes/.test(d.why)));
  assert.ok(r.dropped.some((d) => /réseau social/.test(d.why)));
});

test("coût : bornes et estimation affichée, refus clair près du plafond", () => {
  const research = estimateResearchUsd();
  assert.ok(research >= (LIMITS.searches + 1) * WEB_SEARCH_USD, "les recherches comptent, relance comprise");
  assert.ok(research < 0.06, `recherche ${research}`);
  const full = estimateCreationUsd();
  assert.ok(full > estimateCreationUsd(true), "une recherche en cache ne coûte rien");
  assert.ok(full < 0.3, `création ${full}`);
  assert.ok(estimateRefineUsd() < estimateComposeUsd(2));
  assert.equal(budgetRefusal(1, 10, full), null);
  assert.match(budgetRefusal(9.95, 10, full)!, /il reste 0,05 \$ sur 10,00 \$/);
});

test("vérification : une recette des fiches passe, ses chiffres viennent du code", () => {
  const db = freshDb();
  const household = householdMembers(db);
  const draft = normalizeCreation(goodRecipe());
  assert.equal(draft.kcalUnit, null, "jamais les chiffres de l'IA");
  const p = portions(draft, household);
  const defects = checkCreation(draft, { kitchen: kitchenOf(db), household, coverage: p.coverage });
  assert.deepEqual(defects.filter((d) => d.level === "ko"), []);
  assert.ok(p.people[0].macros.kcal > 300 && p.people[0].macros.protein > 25);
});

test("vérification : rejets (équipement, durées, quantités, service, aliments inconnus)", () => {
  const db = freshDb();
  const household = householdMembers(db);
  const kitchen = kitchenOf(db);
  const check = (mutate: (r: CreationRecipe) => void) => {
    const r = structuredClone(goodRecipe());
    mutate(r);
    const d = normalizeCreation(r, { equipmentIds: new Set(kitchen.map((e) => e.id)) });
    return checkCreation(d, { kitchen, household, coverage: portions(d, household).coverage });
  };
  const ko = (ds: ReturnType<typeof check>, re: RegExp) => assert.ok(ds.some((d) => d.level === "ko" && re.test(d.text)), `attendu ${re} dans ${ds.map((d) => d.text).join(" | ")}`);

  ko(check((r) => (r.steps.find((s) => s.kind === "braise")!.equipmentId = "wok-geant")), /aucun récipient de ta cuisine/);
  ko(check((r) => (r.steps.find((s) => s.kind === "braise")!.durationMin = null)), /sans durée/);
  ko(check((r) => r.steps.push({ ...r.steps[r.steps.length - 1], kind: "bake", equipmentId: "plat-four", ovenTemp: null, durationMin: 20 })), /sans température/);
  ko(check((r) => (r.ingredients[0].grams = r.ingredients[0].grams! * 12)), /par unité|énorme/);
  ko(check((r) => (r.ingredients[0].grams = null)), /Sans quantité/);
  const unknown = check((r) => r.ingredients.push({ lineRaw: "50 g baies de goji", item: "Baies de goji", grams: 50, units: null, group: "A", optional: false, pantry: false, food: "goji_tibet" }));
  assert.ok(unknown.some((d) => d.level === "warn" && /Baies de goji/.test(d.text)), "un aliment inconnu est signalé");

  // Un rôle standard absent de la cuisine, avec une rechange qui y est : gardé, le planificateur fait l'échange.
  const swap = check((r) => {
    const braise = r.steps.find((s) => s.kind === "braise")!;
    braise.equipmentId = "faitout";
    braise.equipmentAlt = ["cocotte"];
  });
  assert.deepEqual(swap.filter((d) => d.topic === "équipement"), []);
  const kept = normalizeCreation({ ...goodRecipe(), steps: goodRecipe().steps.map((s) => (s.kind === "braise" ? { ...s, equipmentId: "faitout", equipmentAlt: ["cocotte"] } : s)) }, { equipmentIds: new Set(kitchen.map((e) => e.id)) });
  assert.equal(kept.steps.find((s) => s.kind === "braise")!.equipmentId, "faitout");
  // Sans rechange, un id inventé tombe et l'étape est refusée (au-dessus) ; l'air fryer cuit sans four.
  const fryer = { id: "air-fryer", kind: "appliance", name: "Air fryer" };
  const roast = (r: CreationRecipe) => r.steps.push({ ...r.steps[r.steps.length - 1], kind: "bake", equipmentId: "air-fryer", equipmentAlt: ["plat-four"], ovenTemp: 190, durationMin: 18, hobLevel: null });
  const r1 = structuredClone(goodRecipe());
  roast(r1);
  const noOven = [...kitchen.filter((e) => e.kind !== "oven"), fryer];
  const d1 = normalizeCreation(r1, { equipmentIds: new Set(noOven.map((e) => e.id)) });
  assert.deepEqual(checkCreation(d1, { kitchen: noOven, household, coverage: 1 }).filter((d) => d.topic === "équipement"), [], "air fryer sans four");
  assert.deepEqual(check(roast).filter((d) => d.topic === "équipement"), [], "air fryer absent : rechange au four");

  // Sans four ni plaque : les étapes de cuisson ne passent plus.
  const bare = kitchen.filter((e) => e.kind !== "oven" && e.kind !== "hob");
  const d = normalizeCreation(goodRecipe());
  assert.ok(checkCreation(d, { kitchen: bare, household, coverage: 1 }).some((x) => x.level === "ko" && /pas de plaque/.test(x.text)));
});

test("garniture à part reconnue par le code, sources citées lues dans une chaîne", () => {
  const withRice = (equipmentId: string) => {
    const r = goodRecipe();
    r.ingredients.push({ lineRaw: "400 g riz basmati", item: "Riz basmati", grams: 400, units: null, group: "R", optional: false, pantry: false, food: "riz_basmati" });
    r.steps.push({ ...r.steps[r.steps.length - 1], kind: "boil", text: "Riz (bol R), 11 min.", equipmentId, equipmentAlt: null, bowls: ["R"], durationMin: 15, activeMin: 2, ovenTemp: null, cue: null, phases: [] });
    return normalizeCreation(r);
  };
  assert.equal(withRice("casserole-16").ingredients.find((i) => i.item === "Riz basmati")?.side, true, "cuit seul dans sa casserole : à part");
  assert.notEqual(withRice("cocotte").ingredients.find((i) => i.item === "Riz basmati")?.side, true, "dans la cocotte du plat : one pot");
  // La fiche d'origine marque son riz « side » à la main ; sans ce champ, le code le retrouve.
  assert.deepEqual(markSides(normalizeCreation(goodRecipe())).ingredients.filter((i) => i.side).map((i) => i.group), ["D"]);
  assert.deepEqual(sourceIds("S1, s3 et [s1] ; pas s123 ni ss2"), ["s1", "s3"]);
});

// ─── Parcours avec un faux client ───

test("création : recherche bornée (pause reprise), sources vérifiées, 2 propositions vérifiées, coût journalisé", async () => {
  const db = freshDb();
  const fake = fakeClient();
  setAiClient(fake.client);
  try {
    const c = await startCreation(db, "Un plat gourmand, protéiné, one pot, avec des pois chiches", { resolve: offline });
    assert.equal(fake.seen.create, 2);
    assert.ok(fake.seen.resumed, "le tour en pause est repris tel quel");
    assert.equal(fake.seen.models[0], "claude-haiku-5-5", "Haiku cherche et résume");
    assert.deepEqual(c.research!.sources.map((s) => s.title), ["Poulet aux pois chiches", "Curry de pois chiches"]);
    assert.equal(c.research!.searches, 2);
    const log = db.select().from(aiCalls).where(eq(aiCalls.screen, "creer-recherche")).get()!;
    assert.ok(log.costUsd >= 2 * WEB_SEARCH_USD, "les recherches sont comptées dans le journal");

    const after = await composeProposals(db, c.id, { resolve: offline });
    assert.equal(fake.seen.models[2], "claude-sonnet-5-5", "Sonnet compose");
    assert.equal(fake.seen.parse, 2, "un appel par proposition (une recette par schéma strict)");
    assert.equal(after.proposals.length, 2);
    assert.deepEqual(after.proposals.map((p) => p.id), ["p1", "p2"]);
    const [p1] = after.proposals;
    assert.deepEqual(p1.inspiredBy, ["s1"], "une source inconnue (s9) est retirée");
    assert.equal(p1.figures.length, 2, "un chiffre par personne du foyer");
    assert.equal(p1.figures[0].name, "Alex");
    assert.ok(p1.figures[0].kcal > 0);
    assert.ok(after.costUsd > log.costUsd, "le coût de la création cumule recherche et composition");
    assert.equal(latestCreation(db)?.id, c.id, "la création se reprend en revenant");
  } finally {
    setAiClient(null);
  }
});

test("cache : la même envie réutilise la recherche, sans appel ni coût", async () => {
  const db = freshDb();
  const fake = fakeClient();
  setAiClient(fake.client);
  try {
    await startCreation(db, "Pois chiches, one pot !", { resolve: offline });
    const again = await startCreation(db, "pois chiches one pot", { resolve: offline });
    assert.equal(fake.seen.create, 2, "pas de nouvelle recherche");
    assert.ok(again.cached);
    assert.equal(again.research!.sources.length, 2);
    assert.equal(db.select().from(aiCalls).all().length, 1);
  } finally {
    setAiClient(null);
  }
});

test("plafond : refus clair avant tout appel", async () => {
  const db = freshDb();
  const fake = fakeClient();
  setAiClient(fake.client);
  process.env.AI_MONTHLY_CAP_USD = "0.05";
  try {
    await assert.rejects(startCreation(db, "un curry de pois chiches", { resolve: offline }), (e: unknown) => e instanceof CreationRefused && /Plafond IA du mois/.test(e.message));
    assert.equal(fake.seen.create, 0);
    assert.equal(db.select().from(aiCalls).all().length, 0);
  } finally {
    process.env.AI_MONTHLY_CAP_USD = "30";
    setAiClient(null);
  }
});

test("défauts : une proposition bancale est montrée avec ses défauts, refusée à l'enregistrement, puis corrigée", async () => {
  const db = freshDb();
  let fixed = false;
  const bad = () => {
    const r = goodRecipe();
    r.steps.find((s) => s.kind === "braise")!.equipmentId = "wok-geant";
    return r;
  };
  const fake = fakeClient({
    compose: (params) => {
      const prompt = promptOf(params);
      if (/Défauts relevés/.test(prompt)) {
        fixed = /aucun récipient/.test(prompt);
        return { recipe: goodRecipe(), changes: ["Cocotte"], answer: "La cocotte à la place." };
      }
      return { recipe: bad(), pitch: "Bon.", inspiredBy: "[s1]", changes: [] };
    },
  });
  setAiClient(fake.client);
  try {
    const c = await startCreation(db, "poulet pois chiches", { resolve: offline });
    const after = await composeProposals(db, c.id, { resolve: offline });
    const p = after.proposals[0];
    assert.ok(p.defects.some((d) => d.level === "ko" && d.topic === "équipement"));
    await assert.rejects(saveCreation(db, c.id, p.id, { resolve: offline }), /À corriger avant d'enregistrer/);
    assert.equal(db.select().from(recipes).all().length, 0, "rien n'entre dans la bibliothèque");

    const corrected = await refineProposal(db, c.id, p.id, { ask: "", fix: true }, { resolve: offline });
    assert.ok(fixed, "les défauts relevés par le code partent dans la demande");
    const q = corrected.proposals[0];
    assert.deepEqual(q.defects.filter((d) => d.level === "ko"), []);
    assert.deepEqual(q.inspiredBy, ["s1"], "les sources restent");
    assert.equal(q.asks[0].ask, "Corriger les défauts");

    const { slug } = await saveCreation(db, c.id, q.id, { resolve: offline });
    const saved = getRecipe(db, slug)!.recipe;
    assert.equal(saved.status, "to_try");
    assert.ok(saved.tags.includes("atelier"));
    assert.match(saved.source ?? "", /inspirée de : « Poulet aux pois chiches » \(Cuisine exemple, https:\/\/cuisine\.exemple\.test\/poulet-pois-chiches\)/);
    assert.equal(saved.kcalUnit != null && saved.kcalUnit > 0, true, "nutrition calculée à l'enregistrement");
    // Deux fois la même : la seconde est déjà enregistrée, pas de doublon.
    const again = await saveCreation(db, c.id, q.id, { resolve: offline });
    assert.equal(again.slug, slug);
  } finally {
    setAiClient(null);
  }
});

test("doublon : une proposition trop proche de la bibliothèque est bloquée", async () => {
  const db = freshDb();
  upsertRecipe(db, RecipeInput.parse(JSON.parse(fs.readFileSync("src/seed/recipes/poulet-basquaise.json", "utf8"))));
  const fake = fakeClient({ compose: () => ({ recipe: goodRecipe("Poulet basquaise"), pitch: "", inspiredBy: "", changes: [] }) });
  setAiClient(fake.client);
  try {
    const c = await startCreation(db, "poulet basquaise", { resolve: offline });
    const after = await composeProposals(db, c.id, { resolve: offline });
    assert.ok(after.proposals[0].defects.some((d) => d.level === "ko" && d.topic === "bibliothèque"));
  } finally {
    setAiClient(null);
  }
});

test("goûts : plats aimés et retours de goût notés sur les fiches", () => {
  const db = freshDb();
  const { id } = upsertRecipe(db, RecipeInput.parse({ ...JSON.parse(fs.readFileSync("src/seed/recipes/poulet-basquaise.json", "utf8")), status: "liked" }));
  db.insert(recipeNotes).values({ id: "n1", recipeId: id, personId: "sam", category: "taste", text: "Un peu trop dense, plus de sauce", rating: 3 }).run();
  const t = tasteOf(db);
  assert.ok(t.liked.length >= 1);
  assert.deepEqual(t.feedback[0], { recipe: t.feedback[0].recipe, who: "Sam", rating: 3, text: "Un peu trop dense, plus de sauce" });
});

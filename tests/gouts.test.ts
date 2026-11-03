// Goûts et variantes réelles (src/lib/feedback) : retours de chacun, marques de la Semaine, remplacements
// d'ingrédients et leur nutrition, ajustements en code (bornes de protéines), variante enregistrée, API.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { cookSessions, mealBoxes, recipes, reserves } from "@/lib/db/schema";
import { RecipeInput } from "@/lib/recipes/format";
import { upsertRecipe } from "@/lib/recipes/store";
import { computeNutrition } from "@/lib/nutrition/compute";
import { portionOf, type Member } from "@/lib/eaters/core";
import { compactLine, feedbackLine, issuesOf, latestByPerson, MEH_PENALTY, tasteBadge, tasteMarks, tastePenalty, tasteRank, type Feedback } from "@/lib/feedback/core";
import { canSwap, rescaleGroups, replaceWords, swapOptions, swapRecipe, swapRows } from "@/lib/feedback/swap";
import { adjustRecipe, MEAT_FACTOR, SAUCE_FACTOR, variantNaming } from "@/lib/feedback/adjust";
import { adjustmentFor, recordSwap, saveAdjustedVariant, saveFeedback } from "@/lib/feedback/store";
import { loadTasteMarks, recipeTasteLine } from "@/lib/feedback/read";
import { calcModel, eatPortion, saveReserve } from "@/lib/reserve/store";
import { splitGroups } from "@/lib/reserve/core";
import { estimatedReserve } from "@/lib/reserve/batch";
import { adjustOptions } from "@/lib/atelier/options";
import { appApi, type AppRequest } from "@/lib/app-api/core";
import { ensureLink } from "@/lib/health/link";
import { propose, swap as swapWeek, type SlotIn, type WeekRecipe } from "@/lib/week/propose";
import { seedTest } from "./helpers";

const PAPRIKA = "poulet-paprika-fume-patates-douces";
const VARIANT = "poulet-paprika-fume-pommes-de-terre";
const recipeFile = (slug: string) => RecipeInput.parse(JSON.parse(fs.readFileSync(`src/seed/recipes/${slug}.json`, "utf8")));
const fb = (personId: string, name: string, rating: Feedback["rating"], tags: Feedback["tags"], at: string, recipeId = "r1"): Feedback => ({ id: `${personId}-${at}`, recipeId, personId, name, rating, tags, note: null, at });
const perUnit = (r: RecipeInput) => computeNutrition(r.ingredients.filter((i) => !i.optional).map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })), r.servingsUnits).perUnit;

// ─── Retours de goût (pur) ───

test("goûts : le dernier retour de chacun compte, ses étiquettes à corriger, en une ligne", () => {
  const list = [fb("sam", "Sam", "ok", [], "2026-11-01T12:00:00Z"), fb("sam", "Sam", "meh", ["sec", "dense"], "2026-11-02T12:00:00Z"), fb("alex", "Alex", "love", ["referais", "sec"], "2026-11-02T13:00:00Z")];
  const latest = latestByPerson(list);
  assert.deepEqual(latest.map((f) => [f.personId, f.rating]), [["alex", "love"], ["sam", "meh"]]);
  assert.equal(feedbackLine(latest[1]), "Sam : bof · sec, trop dense");
  // « J'adore » ne demande rien : seules les étiquettes des autres retours comptent.
  assert.deepEqual(issuesOf(latest), ["sec", "dense"]);
  assert.equal(compactLine(latest), "Alex j’adore (je referais, sec) ; Sam bof (sec, trop dense)");
});

test("goûts : un « bof » pousse en fin de liste tant qu'aucune variante n'est née après lui", () => {
  const rs = [
    { id: "r1", slug: "paprika", name: "Paprika", parentId: null, createdAt: "2026-10-01T00:00:00Z" },
    { id: "r2", slug: "paprika-vieille", name: "Paprika (ancienne)", parentId: "r1", createdAt: "2026-10-15T00:00:00Z" },
    { id: "r3", slug: "teriyaki", name: "Teriyaki", parentId: null, createdAt: "2026-10-01T00:00:00Z" },
  ];
  const meh = fb("sam", "Sam", "meh", ["sec"], "2026-11-02T12:00:00Z");
  const love = fb("alex", "Alex", "love", ["referais"], "2026-11-02T12:00:00Z", "r3");
  let marks = tasteMarks(rs, [meh, love]);
  const m = marks.get("paprika")!;
  assert.deepEqual([m.meh, m.issues, m.adjusted], [["Sam"], ["sec"], null]);
  assert.deepEqual(tasteBadge(m), { tone: "warn", text: "Sam : bof (sec)" });
  assert.equal(tastePenalty(m), MEH_PENALTY);
  assert.equal(tasteRank(m), 2);
  assert.deepEqual(tasteBadge(marks.get("teriyaki")), { tone: "ok", text: "Alex adore" });
  assert.ok(tastePenalty(marks.get("teriyaki")) < 0 && tasteRank(marks.get("teriyaki")) < 0);
  assert.equal(marks.get("paprika-vieille"), undefined);
  // Une variante née après le « bof » : c'est l'ajustement ; une variante archivée ne compte pas.
  marks = tasteMarks([...rs, { id: "r4", slug: "paprika-pdt", name: "Paprika PDT", parentId: "r1", createdAt: "2026-11-03T00:00:00Z", status: "archived" }], [meh]);
  assert.equal(marks.get("paprika")!.adjusted, null);
  marks = tasteMarks([...rs, { id: "r4", slug: "paprika-pdt", name: "Paprika PDT", parentId: "r1", createdAt: "2026-11-03T00:00:00Z" }], [meh]);
  assert.deepEqual(marks.get("paprika")!.adjusted, { slug: "paprika-pdt", name: "Paprika PDT" });
  assert.equal(tasteBadge(marks.get("paprika"))!.tone, "info");
});

// ─── Remplacements (pur) ───

test("remplacement : même famille seulement, poids pour poids, texte de la fiche suivi", () => {
  assert.ok(swapOptions("patate_douce").some((o) => o.food === "pomme_de_terre"));
  assert.ok(!swapOptions("patate_douce").some((o) => o.food === "filet_poulet"));
  assert.ok(canSwap("patate_douce", "pomme_de_terre"));
  assert.ok(!canSwap("patate_douce", "skyr") && !canSwap("patate_douce", "patate_douce") && !canSwap("zero", "pomme_de_terre"));
  assert.equal(replaceWords("Patates douces caramélisées, une patate douce", "patate_douce", "pomme_de_terre"), "Pommes de terre caramélisées, une pomme de terre");
  const r = recipeFile(PAPRIKA);
  const k = r.ingredients.findIndex((i) => i.food === "patate_douce");
  const s = swapRecipe(r, [{ position: k, toFood: "pomme_de_terre" }]);
  assert.equal(s.ingredients[k].food, "pomme_de_terre");
  assert.equal(s.ingredients[k].grams, r.ingredients[k].grams);
  assert.equal(s.ingredients[k].lineRaw, "1 kg pommes de terre");
  assert.equal(s.name, "Poulet au paprika fumé, pommes de terre rôties et riz");
  assert.ok(s.steps[1].text.startsWith("Pommes de terre (bol A)"), s.steps[1].text);
  assert.ok(s.ingredients.find((i) => i.food === "huile")!.item.includes("pour les pommes de terre"));
  // La nutrition suit la table : la pomme de terre est un peu moins calorique que la patate douce.
  assert.ok(perUnit(s).kcal < perUnit(r).kcal);
  // Un remplacement hors famille est ignoré.
  assert.deepEqual(swapRecipe(r, [{ position: k, toFood: "skyr" }]).ingredients[k], r.ingredients[k]);
  const rows = swapRows([{ position: 0, foodId: "patate_douce", item: "Patates douces" }, { position: 1, foodId: "riz_basmati", item: "Riz" }], [{ position: 0, toFood: "pomme_de_terre" }]);
  assert.deepEqual(rows.map((x) => x.foodId), ["pomme_de_terre", "riz_basmati"]);
});

test("remplacement : une réserve pesée garde ses grammes, ses kcal par gramme suivent", () => {
  const groups = [
    { key: "plat", kcalG: 1.4, proteinG: 0.12 },
    { key: "riz", kcalG: 1.3, proteinG: 0.03 },
  ];
  const out = rescaleGroups(groups, [{ key: "plat", kcal: 2000, protein: 200 }, { key: "riz", kcal: 1400, protein: 30 }], [{ key: "plat", kcal: 1900, protein: 204 }, { key: "riz", kcal: 1400, protein: 30 }]);
  assert.equal(out[0].kcalG, 1.4 * 0.95);
  assert.equal(out[0].proteinG, 0.12 * 1.02);
  assert.deepEqual(out[1], groups[1]);
});

// ─── Ajustements (pur) ───

const withRef = (proteinMin: number): Member[] => [{ id: "alex", name: "Alex", units: 5, ref: { kcalMin: 650, kcalMax: 750, proteinMin, proteinMax: proteinMin + 15 } }];

test("ajuster : « sec » → plus de sauce, servie dans la portion ; « trop dense » → moins de viande, des légumes", () => {
  const r = recipeFile(PAPRIKA);
  const a = adjustRecipe(r, ["sec", "dense"], withRef(30));
  const skyr = a.recipe.ingredients.find((i) => i.food === "skyr")!;
  assert.equal(skyr.grams, 200 * SAUCE_FACTOR);
  assert.equal(skyr.lineRaw, "300 g skyr nature");
  const chicken = a.recipe.ingredients.find((i) => i.food === "filet_poulet")!;
  assert.equal(chicken.grams, 1000); // 1 200 × 0,85, au 50 g près
  // Pas de légume dans la fiche : des poivrons, rôtis avec les patates douces (bol A).
  const pepper = a.recipe.ingredients.find((i) => i.food === "poivron")!;
  assert.equal(pepper.group, "A");
  assert.match(a.recipe.steps[0].text, /Bol A : ajoute les poivrons/);
  assert.ok(a.notes.some((n) => n.startsWith("La sauce au skyr est pesée dans chaque portion")));
  assert.ok(a.recipe.tips!.includes("dans un petit pot par boîte"));
  // L'original ne bouge pas.
  assert.equal(r.ingredients.find((i) => i.food === "skyr")!.grams, 200);
  // Aperçu : la part d'Alex reste dans son repère de kcal, ses protéines au-dessus du bas.
  const p = a.preview[0];
  assert.ok(p.after.kcal! >= 600 && p.after.kcal! <= 800, JSON.stringify(p));
  assert.ok(p.after.protein! <= p.before.protein! && p.after.protein! >= 30, JSON.stringify(p));
  assert.equal(variantNaming(r, a.recipe, a).name, `${r.name} (plus moelleuse)`);
});

test("ajuster : la viande ne descend jamais sous le bas de protéines de quelqu'un qui l'atteignait", () => {
  const r = recipeFile(PAPRIKA);
  const before = portionOf({ baseUnits: 5, ref: withRef(0)[0].ref }, { kcalUnit: perUnit(r).kcal, proteinUnit: perUnit(r).protein });
  // Le bas du repère juste sous la part d'aujourd'hui : × 0,85 le ferait passer dessous.
  const tight = withRef(before.protein! - 1);
  const a = adjustRecipe(r, ["dense"], tight);
  const chicken = a.recipe.ingredients.find((i) => i.food === "filet_poulet")!.grams!;
  assert.ok(chicken > 1200 * MEAT_FACTOR, String(chicken));
  assert.ok(a.preview[0].after.protein! >= tight[0].ref!.proteinMin, JSON.stringify(a.preview));
  // Quelqu'un déjà sous son bas : la règle s'applique quand même (elle ne l'aggrave pas au-delà du facteur).
  const low = adjustRecipe(r, ["dense"], withRef(200));
  assert.equal(low.recipe.ingredients.find((i) => i.food === "filet_poulet")!.grams, 1000);
});

test("ajuster : gras, fade, épicé, portion ; rien à faire sans étiquette", () => {
  const r = recipeFile(PAPRIKA);
  const g = adjustRecipe(r, ["gras"], withRef(30));
  assert.equal(g.recipe.ingredients.find((i) => i.food === "huile")!.grams, 28);
  const f = adjustRecipe(r, ["fade"], withRef(30));
  assert.ok(f.recipe.ingredients.some((i) => i.food === "citron"));
  const p = adjustRecipe(r, ["portion"], withRef(30));
  assert.deepEqual(p.changes, []);
  assert.equal(p.notes.length, 1);
  assert.ok(adjustRecipe(r, [], withRef(30)).empty);
  assert.ok(adjustRecipe(r, ["referais"], withRef(30)).empty);
  // Remplacement seul : la variante « aux pommes de terre ».
  const k = r.ingredients.findIndex((i) => i.food === "patate_douce");
  const s = adjustRecipe(r, [], withRef(30), [{ position: k, toFood: "pomme_de_terre" }]);
  assert.deepEqual(variantNaming(r, s.recipe, s), { name: "Poulet au paprika fumé, pommes de terre rôties et riz", slug: "aux-pommes-de-terre" });
});

test("atelier : l'option « D'après les retours » passe les retours à l'IA, en tête si quelqu'un dit bof", () => {
  const r = recipeFile(PAPRIKA);
  const opts = adjustOptions(r, withRef(30), { line: "Sam bof (sec, trop dense)", meh: true });
  assert.equal(opts[0].id, "retours");
  assert.ok(opts[0].recommended);
  assert.match(opts[0].instruction, /Sam bof \(sec, trop dense\)/);
  assert.ok(!adjustOptions(r, withRef(30)).some((o) => o.id === "retours"));
});

// ─── La Semaine (pur) ───

const lib: WeekRecipe[] = ["a", "b", "c", "d", "e"].map((slug) => ({
  slug,
  id: slug,
  parentId: slug === "e" ? "a" : null,
  name: slug,
  tags: [],
  fridgeDays: 4,
  freezerOk: true,
  servingsUnits: 30,
  kcalUnit: 140,
  proteinUnit: 11,
  status: "liked",
  steps: [{ kind: "prep", durationMin: 15, activeMin: 15, equipmentId: null, ovenTemp: null }],
}));
const slots: SlotIn[] = [];
for (let day = 0; day < 7; day++) for (const meal of ["lunch", "dinner"] as const) for (const personId of ["alex", "sam"]) slots.push({ day, meal, personId, place: "home", portionUnits: personId === "alex" ? 5 : 4 });

test("semaine : un « bof » n'est plus proposé d'office, une recette et sa variante jamais ensemble", () => {
  const base = propose(lib, slots)!;
  for (const p of [base]) assert.ok(!(p.slugs.includes("a") && p.slugs.includes("e")), p.slugs.join());
  const meh = base.slugs[0];
  const p = propose(lib, slots, { taste: new Map([[meh, MEH_PENALTY]]) })!;
  assert.ok(!p.slugs.includes(meh), p.slugs.join());
  // Garder l'originale : sa variante n'est pas ajoutée ; échanger : jamais la sœur d'une recette gardée.
  const kept = propose(lib, slots, { keep: ["a"] })!;
  assert.ok(!kept.slugs.includes("e"));
  const s = swapWeek(lib, slots, ["a", "b"], "b", ["c", "d"]);
  assert.equal(s, null);
});

// ─── En base ───

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const root = upsertRecipe(db, JSON.parse(fs.readFileSync(`src/seed/recipes/${PAPRIKA}.json`, "utf8")));
  const plan = { version: 1, recipes: [{ slug: PAPRIKA, name: "Paprika", color: "x", scale: 1 }] };
  db.insert(cookSessions).values({ id: "S", planJson: plan, status: "done", startedAt: "2026-11-01T14:00:00Z", endedAt: "2026-11-01T17:00:00Z" }).run();
  return { db, rootId: root.id };
}
const NOW = new Date("2026-11-02T12:30:00Z");

test("en base : la variante du dépôt se rattache à l'originale (variantOf)", () => {
  const { db, rootId } = setup();
  const v = upsertRecipe(db, JSON.parse(fs.readFileSync(`src/seed/recipes/${VARIANT}.json`, "utf8")));
  assert.equal(db.select().from(recipes).where(eq(recipes.id, v.id)).get()!.parentId, rootId);
  // Plus de sauce et de légumes, un peu moins de poulet : toujours protéinée.
  const a = recipeFile(PAPRIKA);
  const b = recipeFile(VARIANT);
  const g = (r: RecipeInput, food: string) => r.ingredients.filter((i) => i.food === food).reduce((s, i) => s + (i.grams ?? 0), 0);
  assert.ok(g(b, "skyr") >= 2 * g(a, "skyr") && g(b, "filet_poulet") < g(a, "filet_poulet") && g(b, "poivron") > 0 && g(b, "patate_douce") === 0);
  const nb = perUnit(b);
  assert.ok((nb.protein * 4) / nb.kcal >= 0.28, `${nb.protein} g pour ${nb.kcal} kcal`);
});

test("en base : la sauce au skyr est dans la portion servie de chacun (originale et variante)", () => {
  const { db } = setup();
  upsertRecipe(db, JSON.parse(fs.readFileSync(`src/seed/recipes/${VARIANT}.json`, "utf8")));
  for (const slug of [PAPRIKA, VARIANT]) {
    const m = calcModel(db, slug, { cookedOn: "2026-11-01" }, NOW)!;
    assert.deepEqual(m.groups.map((x) => x.key), ["plat", "riz", "sauce-au-skyr"], slug);
    const { groups, counts } = estimatedReserve(m, NOW.toISOString());
    const split = splitGroups(groups, Object.fromEntries(groups.map((x) => [x.key, x.g])), m.people, counts);
    for (const p of m.people) assert.ok((split.portions[p.id]?.grams["sauce-au-skyr"] ?? 0) >= 20, `${slug} ${p.id} ${JSON.stringify(split.portions[p.id])}`);
  }
});

test("en base : retour après « J'ai mangé », marques de la Semaine, variante ajustée enregistrée", () => {
  const { db, rootId } = setup();
  saveReserve(db, "S", rootId, { weights: { plat: 1800, riz: 1000, "sauce-au-skyr": 220 }, counts: { alex: 3, sam: 3 } }, new Date("2026-11-01T18:00:00Z"));
  const reserveId = db.select().from(reserves).get()!.id;
  const s = eatPortion(db, reserveId, "sam", {}, NOW);
  // La recette se déduit de la portion ; une portion d'un autre est refusée.
  assert.throws(() => saveFeedback(db, { personId: "alex", servingId: s.id, rating: "ok" }), /pas la tienne/);
  assert.throws(() => saveFeedback(db, { personId: "sam", recipeId: rootId, rating: "nul" as "ok" }), /j’adore, ok ou bof/);
  const f = saveFeedback(db, { personId: "sam", servingId: s.id, rating: "meh", tags: ["sec", "dense"], note: "la sauce oubliée au frigo" }, NOW);
  assert.equal(f.recipeId, rootId);
  saveFeedback(db, { personId: "alex", recipeId: rootId, rating: "love", tags: ["referais"] }, new Date("2026-11-02T13:00:00Z"));
  assert.deepEqual(recipeTasteLine(db, PAPRIKA), { line: "Alex j’adore (je referais) ; Sam bof (sec, trop dense, « la sauce oubliée au frigo »)", meh: true });
  assert.deepEqual(loadTasteMarks(db).get(PAPRIKA)!.meh, ["Sam"]);

  // Patate douce → pomme de terre, noté après coup : rattaché à la réserve ouverte, sa nutrition suit.
  const k = recipeFile(PAPRIKA).ingredients.findIndex((i) => i.food === "patate_douce");
  const before = db.select().from(reserves).get()!;
  const sw = recordSwap(db, { recipeId: rootId, position: k, toFood: "pomme_de_terre" }, NOW);
  assert.equal(sw.where, "reserve");
  assert.throws(() => recordSwap(db, { recipeId: rootId, position: k, toFood: "filet_poulet" }, NOW), /même famille/);
  const after = db.select().from(reserves).get()!;
  const plat = (r: typeof after) => r.groups.find((g) => g.key === "plat")!;
  assert.equal(plat(after).g, plat(before).g);
  assert.ok(plat(after).kcalG! < plat(before).kcalG!);
  assert.deepEqual(after.groups.find((g) => g.key === "riz"), before.groups.find((g) => g.key === "riz"));
  assert.ok(after.kcalUnit! < before.kcalUnit!);
  assert.equal(db.select().from(mealBoxes).all().length, 0);

  // L'ajustement proposé : les retours et le remplacement ; enregistré, il devient l'ajustement de la famille.
  const v = adjustmentFor(db, PAPRIKA, { leadId: "sam" })!;
  assert.deepEqual(v.issues, ["sec", "dense"]);
  assert.deepEqual(v.adjustment.changes.map((c) => c.tag), ["swap", "sec", "dense", "dense"]);
  const saved = saveAdjustedVariant(db, PAPRIKA, { tags: v.issues, withSwaps: true, leadId: "sam" });
  assert.equal(saved.slug, `${PAPRIKA}-aux-pommes-de-terre`);
  const row = db.select().from(recipes).where(eq(recipes.slug, saved.slug)).get()!;
  assert.deepEqual([row.parentId, row.status, row.name], [rootId, "to_try", "Poulet au paprika fumé, pommes de terre rôties et riz (plus moelleuse)"]);
  assert.ok(row.serveJson?.some((g) => g.label === "sauce au skyr"));
  const mark = loadTasteMarks(db).get(PAPRIKA)!;
  assert.equal(mark.adjusted?.slug, saved.slug);
  // L'originale reste telle quelle.
  assert.equal(db.select().from(recipes).where(eq(recipes.id, rootId)).get()!.name, recipeFile(PAPRIKA).name);
});

test("en base : un remplacement noté pendant la session compte au rangement de la réserve", () => {
  const { db, rootId } = setup();
  db.update(cookSessions).set({ status: "cooking", endedAt: null }).where(eq(cookSessions.id, "S")).run();
  const k = recipeFile(PAPRIKA).ingredients.findIndex((i) => i.food === "patate_douce");
  const sw = recordSwap(db, { recipeId: rootId, position: k, toFood: "pomme_de_terre" }, NOW);
  assert.equal(sw.where, "session");
  const plain = calcModel(db, PAPRIKA, { cookedOn: "2026-11-01" }, NOW)!;
  saveReserve(db, "S", rootId, { weights: { plat: 1800, riz: 1000, "sauce-au-skyr": 220 }, counts: { alex: 3, sam: 3 } }, NOW);
  const r = db.select().from(reserves).get()!;
  assert.ok(r.kcalUnit! < plain.kcalUnit!, `${r.kcalUnit} < ${plain.kcalUnit}`);
});

test("api app : POST plats/avis après une portion, l'avis revient dans eaten", () => {
  const { db, rootId } = setup();
  saveReserve(db, "S", rootId, { weights: { plat: 1800, riz: 1000, "sauce-au-skyr": 220 }, counts: { alex: 3, sam: 3 } }, new Date("2026-11-01T18:00:00Z"));
  const key = ensureLink(db, "sam").key;
  const now = Date.parse("2026-11-02T12:30:00Z");
  const call = (method: AppRequest["method"], path: string, body: unknown = null) => appApi(db, { method, path: path.split("/"), query: new URLSearchParams(), body, headers: new Headers({ "x-mijote-key": key }), now });
  assert.ok((call("GET", "moi").body as { features: string[] }).features.includes("gouts"));
  type Plats = { dishes: { id: string }[]; eaten: { id: string; avis?: { rating: string; tags: string[] } }[]; avis: { ratings: { id: string }[]; tags: { id: string; label: string }[] } };
  const p0 = call("GET", "plats").body as unknown as Plats;
  assert.deepEqual(p0.avis.ratings.map((r) => r.id), ["love", "ok", "meh"]);
  assert.ok(p0.avis.tags.some((t) => t.id === "dense" && t.label === "trop dense"));
  const ate = call("POST", "plats/manger", { dishId: p0.dishes[0].id }).body as unknown as { serving: { id: string } };
  assert.equal(call("POST", "plats/avis", { rating: "meh" }).status, 400);
  assert.equal(call("POST", "plats/avis", { servingId: ate.serving.id, rating: "pas bon" }).status, 400);
  const r = call("POST", "plats/avis", { servingId: ate.serving.id, rating: "meh", tags: ["sec", "dense"], note: "sauce oubliée" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const body = r.body as unknown as { message: string; avis: { recipeId: string }; plats: Plats };
  assert.equal(body.message, "Noté : bof (sec, trop dense).");
  assert.equal(body.avis.recipeId, rootId);
  assert.deepEqual(body.plats.eaten[0].avis, { rating: "meh", tags: ["sec", "dense"] });
  // Par plat, sans portion : la recette du plat.
  assert.equal(call("POST", "plats/avis", { dishId: p0.dishes[0].id, rating: "ok" }).status, 200);
  assert.equal(call("POST", "plats/avis", { dishId: "inconnu", rating: "ok" }).status, 404);
});

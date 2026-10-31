// Assistant : contexte construit en code, chaque action revérifiée (cas refusés compris), flux et
// journal de l'IA avec un faux client, exécution par les fonctions de l'interface. Sans réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { aiCalls, assistantMessages } from "@/lib/db/schema";
import { AiCapReachedError, chat, setAiClient, type AiClient, type AiFinalMessage } from "@/lib/ai";
import { portionOf } from "@/lib/eaters/core";
import { habitMacros } from "@/lib/eaters/habits";
import { listHabits } from "@/lib/eaters/setup";
import { loadSelection, loadWeek } from "@/lib/week/store";
import { importRecipes } from "@/seed/bootstrap";
import {
  buildContext,
  checkAction,
  MAX_ACTIONS,
  OVER_KCAL,
  pageLine,
  parseToolCall,
  pickModel,
  reviewToolCalls,
  toolDefinitions,
  type ActionInput,
  type Snapshot,
} from "@/lib/assistant/core";
import { applyAssistantAction, askAssistant, clearAssistant, dismissAssistantAction, historyMessages, listAssistant, loadSnapshot, toView } from "@/lib/assistant/store";
import { seedTest } from "./helpers";

const WEEK = "2026-11-02";

// ─── Un instantané fait main : le foyer fictif Alex et Sam ───

const SHAKER = [
  { food: "whey", grams: 30 },
  { food: "lait_demi", grams: 250 },
];

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    today: "2026-11-03",
    speakerId: "alex",
    people: [
      {
        id: "alex",
        name: "Alex",
        goal: "Recomposition",
        dayTarget: { kcal: 2400, proteinG: 160 },
        ref: { kcalMin: 800, kcalMax: 950, proteinMin: 55, proteinMax: 70 },
        baseUnits: 5,
        outside: { kcal: 300, protein: 30 },
        outsideSource: "habitudes",
        habits: [{ id: "h-alex", label: "Shaker", meal: "breakfast", weekdays: [0, 1, 2, 3, 4, 5, 6], items: SHAKER, kcal: 0, proteinG: 0 }],
        batchMeal: { kcal: 850, protein: 50 },
        dislikes: [],
        missing: [],
      },
      {
        id: "sam",
        name: "Sam",
        goal: null,
        dayTarget: { kcal: 1900, proteinG: 110 },
        ref: { kcalMin: 650, kcalMax: 800, proteinMin: 35, proteinMax: 50 },
        baseUnits: 4,
        outside: null,
        outsideSource: null,
        habits: [{ id: "h-foyer", label: "Fruit", meal: "snack", weekdays: [0, 1, 2, 3, 4], items: [{ food: "pomme", grams: 150 }], kcal: 0, proteinG: 0, shared: true }],
        batchMeal: { kcal: 700, protein: 38 },
        dislikes: ["Brocoli"],
        missing: [],
      },
    ],
    week: { start: WEEK, days: 7, label: "semaine du 2 novembre", selected: ["curry"], list: null },
    recipes: [
      { slug: "curry", name: "Curry de pois chiches", kcalUnit: 160, proteinUnit: 8, status: "liked", excludedFor: [] },
      { slug: "poulet", name: "Poulet rôti", kcalUnit: 170, proteinUnit: 14, status: "to_try", excludedFor: [] },
      { slug: "gratin", name: "Gratin de brocoli", kcalUnit: 150, proteinUnit: 9, status: "to_try", excludedFor: ["sam"] },
      { slug: "vieux", name: "Vieux plat", kcalUnit: 150, proteinUnit: 9, status: "archived", excludedFor: [] },
    ],
    boxes: [
      { id: "b1", name: "Curry de pois chiches", personId: "sam", kcal: 640, proteinG: 32, place: "fridge", limit: "2026-11-04", freshness: "soon" },
      { id: "b2", name: "Poulet rôti", personId: null, kcal: 700, proteinG: 55, place: "freezer", limit: "2027-01-10", freshness: "ok" },
    ],
    ...over,
  };
}

const ok = (a: ActionInput, s = snap()) => {
  const c = checkAction(a, s);
  assert.ok(c.ok, c.ok ? "" : c.reason);
  return c;
};
const refused = (a: ActionInput, re: RegExp, s = snap()) => {
  const c = checkAction(a, s);
  assert.equal(c.ok, false, `devait être refusée : ${JSON.stringify(a)}`);
  if (!c.ok) assert.match(c.reason, re);
};
const why = "test";

// ─── Contexte ───

test("contexte : un résumé chiffré par le code, la personne qui parle, les ids utiles", () => {
  const s = snap();
  const ctx = buildContext(s);
  assert.match(ctx, /Alex \(personId alex\) — c'est la personne qui te parle/);
  assert.match(ctx, /habitId h-alex/);
  assert.match(ctx, /boxId b1, pour Sam/);
  assert.match(ctx, /curry — Curry de pois chiches \[retenue\] \[aimée\]/);
  assert.match(ctx, /Recettes retenues \(1\/4\)/);
  // La part de chacun vient de portionOf, pas du modèle.
  const part = portionOf({ baseUnits: 5, ref: s.people[0].ref }, s.recipes[1]);
  assert.ok(ctx.includes(`Alex ${part.kcal!.toLocaleString("fr-FR")} kcal/${part.protein} g prot.`));
  // Goûts : la recette n'est pas servie à Sam ; une recette archivée n'apparaît pas.
  assert.match(ctx, /gratin — Gratin de brocoli : Alex [^,]+, Sam pas servie/);
  assert.doesNotMatch(ctx, /vieux/);
  // Le conseil de l'appli (habits.adviceOf) est repris tel quel.
  assert.match(ctx, /Conseil de l'appli : /);
  assert.match(ctx, /whey : /);
});

test("contexte de la page : la fiche ouverte, sinon la rubrique", () => {
  const s = snap();
  assert.match(pageLine({ path: "/recettes/poulet", recipeSlug: "poulet" }, s), /fiche de la recette Poulet rôti/);
  assert.match(pageLine({ path: "/semaine" }, s), /sur la semaine/);
  assert.match(pageLine({ path: "/" }, s), /l'accueil/);
});

test("contexte réel : chargé depuis la base du foyer de test, compact", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  importRecipes(db, "src/seed/recipes");
  const s = loadSnapshot(db, "sam", WEEK);
  assert.deepEqual(s.people.map((p) => p.name), ["Alex", "Sam"]);
  assert.ok(s.people[0].habits.some((h) => h.id === "tpl-shaker-alex"));
  assert.ok(s.recipes.length > 5);
  const ctx = buildContext(s);
  assert.match(ctx, /Sam \(personId sam\) — c'est la personne qui te parle/);
  assert.ok(ctx.length < 20_000, `contexte trop long : ${ctx.length}`);
});

// ─── Modèle ───

test("modèle : Haiku pour une question, Sonnet pour composer la semaine", () => {
  assert.equal(pickModel("Dois-je prendre un shaker ?"), "small");
  assert.equal(pickModel("Quelle recette cette semaine pour plus de protéines ?"), "small");
  assert.equal(pickModel("Compose la semaine pour nous deux"), "plan");
  assert.equal(pickModel("Planifie toute la semaine"), "plan");
});

// ─── Outils ───

test("outils stricts : schéma fermé, sans bornes ni $schema", () => {
  const tools = toolDefinitions();
  assert.equal(tools.length, 6);
  for (const t of tools) {
    assert.equal(t.input_schema.additionalProperties, false, t.name);
    assert.equal(t.input_schema.$schema, undefined);
    assert.doesNotMatch(JSON.stringify(t.input_schema), /minimum|maximum/);
  }
});

test("appel d'outil : inconnu ou non conforme → ignoré", () => {
  assert.equal(parseToolCall({ name: "supprimer_tout", input: {} }), null);
  assert.equal(parseToolCall({ name: "ajouter_recette", input: { slug: 3 } }), null);
  assert.equal(parseToolCall({ name: "ajouter_recette", input: { slug: "poulet" } }), null); // sans why
  assert.deepEqual(parseToolCall({ name: "ajouter_recette", input: { slug: "poulet", why } }), { kind: "ajouter_recette", slug: "poulet", why });
});

// ─── Vérification de chaque action ───

test("ajouter une recette : parts calculées, refus motivés", () => {
  const c = ok({ kind: "ajouter_recette", slug: "poulet", why });
  assert.ok(c.ok);
  const part = portionOf({ baseUnits: 5, ref: snap().people[0].ref }, { kcalUnit: 170, proteinUnit: 14 });
  assert.ok(c.lines.find((l) => l.label === "Alex")!.value.includes(`${part.kcal!.toLocaleString("fr-FR")} kcal`));
  const g = ok({ kind: "ajouter_recette", slug: "gratin", why });
  assert.ok(g.ok && g.lines.find((l) => l.label === "Sam")!.value === "pas servie (goûts)");
  refused({ kind: "ajouter_recette", slug: "inconnue", why }, /pas dans la bibliothèque/);
  refused({ kind: "ajouter_recette", slug: "vieux", why }, /pas dans la bibliothèque/);
  refused({ kind: "ajouter_recette", slug: "curry", why }, /déjà dans la semaine/);
  const full = snap({ week: { ...snap().week, selected: ["a", "b", "c", "d"] } });
  refused({ kind: "ajouter_recette", slug: "poulet", why }, /déjà 4 recettes/, full);
});

test("retirer une recette : seulement une recette retenue", () => {
  ok({ kind: "retirer_recette", slug: "curry", why });
  refused({ kind: "retirer_recette", slug: "poulet", why }, /pas dans la semaine/);
});

test("ajouter une habitude : macros du code, effet sur la journée, refus", () => {
  const items = [{ food: "skyr", grams: 200 }];
  const c = ok({ kind: "ajouter_habitude", personId: "sam", label: "Skyr du matin", meal: "breakfast", weekdays: [0, 1, 2, 3, 4], items, why });
  assert.ok(c.ok);
  const m = habitMacros(items);
  assert.ok(c.lines.find((l) => l.label === "Apporte")!.value.startsWith(`${m.kcal} kcal · ${Math.round(m.proteinG)} g`));
  assert.ok(c.lines.find((l) => l.label === "Protéines du jour")!.value.includes("→"));
  const base = { kind: "ajouter_habitude" as const, personId: "sam", label: "En-cas", meal: "snack" as const, weekdays: [0], items, why };
  refused({ ...base, personId: "inconnu" }, /Personne inconnue/);
  refused({ ...base, items: [{ food: "licorne", grams: 100 }] }, /Aliment inconnu/);
  refused({ ...base, items: [{ food: "skyr", grams: 5000 }] }, /entre 1 et 1 000 g/);
  refused({ ...base, items: [] }, /au moins un aliment/);
  refused({ ...base, weekdays: [] }, /au moins un jour/);
  refused({ ...base, weekdays: [1.5] }, /Jours invalides/);
  refused({ ...base, weekdays: [9] }, /au moins un jour/);
  refused({ ...base, label: " " }, /nom/);
  // Un deuxième shaker pour Alex : non.
  refused({ ...base, personId: "alex", items: [{ food: "whey", grams: 30 }] }, /déjà un shaker/);
  // Trop pour la cible : 1 000 g d'amandes tous les jours dépassent de bien plus de OVER_KCAL.
  refused({ ...base, weekdays: [0, 1, 2, 3, 4, 5, 6], items: [{ food: "amandes", grams: 300 }] }, new RegExp(`dépasserait sa cible`));
  assert.ok(OVER_KCAL > 0);
});

test("retirer une habitude : la sienne seulement, pas une habitude commune", () => {
  const c = ok({ kind: "retirer_habitude", personId: "alex", habitId: "h-alex", why });
  assert.ok(c.ok && c.lines[0].label === "Apportait");
  refused({ kind: "retirer_habitude", personId: "alex", habitId: "h-foyer", why }, /introuvable/);
  refused({ kind: "retirer_habitude", personId: "sam", habitId: "h-foyer", why }, /commune au foyer/);
});

test("manger une boîte : au frigo, chiffres de la boîte, note si elle était pour l'autre", () => {
  const c = ok({ kind: "manger_boite", boxId: "b1", personId: "alex", why });
  assert.ok(c.ok);
  assert.equal(c.lines[0].value, "640 kcal · 32 g de protéines");
  assert.match(c.notes.join(" "), /prévue pour Sam/);
  refused({ kind: "manger_boite", boxId: "b2", personId: "alex", why }, /congélo/);
  refused({ kind: "manger_boite", boxId: "b9", personId: "alex", why }, /plus au frigo/);
  refused({ kind: "manger_boite", boxId: "b1", personId: "inconnu", why }, /Personne inconnue/);
});

test("faire les courses : une sélection, et pas deux fois la même liste", () => {
  const c = ok({ kind: "faire_courses", why });
  assert.ok(c.ok && c.lines[0].value === "Curry de pois chiches");
  refused({ kind: "faire_courses", why }, /Aucune recette/, snap({ week: { ...snap().week, selected: [] } }));
  refused({ kind: "faire_courses", why }, /déjà faite et à jour/, snap({ week: { ...snap().week, list: { status: "draft", changed: false, ordered: false } } }));
  ok({ kind: "faire_courses", why }, snap({ week: { ...snap().week, list: { status: "draft", changed: true, ordered: false } } }));
});

test("réponse : trois actions au plus, doublons et outils inconnus écartés, refus gardés", () => {
  const calls = [
    { name: "ajouter_recette", input: { slug: "poulet", why } },
    { name: "ajouter_recette", input: { slug: "poulet", why: "encore" } },
    { name: "inconnu", input: {} },
    { name: "ajouter_recette", input: { slug: "inconnue", why } },
    { name: "faire_courses", input: { why } },
    { name: "retirer_recette", input: { slug: "curry", why } },
  ];
  const r = reviewToolCalls(calls, snap());
  assert.equal(r.length, MAX_ACTIONS);
  assert.deepEqual(r.map((a) => a.status), ["proposed", "refused", "proposed"]);
});

// ─── Le flux de l'IA, avec un faux client ───

function fakeClient(text: string, tools: { name: string; input: unknown }[], seen: Record<string, unknown>[] = []): AiClient {
  return {
    messages: {
      parse: async () => {
        throw new Error("non utilisé");
      },
      stream: (params) => {
        seen.push(params);
        const final: AiFinalMessage = {
          usage: { input_tokens: 2000, output_tokens: 150, cache_read_input_tokens: 1500 },
          stop_reason: tools.length ? "tool_use" : "end_turn",
          content: [{ type: "text", text }, ...tools.map((t) => ({ type: "tool_use", name: t.name, input: t.input }))],
        };
        return {
          async *[Symbol.asyncIterator]() {
            for (const w of text.split(/(?<= )/)) yield { type: "content_block_delta", delta: { type: "text_delta", text: w } };
          },
          finalMessage: async () => final,
        };
      },
    },
  };
}

test("chat() : texte en flux, outils stricts, cache sur le system, appel journalisé", async () => {
  const { db } = openDb(":memory:");
  const seen: Record<string, unknown>[] = [];
  setAiClient(fakeClient("Un shaker suffit.", [{ name: "faire_courses", input: { why } }], seen));
  try {
    const parts: string[] = [];
    const r = await chat({ db, screen: "assistant", system: ["stable", "contexte"], messages: [{ role: "user", content: "?" }], tools: toolDefinitions(), onText: (t) => parts.push(t) });
    assert.equal(parts.join(""), "Un shaker suffit.");
    assert.ok(parts.length > 1);
    assert.equal(r.model, "claude-haiku-5-5");
    assert.deepEqual(r.toolCalls, [{ name: "faire_courses", input: { why } }]);
    const p = seen[0] as { system: { cache_control: unknown }[]; tools: { strict: boolean }[] };
    assert.ok(p.system.every((b) => b.cache_control));
    assert.ok(p.tools.every((t) => t.strict === true));
    const log = db.select().from(aiCalls).all();
    assert.equal(log.length, 1);
    assert.equal(log[0].screen, "assistant");
    assert.ok(log[0].costUsd > 0);
  } finally {
    setAiClient(null);
  }
});

test("chat() : plafond atteint → refus avant tout appel", async () => {
  const { db } = openDb(":memory:");
  const prev = process.env.AI_MONTHLY_CAP_USD;
  process.env.AI_MONTHLY_CAP_USD = "1";
  db.insert(aiCalls).values({ id: "x", screen: "test", model: "claude-haiku-5-5", costUsd: 1.2, ok: true }).run();
  const seen: Record<string, unknown>[] = [];
  setAiClient(fakeClient("non", [], seen));
  try {
    await assert.rejects(chat({ db, screen: "assistant", system: ["s"], messages: [{ role: "user", content: "?" }], tools: [] }), AiCapReachedError);
    assert.equal(seen.length, 0);
  } finally {
    setAiClient(null);
    if (prev == null) delete process.env.AI_MONTHLY_CAP_USD;
    else process.env.AI_MONTHLY_CAP_USD = prev;
  }
});

// ─── De la question à l'action appliquée ───

test("assistant : question, actions vérifiées, Appliquer exécute avec les fonctions de l'interface", async () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  importRecipes(db, "src/seed/recipes");
  const s0 = loadSnapshot(db, "sam", WEEK);
  const slug = s0.recipes[0].slug;
  const seen: Record<string, unknown>[] = [];
  setAiClient(
    fakeClient(
      "Ajoute une recette riche en protéines, et un skyr le matin pour Sam.",
      [
        { name: "ajouter_recette", input: { slug, why } },
        { name: "ajouter_recette", input: { slug: "n-existe-pas", why } },
        { name: "ajouter_habitude", input: { personId: "sam", label: "Skyr du matin", meal: "breakfast", weekdays: [0, 1, 2, 3, 4], items: [{ food: "skyr", grams: 150 }], why } },
      ],
      seen
    )
  );
  try {
    const streamed: string[] = [];
    const row = await askAssistant(db, "sam", "Quelle recette pour plus de protéines ?", { path: "/semaine", week: WEEK }, (t) => streamed.push(t));
    assert.equal(streamed.join(""), row.text);
    const v = toView(row);
    assert.deepEqual(v.actions.map((a) => a.status), ["proposed", "refused", "proposed"]);
    assert.match(v.actions[1].reason!, /pas dans la bibliothèque/);
    // Contexte en cache dans le system, la page dans le message.
    const p = seen[0] as { system: { text: string }[]; messages: { role: string; content: string }[]; model: string };
    assert.match(p.system[1].text, /Sam \(personId sam\)/);
    assert.match(p.messages.at(-1)!.content, /^La personne est sur la semaine\./);
    assert.equal(p.model, "claude-haiku-5-5");

    // Appliquer : la recette entre dans la semaine, par addRecipe.
    const r1 = applyAssistantAction(db, "sam", row.id, 0);
    assert.ok(r1.ok, r1.message);
    assert.ok(loadSelection(db, loadWeek(db, WEEK).planId).some((x) => x.slug === slug));
    assert.equal(applyAssistantAction(db, "sam", row.id, 0).ok, false); // pas deux fois
    assert.equal(applyAssistantAction(db, "alex", row.id, 2).ok, false); // pas la conversation d'un autre
    // Une action écartée ne s'applique pas.
    assert.equal(applyAssistantAction(db, "sam", row.id, 1).ok, false);
    // L'habitude, par saveHabit (macros recalculées).
    const before = listHabits(db, "sam").length;
    assert.ok(applyAssistantAction(db, "sam", row.id, 2).ok);
    assert.equal(listHabits(db, "sam").length, before + 1);

    // L'historique dit au modèle ce qu'il est advenu des actions.
    const h = historyMessages(listAssistant(db, "sam"));
    assert.equal(h[0].role, "user");
    assert.match(h[1].content, /appliquée/);
    assert.match(h[1].content, /écartée par l'appli/);

    // Nouvelle question, puis Annuler ; et revérification au moment d'appliquer.
    setAiClient(fakeClient("Retire-la.", [{ name: "retirer_recette", input: { slug, why } }, { name: "faire_courses", input: { why } }]));
    const row2 = await askAssistant(db, "sam", "Finalement non", { path: "/", week: WEEK });
    assert.ok(dismissAssistantAction(db, "sam", row2.id, 0));
    assert.equal(toView(db.select().from(assistantMessages).all().find((m) => m.id === row2.id)!).actions[0].status, "dismissed");
    const r3 = applyAssistantAction(db, "sam", row2.id, 1);
    assert.ok(r3.ok, r3.message);
    assert.match(r3.href!, /^\/courses\//);

    clearAssistant(db, "sam");
    assert.equal(listAssistant(db, "sam").length, 0);
  } finally {
    setAiClient(null);
  }
});

test("assistant : en cas d'échec de l'IA, rien n'est gardé (la question peut être renvoyée)", async () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  setAiClient({
    messages: {
      parse: async () => {
        throw new Error("non");
      },
      stream: () => {
        throw new Error("réseau coupé");
      },
    },
  });
  try {
    await assert.rejects(askAssistant(db, "alex", "Bonjour", { path: "/" }), /réseau coupé/);
    assert.equal(listAssistant(db, "alex").length, 0);
    assert.equal(db.select().from(aiCalls).all()[0].ok, false);
  } finally {
    setAiClient(null);
  }
});

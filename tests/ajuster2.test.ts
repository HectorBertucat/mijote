// « Ajuster », deuxième passe : durée des appels (ai_calls.duration_ms) et progression calée dessus,
// proposition gardée par recette (échanges, affiner, effacer, périmée), variantes liées (parent_id,
// migration de reprise comprise) et restes de paquet classés.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { migrate, openDb } from "@/lib/db/open";
import * as schema from "@/lib/db/schema";
import { aiCalls, recipes } from "@/lib/db/schema";
import { expectedDurationMs, setAiClient, type AiClient } from "@/lib/ai";
import type { ResolveResponse, ResolvedProduct } from "@/lib/chronocatalog";
import { RecipeInput } from "@/lib/recipes/format";
import { upsertRecipe } from "@/lib/recipes/store";
import { clearProposal, loadProposal, runAdjustment, saveDraft, type AdjustPhase, type AdjustProposal } from "@/lib/atelier";
import { toAiRecipe } from "@/lib/atelier/schema";
import { rankLeftovers } from "@/lib/atelier/leftovers";
import type { Leftover, LibraryRecipe } from "@/lib/atelier/verify";
import { familyOf, familySlugs, variantLinks } from "@/lib/recipes/variants";
import { calibrated } from "@/components/ui/progress";

const product = (id: string, name: string, weightG: number): ResolvedProduct => ({
  id,
  name,
  slug: id,
  productUrl: `https://example.test/${id}`,
  imageUrl: null,
  brandName: null,
  quantityLabel: `${weightG} g`,
  weightG,
  isFrozen: false,
  currentPrice: 5,
  currentPricePerKg: null,
  promoPriceEur: null,
  stockStatus: "HIGH_STOCK",
  source: "chronodrive",
  isFavorite: false,
  availability: { status: "available", stockStatus: null, label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 1, stale: false },
});
const fakeResolve = async (q: string): Promise<ResolveResponse> => {
  const s = q.toLowerCase();
  const t = (slug: string, p: ResolvedProduct) => ({ query: q, source: "test", matchedTypes: [{ id: slug, slug, name: slug, broadCategory: "x", unit: "g", products: [p] }] });
  if (s.includes("jambonneau")) return t("jambonneau", product("p-jb", "Jambonneau cuit 600 g", 600));
  if (s.includes("courgette")) return t("courgette", product("p-co", "Courgettes 750 g", 750));
  if (s.includes("crème") || s.includes("creme")) return t("creme", product("p-cr", "Crème légère 20 cl", 200));
  return { query: q, source: "test", matchedTypes: [], none: { reason: "no_match", why: "test" } };
};

const original = RecipeInput.parse({
  slug: "jambonneau-lentilles",
  name: "Jambonneau aux lentilles",
  servingsUnits: 9,
  status: "liked",
  ingredients: [
    { lineRaw: "600 g jambonneau", item: "Jambonneau", grams: 600, food: "echine_porc" },
    { lineRaw: "200 g crème légère", item: "Crème légère", grams: 200, food: "creme_legere" },
    { lineRaw: "sel", item: "Sel", pantry: true, food: "zero" },
  ],
  steps: [{ kind: "sear", text: "Saisir le jambonneau.", hobLevel: 6, cue: "croûte dorée" }],
});

/** Faux client : chaque appel retire 100 g de jambonneau de la recette reçue ; garde les prompts envoyés. */
function fakeClient(prompts: string[]): AiClient {
  return {
    messages: {
      parse: async (params) => {
        const msg = (params.messages as { content: string }[])[0].content;
        prompts.push(msg);
        const json = msg.slice(msg.indexOf("{"), msg.indexOf("\n\nDemande :"));
        const r = toAiRecipe(RecipeInput.parse(JSON.parse(json)));
        const j = r.ingredients.find((i) => i.item === "Jambonneau")!;
        j.grams = (j.grams ?? 0) - 100;
        j.lineRaw = `${j.grams} g jambonneau`;
        return {
          usage: { input_tokens: 4000, output_tokens: 2000 },
          stop_reason: "end_turn",
          parsed_output: { recipe: { ...r, slug: "allegee" }, explanation: `Jambonneau à ${j.grams} g.`, changes: [`Jambonneau ${j.grams} g`] },
        };
      },
    },
  };
}

test("durée : chaque appel est mesuré, la médiane des derniers cale le chargement (repère prod sinon)", async () => {
  const { db } = openDb(":memory:");
  assert.deepEqual(expectedDurationMs(db, "ajuster"), { ms: 28_000, samples: 0 });
  const row = (id: string, ms: number, extra: Partial<typeof aiCalls.$inferInsert> = {}) =>
    db.insert(aiCalls).values({ id, screen: "ajuster", model: "m", ok: true, durationMs: ms, ...extra }).run();
  row("a", 20_000);
  row("b", 30_000);
  row("c", 26_000);
  row("ko", 90_000, { ok: false });
  row("mock", 900, { error: "réponse simulée (MIJOTE_AI_MOCK)" });
  assert.deepEqual(expectedDurationMs(db, "ajuster"), { ms: 26_000, samples: 3 }, "médiane des appels réussis, hors simulés");
  assert.deepEqual(expectedDurationMs(db, "ajuster", { mock: true }), { ms: 900, samples: 1 });

  // structured() journalise la durée réelle.
  upsertRecipe(db, original);
  setAiClient(fakeClient([]));
  process.env.AI_MONTHLY_CAP_USD = "30";
  try {
    await runAdjustment(db, original.slug, { optionId: "moins-kcal", label: "−150 kcal" }, { resolve: fakeResolve });
  } finally {
    setAiClient(null);
  }
  const last = db.select().from(aiCalls).all().find((c) => c.id.length > 10)!;
  assert.equal(typeof last.durationMs, "number");
  assert.ok(last.durationMs! >= 0);
});

test("progression calée : ≈ 78 % à la durée attendue, jamais pleine avant la fin", () => {
  assert.equal(calibrated(0, 28_000), 0);
  assert.ok(Math.abs(calibrated(28_000, 28_000) - 0.78) < 0.01);
  assert.ok(calibrated(120_000, 28_000) < 0.95);
  assert.ok(calibrated(14_000, 28_000) < calibrated(20_000, 28_000));
});

test("proposition gardée : enregistrée avec ses échanges, affinée, périmée si la fiche change, effacée", async () => {
  const { db } = openDb(":memory:");
  const { id } = upsertRecipe(db, original);
  const prompts: string[] = [];
  setAiClient(fakeClient(prompts));
  process.env.AI_MONTHLY_CAP_USD = "30";
  try {
    const phases: AdjustPhase[] = [];
    const s1 = await runAdjustment(db, original.slug, { optionId: "moins-kcal", label: "−150 kcal" }, { resolve: fakeResolve, onPhase: (p) => phases.push(p) });
    // Étapes réelles : lecture, IA, puis la vérification compte les ingrédients passés au catalogue
    // (jambonneau et crème ; le sel, au placard et inchangé, n'y va pas), une fois chacun.
    assert.deepEqual(phases.map((p) => p.phase), ["read", "ai", "verify", "verify", "verify"]);
    assert.deepEqual(phases.at(-1), { phase: "verify", done: 2, total: 2 });
    assert.equal(s1.exchanges.length, 1);

    // Retrouvée en revenant sur la fiche.
    const k1 = loadProposal<AdjustProposal>(db, id)!;
    assert.equal(k1.proposal.draft.ingredients[0].grams, 500);
    assert.deepEqual(k1.exchanges.map((e) => [e.ask, e.refine, e.answer]), [["−150 kcal", false, "Jambonneau à 500 g."]]);

    // Affiner : l'IA part de la proposition gardée (500 g), et voit la demande précédente.
    await runAdjustment(db, original.slug, { text: "encore moins", refine: true, label: "encore moins" }, { resolve: fakeResolve });
    assert.match(prompts.at(-1)!, /"grams":500/);
    assert.match(prompts.at(-1)!, /demandes précédentes : « −150 kcal »/);
    const k2 = loadProposal<AdjustProposal>(db, id)!;
    assert.equal(k2.proposal.draft.ingredients[0].grams, 400);
    assert.deepEqual(k2.exchanges.map((e) => e.refine), [false, true]);
    // 400 g sur la barquette de 600 g : le reste est signalé, classé (aucune autre recette ici).
    assert.deepEqual(k2.proposal.verification.leftovers.map((l) => [l.restG, l.suggestions.length]), [[200, 0]]);
    // Comparée à l'originale, pas à la proposition d'avant.
    assert.equal(k2.proposal.verification.rows.find((r) => r.after?.item === "Jambonneau")?.before?.grams, 600);

    // Une option repart de la fiche d'origine (600 g → 500 g), une seule proposition par recette.
    await runAdjustment(db, original.slug, { optionId: "plus-proteines", label: "+15 g" }, { resolve: fakeResolve });
    assert.equal(loadProposal<AdjustProposal>(db, id)!.proposal.draft.ingredients[0].grams, 500);
    assert.equal(db.select().from(schema.adjustProposals).all().length, 1);
    assert.deepEqual(loadProposal<AdjustProposal>(db, id)!.exchanges.map((e) => e.ask), ["+15 g"], "repartir de l'originale recommence le fil");

    // Effacer.
    clearProposal(db, id);
    assert.equal(loadProposal(db, id), null);

    // Périmée si la fiche change (réimport) : vidée au chargement.
    await runAdjustment(db, original.slug, { optionId: "moins-kcal", label: "−150 kcal" }, { resolve: fakeResolve });
    db.update(recipes).set({ updatedAt: "2099-01-01T00:00:00.000Z" }).where(eq(recipes.id, id)).run();
    assert.equal(loadProposal(db, id), null);
    assert.equal(db.select().from(schema.adjustProposals).all().length, 0);
  } finally {
    setAiClient(null);
  }
});

test("variantes : liées à la racine, écarts en code, comptées pour la bibliothèque", () => {
  const { db } = openDb(":memory:");
  const { id: rootId } = upsertRecipe(db, original);
  const light = { ...original, slug: "allegee", name: "Jambonneau allégé", ingredients: [{ ...original.ingredients[0], grams: 400, lineRaw: "400 g jambonneau" }, ...original.ingredients.slice(1)] };
  const s1 = saveDraft(db, light, { parent: { slug: original.slug, name: original.name }, origin: "ajuster" });
  // Une variante de variante devient une sœur (rattachée à la racine).
  const s2 = saveDraft(db, { ...light, slug: "sans-creme", name: "Jambonneau sans crème", ingredients: [light.ingredients[0], light.ingredients[2]] }, { parent: { slug: s1, name: "Jambonneau allégé" }, origin: "ajuster" });
  const get = (slug: string) => db.select().from(recipes).where(eq(recipes.slug, slug)).get()!;
  assert.equal(get(s1).parentId, rootId);
  assert.equal(get(s2).parentId, rootId);
  assert.equal(s2, "jambonneau-lentilles-sans-creme", "le slug part de la racine");
  assert.match(get(s2).source!, /^Variante de « Jambonneau aux lentilles » \(\/recettes\/jambonneau-lentilles\)/);

  const fam = familyOf(db, rootId)!;
  assert.equal(fam.isRoot, true);
  assert.deepEqual(new Set(fam.variants.map((v) => v.slug)), new Set([s1, s2]));
  const v1 = fam.variants.find((v) => v.slug === s1)!;
  // 200 g d'échine en moins sur 9 unités, part de base 4 unités (foyer vide) : (200 × 205 / 100) × 4 / 9 ≈ 182 kcal.
  const r0 = get(original.slug);
  const r1 = get(s1);
  assert.equal(v1.delta.kcal, Math.round(r1.kcalUnit! * 4) - Math.round(r0.kcalUnit! * 4));
  assert.ok(v1.delta.kcal! < -160 && v1.delta.kcal! > -210);
  assert.ok(v1.delta.protein! < 0);
  assert.equal(v1.delta.costH, null, "pas de prix connu : pas d'écart de coût");

  const fromVariant = familyOf(db, get(s2).id)!;
  assert.equal(fromVariant.isRoot, false);
  assert.equal(fromVariant.root.slug, original.slug);
  assert.deepEqual(familySlugs(db, get(s2).id), new Set([original.slug, s1, s2]));

  const links = variantLinks(db);
  assert.equal(links.count.get(rootId), 2);
  assert.equal(links.parentOf.get(get(s1).id)?.slug, original.slug);

  // Supprimer l'originale ne supprime pas ses variantes : elles redeviennent des recettes seules.
  db.delete(recipes).where(eq(recipes.id, rootId)).run();
  assert.equal(get(s1).parentId, null);
});

test("reste de paquet : une recette qui le finit d'abord, la famille exclue", () => {
  const lib: LibraryRecipe[] = [
    { id: "1", slug: "gros", name: "Gros plat", ingredients: [{ item: "Échine", food: "echine_porc", grams: 1000, units: null, pantry: false }] },
    { id: "2", slug: "juste", name: "Juste ce qu'il faut", ingredients: [{ item: "Échine", food: "echine_porc", grams: 180, units: null, pantry: false }] },
    { id: "3", slug: "petit", name: "Petit plat", ingredients: [{ item: "Échine", food: "echine_porc", grams: 80, units: null, pantry: false }] },
    { id: "4", slug: "soeur", name: "Variante sœur", ingredients: [{ item: "Échine", food: "echine_porc", grams: 200, units: null, pantry: false }] },
    { id: "5", slug: "autre", name: "Sans porc", ingredients: [{ item: "Poulet", food: "filet_poulet", grams: 200, units: null, pantry: false }] },
  ];
  const left: Leftover = { item: "Échine de porc", food: "echine_porc", restG: 200, orderedG: 1000, usedG: 800, product: "Échine 1 kg", suggestions: [] };
  const [r] = rankLeftovers([left], lib, new Set(["soeur"]));
  assert.deepEqual(r.suggestions.map((s) => [s.slug, s.usesG, s.fits]), [
    ["juste", 180, true],
    ["petit", 80, true],
    ["gros", 1000, false],
  ]);
});

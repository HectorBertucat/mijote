// Atelier : la vérification en code d'une variante simulée (catalogue, nutrition,
// restes de paquet), les doublons, et l'appel IA avec un faux client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { setAiClient, type AiClient } from "@/lib/ai";
import type { ResolveResponse, ResolvedProduct } from "@/lib/chronocatalog";
import { computeNutrition } from "@/lib/nutrition/compute";
import { SAMPLE_HOUSEHOLD } from "@/lib/eaters/core";
import { RecipeInput } from "@/lib/recipes/format";
import { upsertRecipe } from "@/lib/recipes/store";
import { adjustOptions, proposeAdjustment, saveDraft } from "@/lib/atelier";
import { diffIngredients, findDuplicate, verifyRecipe, type LibraryRecipe } from "@/lib/atelier/verify";
import { normalizeRecipe, toAiRecipe } from "@/lib/atelier/schema";

const product = (id: string, name: string, weightG: number, status: "available" | "out_of_stock" = "available"): ResolvedProduct => ({
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
  stockStatus: status === "available" ? "HIGH_STOCK" : "NO_STOCK",
  source: "chronodrive",
  isFavorite: false,
  availability: { status, stockStatus: null, label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 1, stale: false },
});

const typeOf = (slug: string, products: ResolvedProduct[]) => ({ id: slug, slug, name: slug, broadCategory: "viande", unit: "g", products });

// Faux catalogue : jambonneau en barquette de 600 g, crème en rupture sans remplaçant,
// courgettes en sachet de 750 g, rien pour les baies de goji.
const fakeResolve = async (q: string): Promise<ResolveResponse> => {
  const s = q.toLowerCase();
  const none = { query: q, source: "test", matchedTypes: [], none: { reason: "no_match", why: "test" } };
  if (s.includes("goji")) return none;
  if (s.includes("jambonneau")) return { query: q, source: "test", matchedTypes: [typeOf("jambonneau", [product("p-jb", "Jambonneau cuit 600 g", 600)])] };
  if (s.includes("crème") || s.includes("creme"))
    return { query: q, source: "test", matchedTypes: [typeOf("creme", [product("p-cr", "Crème légère 20 cl", 200, "out_of_stock")])] };
  if (s.includes("courgette")) return { query: q, source: "test", matchedTypes: [typeOf("courgette", [product("p-co", "Courgettes 750 g", 750)])] };
  if (s.includes("oignon")) return { query: q, source: "test", matchedTypes: [typeOf("oignon", [product("p-oi", "Oignons 1 kg", 1000)])] };
  return none;
};

const original = RecipeInput.parse({
  slug: "jambonneau-lentilles",
  name: "Jambonneau aux lentilles",
  servingsUnits: 9,
  status: "liked",
  ingredients: [
    { lineRaw: "600 g jambonneau", item: "Jambonneau", grams: 600, food: "echine_porc" },
    { lineRaw: "200 g crème légère", item: "Crème légère", grams: 200, food: "creme_legere" },
    { lineRaw: "2 oignons", item: "Oignons", grams: 300, units: 2, food: "oignon" },
    { lineRaw: "sel", item: "Sel", pantry: true, food: "zero" },
  ],
  steps: [{ kind: "sear", text: "Saisir le jambonneau.", hobLevel: 6, cue: "croûte dorée" }],
});

test("diff : quantités changées, ajouts et retraits, appariés par nom puis par aliment", () => {
  const after = [
    { ...original.ingredients[0], lineRaw: "400 g jambonneau", grams: 400 },
    { ...original.ingredients[2], item: "Oignons émincés" }, // même aliment, nom changé
    { lineRaw: "400 g courgettes", item: "Courgettes", grams: 400, food: "courgette" },
    original.ingredients[3],
  ];
  const rows = diffIngredients(original.ingredients, after);
  const by = (item: string) => rows.find((r) => (r.after ?? r.before)!.item === item)!;
  assert.equal(by("Jambonneau").status, "changed");
  assert.equal(by("Oignons émincés").status, "same");
  assert.equal(by("Crème légère").status, "removed");
  assert.equal(by("Courgettes").status, "added");
  assert.equal(by("Sel").status, "same");
});

test("variante simulée : ingrédient introuvable, nutrition recalculée, reste de paquet", async () => {
  // L'IA prétend 99 kcal par unité : le code l'ignore et recalcule.
  const draft = normalizeRecipe({
    ...toAiRecipe(original),
    slug: "allegee",
    ingredients: [
      { lineRaw: "400 g jambonneau", item: "Jambonneau", grams: 400, units: null, group: null, optional: false, pantry: false, food: "echine_porc" },
      { lineRaw: "100 g crème légère", item: "Crème légère", grams: 100, units: null, group: null, optional: true, pantry: false, food: "creme_legere" },
      { lineRaw: "2 oignons", item: "Oignons", grams: 300, units: 2, group: null, optional: false, pantry: false, food: "oignon" },
      { lineRaw: "50 g baies de goji", item: "Baies de goji", grams: 50, units: null, group: null, optional: false, pantry: false, food: "pas_un_id" },
      { lineRaw: "sel", item: "Sel", grams: null, units: null, group: null, optional: false, pantry: true, food: "zero" },
    ],
  });
  assert.equal(draft.kcalUnit, null);
  assert.equal(draft.ingredients[3].food, null, "un id nutrition inventé est retiré");

  const library: LibraryRecipe[] = [
    { id: "1", slug: "colombo-porc", name: "Colombo de porc", ingredients: [{ item: "Échine", food: "echine_porc", grams: 1000, units: null, pantry: false }] },
  ];
  const v = await verifyRecipe({ draft, original, library, resolve: fakeResolve });

  // Introuvable et indispensable : bloquant.
  const goji = v.rows.find((r) => r.after?.item === "Baies de goji")!;
  assert.equal(goji.status, "added");
  assert.equal(goji.check?.state, "replace");
  assert.deepEqual(v.blocked, ["Baies de goji"]);
  // En rupture mais facultatif : signalé, pas bloquant.
  const creme = v.rows.find((r) => r.after?.item === "Crème légère")!;
  assert.equal(creme.status, "changed");
  assert.equal(creme.check?.state, "warn");
  // Ingrédient inchangé : repassé au catalogue lui aussi (rupture, produits associés), sans reste de paquet compté.
  const oignons = v.rows.find((r) => r.after?.item === "Oignons")!;
  assert.equal(oignons.status, "same");
  assert.equal(oignons.check?.state, "ok");
  assert.equal(oignons.check?.association, "none");
  assert.ok(v.unassociated.includes("Oignons"));

  // Nutrition recalculée en code, depuis les grammes.
  const n = computeNutrition(draft.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null })), 9);
  assert.equal(v.after.lead.kcal, Math.round(n.perUnit.kcal * SAMPLE_HOUSEHOLD[0].units));
  assert.equal(v.after.people.length, SAMPLE_HOUSEHOLD.length);
  assert.ok(v.before && v.before.lead.kcal > v.after.lead.kcal);

  // Jambonneau : 400 g utilisés sur une barquette de 600 g → 200 g restants, une recette proposée.
  const left = v.leftovers.find((l) => l.item === "Jambonneau")!;
  assert.equal(left.restG, 200);
  assert.deepEqual(left.suggestions.map((s) => s.slug), ["colombo-porc"]);
});

test("doublon : même nom ou mêmes ingrédients principaux", () => {
  const library: LibraryRecipe[] = [
    {
      id: "1",
      slug: "pasta-al-forno",
      name: "Pasta al forno poulet ricotta",
      ingredients: [
        { item: "Rigatoni", food: "pates", grams: 500, units: null, pantry: false },
        { item: "Filets de poulet", food: "filet_poulet", grams: 600, units: null, pantry: false },
        { item: "Ricotta", food: "ricotta", grams: 500, units: null, pantry: false },
      ],
    },
  ];
  const ing = (item: string, food: string, grams: number) => ({ lineRaw: `${grams} g ${item}`, item, food, grams });
  const same = RecipeInput.parse({
    slug: "x",
    name: "Gratin de pâtes au poulet",
    servingsUnits: 9,
    ingredients: [ing("Poulet", "filet_poulet", 700), ing("Penne", "pates", 500), ing("Ricotta", "ricotta", 400)],
    steps: [],
  });
  assert.equal(findDuplicate(same, library)?.slug, "pasta-al-forno");
  const byName = RecipeInput.parse({ slug: "y", name: "Pasta al forno au poulet et ricotta", servingsUnits: 9, ingredients: [ing("Porc", "saute_porc", 800)], steps: [] });
  assert.equal(findDuplicate(byName, library)?.slug, "pasta-al-forno");
  const other = RecipeInput.parse({
    slug: "z",
    name: "Colombo de porc",
    servingsUnits: 9,
    ingredients: [ing("Échine", "echine_porc", 1000), ing("Pommes de terre", "pomme_de_terre", 600), ing("Oignons", "oignon", 300)],
    steps: [],
  });
  assert.equal(findDuplicate(other, library), null);
});

test("ajuster : appel IA simulé, journal ai_calls, enregistrement sans écraser l'original", async () => {
  const { db } = openDb(":memory:");
  upsertRecipe(db, original);
  let sent: Record<string, unknown> | null = null;
  const fake: AiClient = {
    messages: {
      parse: async (params) => {
        sent = params;
        const r = toAiRecipe(original);
        r.ingredients[0] = { ...r.ingredients[0], lineRaw: "400 g jambonneau", grams: 400 };
        return {
          usage: { input_tokens: 5000, output_tokens: 3000 },
          stop_reason: "end_turn",
          parsed_output: { recipe: { ...r, slug: "allegee" }, explanation: "Moins de viande.", changes: ["Jambonneau −200 g"] },
        };
      },
    },
  };
  setAiClient(fake);
  process.env.AI_MONTHLY_CAP_USD = "30";
  try {
    const options = adjustOptions(original);
    assert.ok(options.some((o) => o.id === "moins-kcal"));
    const p = await proposeAdjustment(db, original.slug, { optionId: "moins-kcal" }, { resolve: fakeResolve });
    assert.equal((sent as { model?: string } | null)?.model, "claude-sonnet-5-5");
    assert.equal(p.verification.leftovers[0]?.restG, 200);
    const call = db.select().from(aiCalls).all();
    assert.equal(call.length, 1);
    assert.equal(call[0].screen, "ajuster");
    assert.ok(call[0].costUsd > 0.03 && call[0].costUsd < 0.05);

    const slug = saveDraft(db, p.draft, { parent: { slug: original.slug, name: original.name }, origin: "ajuster", explanation: p.explanation });
    assert.equal(slug, "jambonneau-lentilles-allegee");
    const again = saveDraft(db, p.draft, { parent: { slug: original.slug, name: original.name }, origin: "ajuster" });
    assert.equal(again, "jambonneau-lentilles-allegee-2", "jamais d'écrasement");
    const { loadRecipeInput } = await import("@/lib/atelier");
    assert.equal(loadRecipeInput(db, original.slug)?.ingredients[0].grams, 600, "l'original est intact");
    const saved = loadRecipeInput(db, slug)!;
    assert.equal(saved.status, "to_try");
    assert.ok(saved.tags.includes("variante"));
  } finally {
    setAiClient(null);
  }
});

test("rendement : repris de l'original pour les ingrédients appariés", async () => {
  const { carryYield } = await import("@/lib/atelier/verify");
  const before = [{ lineRaw: "1 kg poulet", item: "Poulet", grams: 1000, food: "filet_poulet", yield: { trimPct: 10, usedPct: 50 } }];
  const same = carryYield(before, [{ lineRaw: "1 kg poulet", item: "Poulet", grams: 1000, food: "filet_poulet" }]);
  assert.deepEqual(same[0].yield, { trimPct: 10, usedPct: 50 });
  const less = carryYield(before, [{ lineRaw: "800 g poulet", item: "Poulet", grams: 800, food: "filet_poulet" }]);
  assert.deepEqual(less[0].yield, { trimPct: 10 }, "la part du paquet ne suit pas une nouvelle quantité");
});

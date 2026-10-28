// Produits du drive associés aux ingrédients : une association est partagée entre les recettes
// (et les recettes futures), un refus est respecté par la liste de courses, le préféré passe
// d'abord, un réglage propre au plat prime, et la vérification de l'atelier regarde tous les ingrédients.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { recipeIngredients, recipes, shoppingItems } from "@/lib/db/schema";
import type { ResolveResponse, ResolvedProduct } from "@/lib/chronocatalog";
import { ALL, associationKey, prefsFor, rankForNeed } from "@/lib/products/core";
import { acceptProduct, dropOverride, loadAssociations, refuseProduct, setPreferred, startOverride } from "@/lib/products/store";
import { ingredientState } from "@/lib/products/fiche";
import { buildShoppingList, planList, type Ing } from "@/lib/shopping/build";
import { pickProduct } from "@/lib/shopping/rules";
import { verifyRecipe } from "@/lib/atelier/verify";
import { RecipeInput } from "@/lib/recipes/format";

const card = (id: string, name: string, weightG: number, price: number, status: "available" | "out_of_stock" = "available"): ResolvedProduct => ({
  id,
  name,
  slug: id,
  productUrl: `https://example.test/${id}`,
  imageUrl: null,
  brandName: null,
  quantityLabel: weightG === 180 ? "1 pièce" : `${weightG} g`,
  weightG,
  isFrozen: false,
  currentPrice: price,
  currentPricePerKg: Math.round((price / weightG) * 100000) / 100,
  promoPriceEur: null,
  stockStatus: status === "available" ? "HIGH_STOCK" : "NO_STOCK",
  source: "chronodrive",
  isFavorite: false,
  availability: { status, stockStatus: null, label: null, remainingStock: null, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 1, stale: false },
});

// Catalogue : oignon jaune en filet de 1 kg (le premier du catalogue), bio 1 kg, à la pièce ;
// tomates : pulpe et concassée. Les quantités sont lues dans la ligne, comme /resolve.
const FILET = card("oi-filet", "Oignon jaune filet 1 kg", 1000, 2.47);
const BIO = card("oi-bio", "Oignon jaune bio 1 kg", 1000, 2.99);
const PIECE = card("oi-piece", "Oignon jaune bio à la pièce", 180, 0.79);
const PULPE = card("to-pulpe", "Pulpe de tomates 3 × 400 g", 1200, 2.35);
const CONCASSEE = card("to-conc", "Tomates concassées 400 g", 400, 1.1);
let catalog = { oignon: [FILET, BIO, PIECE], tomate: [PULPE, CONCASSEE] };

const fakeResolve = async (q: string): Promise<ResolveResponse> => {
  const s = q.toLowerCase();
  const g = Number(s.match(/^(\d+)\s*g\b/)?.[1] ?? NaN);
  const n = Number(s.match(/^(\d+)\s+(?!g\b)/)?.[1] ?? NaN);
  const quantity = { value: g || n || 0, unit: g ? "g" : "piece", grams: g || (n ? n * 150 : null), pieces: g ? null : n || null, basis: "test" };
  if (s.includes("oignon"))
    return { query: q, source: "test", matchedTypes: [{ id: "t1", slug: "oignon_jaune", name: "Oignon jaune", broadCategory: "legume", unit: "kg", products: catalog.oignon }], quantity };
  if (s.includes("tomate"))
    return { query: q, source: "test", matchedTypes: [{ id: "t2", slug: "tomates_concassees", name: "Tomates concassées", broadCategory: "legume", unit: "kg", products: catalog.tomate }], quantity };
  return { query: q, source: "test", matchedTypes: [], none: { reason: "no_match", why: "test" } };
};

function db() {
  return openDb(":memory:").db;
}

function addRecipe(d: ReturnType<typeof db>, slug: string, lines: { lineRaw: string; item: string; grams?: number; units?: number; food?: string }[]) {
  const id = randomUUID();
  d.insert(recipes).values({ id, slug, name: slug, servingsUnits: 9 }).run();
  const ings = lines.map((l, k) => ({ id: randomUUID(), recipeId: id, position: k, lineRaw: l.lineRaw, item: l.item, grams: l.grams ?? null, units: l.units ?? null, foodId: l.food ?? null }));
  for (const i of ings) d.insert(recipeIngredients).values(i).run();
  return { id, ings: d.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).all() as Ing[] };
}

const OIGNON = { key: "type:oignon_jaune", label: "Oignon jaune", scope: ALL };

test("la clé d'un ingrédient : type chronocatalog, sinon aliment, sinon nom", async () => {
  assert.equal(associationKey({ item: "Oignons", foodId: "oignon" }, await fakeResolve("2 oignons")).key, "type:oignon_jaune");
  assert.equal(associationKey({ item: "Baies de goji", foodId: "goji" }, await fakeResolve("goji")).key, "food:goji");
  assert.equal(associationKey({ item: "Baies de Goji", foodId: null }, await fakeResolve("goji")).key, "item:baies de goji");
  assert.equal(associationKey({ item: "Sel", foodId: "zero" }, null).key, "item:sel");
});

test("classement pour un besoin : dispo, coût pour le besoin (format), prix au kilo", () => {
  // 2 oignons (≈ 300 g) : 2 pièces à 0,79 € coûtent moins qu'un filet de 1 kg.
  assert.deepEqual(rankForNeed([FILET, BIO, PIECE], { needG: 300, pieces: 2 }).map((r) => r.product.id), ["oi-piece", "oi-filet", "oi-bio"]);
  // 1,5 kg : deux filets (4,94 €) contre neuf pièces (7,11 €).
  assert.deepEqual(rankForNeed([PIECE, FILET], { needG: 1500 }).map((r) => r.product.id), ["oi-filet", "oi-piece"]);
  // En rupture : en dernier, même moins cher.
  const out = card("oi-x", "Oignon en rupture", 1000, 1, "out_of_stock");
  assert.equal(rankForNeed([out, BIO], { needG: 600 })[0].product.id, "oi-bio");
});

test("une association faite dans une recette vaut pour les autres, et pour une recette future", async () => {
  const d = db();
  const a = addRecipe(d, "a", [{ lineRaw: "600 g oignon jaune", item: "Oignon jaune", grams: 600, food: "oignon" }]);
  const b = addRecipe(d, "b", [{ lineRaw: "2 oignons", item: "Oignons", units: 2, food: "oignon" }]);
  // Alex accepte le bio depuis la fiche de A.
  const sa = ingredientState(a.ings[0], await fakeResolve(a.ings[0].lineRaw), loadAssociations(d));
  assert.equal(sa.view.key, "type:oignon_jaune");
  assert.equal(sa.view.accepted.length, 0);
  assert.equal(sa.view.candidates[0].id, "oi-filet", "proposition : le moins cher pour 600 g");
  acceptProduct(d, { ...sa.target, scope: ALL }, BIO);

  // La fiche de B le voit tout de suite.
  const sb = ingredientState(b.ings[0], await fakeResolve(b.ings[0].lineRaw), loadAssociations(d));
  assert.deepEqual(sb.view.accepted.map((p) => p.id), ["oi-bio"]);
  assert.equal(sb.view.scope, "all");
  assert.ok(!sb.view.candidates.some((c) => c.id === "oi-bio"), "un produit accepté n'est plus proposé");

  // Une recette créée plus tard aussi (atelier compris : même clé).
  const c = addRecipe(d, "c", [{ lineRaw: "300 g oignon émincé", item: "Oignon émincé", grams: 300 }]);
  const sc = ingredientState(c.ings[0], await fakeResolve(c.ings[0].lineRaw), loadAssociations(d));
  assert.deepEqual(sc.view.accepted.map((p) => p.id), ["oi-bio"]);

  // La liste de courses de A + B prend le bio (seul accepté), pas le premier du catalogue.
  const plan = await planList([...a.ings, ...b.ings], { resolveLine: fakeResolve, resolveTotal: fakeResolve, associations: loadAssociations(d) });
  assert.equal(plan.lines.length, 1, "les deux recettes partagent la ligne");
  assert.equal(plan.lines[0].product?.id, "oi-bio");
  assert.equal(plan.lines[0].via, "accepted");
});

test("un produit refusé n'est jamais pris par la liste, ni proposé en alternative", async () => {
  const d = db();
  const a = addRecipe(d, "a", [{ lineRaw: "600 g oignon jaune", item: "Oignon jaune", grams: 600 }]);
  // Sans association : le premier du catalogue.
  let plan = await planList(a.ings, { resolveLine: fakeResolve, resolveTotal: fakeResolve, associations: [] });
  assert.equal(plan.lines[0].product?.id, "oi-filet");
  refuseProduct(d, OIGNON, FILET);
  plan = await planList(a.ings, { resolveLine: fakeResolve, resolveTotal: fakeResolve, associations: loadAssociations(d) });
  assert.equal(plan.lines[0].product?.id, "oi-bio", "le suivant du catalogue (aucun accepté : comportement d'avant)");
  assert.ok(!plan.lines[0].alternatives.some((p) => p.id === "oi-filet"));
  // Même s'il était accepté avant : refuser le retire.
  acceptProduct(d, OIGNON, PIECE);
  refuseProduct(d, OIGNON, PIECE);
  const p = prefsFor(loadAssociations(d), OIGNON.key);
  assert.equal(p.accepted.length, 0);
  assert.ok(p.refused.has("oi-piece") && p.refused.has("oi-filet"));
  // pickProduct seul : jamais un refusé, même s'il est le seul usable.
  const pick = pickProduct([{ id: "t", slug: "oignon_jaune", name: "Oignon jaune", broadCategory: "legume", unit: "kg", products: [FILET, PIECE] }], { prefs: p });
  assert.equal(pick, null);

  // Bout en bout : la liste écrite en base.
  const listId = await buildShoppingList(d, ["a"], { resolveLine: fakeResolve, resolveTotal: fakeResolve });
  const items = d.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();
  assert.equal(items[0].chronoProductId, "oi-bio");
});

test("préféré : pris en premier ; indisponible, le meilleur des acceptés et une note ; les autres acceptés en alternatives", async () => {
  const d = db();
  const a = addRecipe(d, "a", [{ lineRaw: "2 oignons", item: "Oignons", units: 2 }]);
  acceptProduct(d, OIGNON, FILET);
  acceptProduct(d, OIGNON, PIECE);
  acceptProduct(d, OIGNON, BIO);
  const run = () => planList(a.ings, { resolveLine: fakeResolve, resolveTotal: fakeResolve, associations: loadAssociations(d) });
  // Sans préféré : le meilleur pour 2 oignons, à la pièce.
  let [l] = (await run()).lines;
  assert.equal(l.product?.id, "oi-piece");
  assert.equal(l.packs, 2);
  assert.deepEqual(l.alternatives.slice(0, 2).map((p) => p.id), ["oi-filet", "oi-bio"]);
  // Préféré : le bio, même plus cher.
  setPreferred(d, OIGNON, BIO, true);
  [l] = (await run()).lines;
  assert.equal(l.product?.id, "oi-bio");
  assert.equal(l.via, "preferred");
  // Le bio en rupture : le meilleur des autres acceptés, avec une note.
  catalog = { ...catalog, oignon: [FILET, card("oi-bio", "Oignon jaune bio 1 kg", 1000, 2.99, "out_of_stock"), PIECE] };
  [l] = (await run()).lines;
  assert.equal(l.product?.id, "oi-piece");
  assert.match(l.notes[0], /préféré\) indisponible/);
  catalog = { ...catalog, oignon: [FILET, BIO, PIECE] };
  // Un seul préféré par ingrédient.
  setPreferred(d, OIGNON, FILET, true);
  assert.equal(prefsFor(loadAssociations(d), OIGNON.key).preferredId, "oi-filet");
});

test("produit accepté absent de /resolve (ajouté par la recherche) : carte à jour par la recherche, sinon celle du jour du choix", async () => {
  const d = db();
  const a = addRecipe(d, "a", [{ lineRaw: "600 g oignon jaune", item: "Oignon jaune", grams: 600 }]);
  const searched = card("oi-surg", "Oignons émincés surgelés 600 g", 600, 1.99);
  acceptProduct(d, OIGNON, searched);
  let looked: string[] = [];
  const plan = await planList(a.ings, {
    resolveLine: fakeResolve,
    resolveTotal: fakeResolve,
    associations: loadAssociations(d),
    lookup: async (cards) => ((looked = cards.map((c) => c.id)), [{ ...searched, promoPriceEur: 1.5 }]),
  });
  assert.deepEqual(looked, ["oi-surg"]);
  assert.equal(plan.lines[0].product?.id, "oi-surg");
  assert.equal(plan.lines[0].product?.promoPriceEur, 1.5, "prix du jour (recherche)");
  const offline = await planList(a.ings, { resolveLine: fakeResolve, resolveTotal: fakeResolve, associations: loadAssociations(d), lookup: async () => [] });
  assert.equal(offline.lines[0].product?.id, "oi-surg", "carte du jour du choix");
});

test("réglage par recette : prime sur le commun pour ce plat seulement, et sa propre ligne de courses", async () => {
  const d = db();
  const a = addRecipe(d, "sauce", [{ lineRaw: "800 g tomates", item: "Tomates", grams: 800 }]);
  const b = addRecipe(d, "chasseur", [{ lineRaw: "400 g tomates concassées", item: "Tomates concassées", grams: 400 }]);
  const T = { key: "type:tomates_concassees", label: "Tomates concassées" };
  acceptProduct(d, { ...T, scope: ALL }, PULPE);
  // Pour le chasseur : la concassée (au départ, les produits communs sont copiés, puis Alex retire la pulpe).
  assert.equal(startOverride(d, { ...T, scope: b.ings[0].id }), 1);
  acceptProduct(d, { ...T, scope: b.ings[0].id }, CONCASSEE, { preferred: true });
  const rows = loadAssociations(d);
  assert.equal(prefsFor(rows, T.key, b.ings[0].id).scope, "recipe");
  assert.equal(prefsFor(rows, T.key, b.ings[0].id).preferredId, "to-conc");
  assert.equal(prefsFor(rows, T.key, a.ings[0].id).scope, "all");
  assert.deepEqual(prefsFor(rows, T.key, a.ings[0].id).accepted.map((p) => p.id), ["to-pulpe"]);

  const plan = await planList([...a.ings, ...b.ings], { resolveLine: fakeResolve, resolveTotal: fakeResolve, associations: rows });
  assert.equal(plan.lines.length, 2, "deux lignes : le réglage du plat a la sienne");
  const forA = plan.lines.find((l) => l.need.sources[0].ing.id === a.ings[0].id)!;
  const forB = plan.lines.find((l) => l.need.sources[0].ing.id === b.ings[0].id)!;
  assert.equal(forA.product?.id, "to-pulpe");
  assert.equal(forB.product?.id, "to-conc");
  assert.equal(forB.packs, 1);

  // Un refus commun s'applique aussi au plat, sauf si le plat l'accepte explicitement.
  refuseProduct(d, { ...T, scope: ALL }, CONCASSEE);
  assert.ok(prefsFor(loadAssociations(d), T.key, a.ings[0].id).refused.has("to-conc"));
  assert.ok(prefsFor(loadAssociations(d), T.key, b.ings[0].id).accepted.some((p) => p.id === "to-conc"), "accepté pour le plat : le plat garde son choix");
  refuseProduct(d, { ...T, scope: b.ings[0].id }, CONCASSEE);
  assert.equal(prefsFor(loadAssociations(d), T.key, b.ings[0].id).accepted.some((p) => p.id === "to-conc"), false, "refuser depuis le plat le retire aussi du plat");
  // Revenir au commun.
  dropOverride(d, T.key, b.ings[0].id);
  assert.equal(prefsFor(loadAssociations(d), T.key, b.ings[0].id).hasOverride, false);
});

test("verify : tous les ingrédients passent par les associations, ceux sans produit associé sont signalés", async () => {
  const d = db();
  acceptProduct(d, OIGNON, PIECE, { preferred: true });
  refuseProduct(d, { key: "type:tomates_concassees", label: "Tomates concassées", scope: ALL }, PULPE);
  const original = RecipeInput.parse({
    slug: "base",
    name: "Base",
    servingsUnits: 9,
    ingredients: [
      { lineRaw: "2 oignons", item: "Oignons", grams: 300, units: 2, food: "oignon" },
      { lineRaw: "800 g tomates concassées", item: "Tomates concassées", grams: 800 },
      { lineRaw: "50 g baies de goji", item: "Baies de goji", grams: 50 },
      { lineRaw: "sel", item: "Sel", pantry: true, food: "zero" },
    ],
    steps: [],
  });
  const draft = RecipeInput.parse({ ...original, slug: "variante", ingredients: original.ingredients.map((i) => (i.item === "Baies de goji" ? { ...i, grams: 80, lineRaw: "80 g baies de goji" } : i)) });
  const v = await verifyRecipe({ draft, original, library: [], resolve: fakeResolve, associations: loadAssociations(d) });
  const row = (item: string) => v.rows.find((r) => r.after?.item === item)!;
  // Oignons inchangés : vérifiés quand même, avec le produit préféré.
  assert.equal(row("Oignons").status, "same");
  assert.equal(row("Oignons").check?.association, "preferred");
  assert.equal(row("Oignons").check?.product?.id, "oi-piece");
  // Tomates inchangées : la pulpe est refusée, jamais retenue.
  assert.equal(row("Tomates concassées").check?.product?.id, "to-conc");
  assert.equal(row("Tomates concassées").check?.association, "none");
  // Signalés : les ingrédients à acheter sans produit associé (pas le placard).
  assert.deepEqual(v.unassociated, ["Tomates concassées", "Baies de goji"]);
  assert.ok(v.warnings.some((w) => w.includes("sans produit du drive associé")));
});

test("liste : « Ne correspond pas » sur une ligne refuse partout et passe au meilleur produit accepté", async () => {
  const { refuseItemProduct, acceptedForItems } = await import("@/lib/products/list");
  const d = db();
  addRecipe(d, "a", [{ lineRaw: "2 oignons", item: "Oignons", units: 2 }]);
  acceptProduct(d, OIGNON, FILET, { preferred: true });
  acceptProduct(d, OIGNON, BIO);
  const listId = await buildShoppingList(d, ["a"], { resolveLine: fakeResolve, resolveTotal: fakeResolve });
  let [it] = d.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();
  assert.equal(it.chronoProductId, "oi-filet");
  assert.equal(it.assocKey, "type:oignon_jaune");
  assert.deepEqual(acceptedForItems(d, [it]).get(it.id)!.map((a) => [a.id, a.preferred, a.current]), [["oi-filet", true, true], ["oi-bio", false, false]]);
  const r = refuseItemProduct(d, it.id);
  assert.equal(r.next, BIO.name);
  [it] = d.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();
  assert.equal(it.chronoProductId, "oi-bio");
  assert.ok(!((it.alternativesJson ?? []) as ResolvedProduct[]).some((p) => p.id === "oi-filet"), "le refusé ne revient pas en alternative");
  assert.ok(prefsFor(loadAssociations(d), OIGNON.key).refused.has("oi-filet"));
});

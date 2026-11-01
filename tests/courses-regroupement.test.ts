// Un même aliment demandé par plusieurs recettes : une ligne de courses, quantité totale dans une
// unité commune, détail par recette ; deux unités qui ne s'additionnent pas restent côte à côte ;
// avec le catalogue, paquets et manques au panier suivent la ligne regroupée (src/lib/shopping/merge.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { recipeIngredients, recipes, shoppingItems, shoppingItemSources } from "@/lib/db/schema";
import { bootstrap } from "@/seed/bootstrap";
import type { CartAddResult, ResolveResponse, ResolvedProduct } from "@/lib/chronocatalog";
import { buildShoppingList, planList, type Ing } from "@/lib/shopping/build";
import { clusterRows, nameKey, partition, perRecipe, pieceUnit, qtyLabel, sourceQty, total } from "@/lib/shopping/merge";
import { cartPayload, pickSubstitute, shortfalls } from "@/lib/shopping/drive";

let n = 0;
const ing = (recipeId: string, lineRaw: string, item: string, grams: number | null, units: number | null, foodId: string | null = "ail"): Ing => ({
  id: `${recipeId}-i${++n}`, recipeId, position: n, lineRaw, item, grams, units, group: null, optional: false, pantry: false, side: false, foodId, yield: null,
});

/** Sans catalogue : rien n'est reconnu (comme chronocatalog.ts sans CHRONOCATALOG_URL). */
const offline = async (q: string): Promise<ResolveResponse> => ({ query: q, source: "offline", matchedTypes: [], none: null });

test("le nom d'achat : sans préparation, parenthèses, quantité, accents ni pluriel", () => {
  for (const s of ["Ail, haché", "Ail, râpé", "Ail, haché (3 pour la sauce, 2 pour le porc)", "Ail, écrasé"]) assert.equal(nameKey(s), "ail");
  for (const s of ["Oignons, émincés", "Oignon, haché fin", "½ oignon, en lamelles"]) assert.equal(nameKey(s), "oignon");
  assert.equal(nameKey("Oignon rouge, en quartiers"), "oignon rouge");
  assert.equal(nameKey("Échalotes, ciselées"), nameKey("Échalote"));
  assert.equal(nameKey("Pulpe de tomate (4 boîtes) : 2 dans la bolognaise, 2 pour le fond"), nameKey("Pulpe de tomate (1 boîte)"));
  assert.notEqual(nameKey("Pulpe de tomates concassées"), nameKey("Pulpe de tomate"));
  assert.equal(pieceUnit("3 gousses d'ail"), "gousse");
  assert.equal(pieceUnit("1 gousse d’ail"), "gousse");
  assert.equal(pieceUnit("1 tête d'ail"), "tête");
  assert.equal(pieceUnit("2 oignons"), null);
});

test("quantité lisible et détail par recette", () => {
  assert.equal(qtyLabel({ grams: 35, pieces: 7, unit: "gousse", allPieces: true }), "7 gousses");
  assert.equal(qtyLabel({ grams: 5, pieces: 1, unit: "gousse", allPieces: true }), "1 gousse");
  assert.equal(qtyLabel({ grams: 450, pieces: 3, unit: null, allPieces: true }), "3");
  assert.equal(qtyLabel({ grams: 350, pieces: null, unit: null, allPieces: false }), "350 g");
  assert.equal(qtyLabel({ grams: 1200, pieces: null, unit: null, allPieces: false }), "1,2 kg");
  assert.equal(qtyLabel({ grams: null, pieces: null, unit: null, allPieces: false }), null);
  const g = (pieces: number) => ({ grams: null, pieces, unit: "gousse", pieceG: 5 });
  assert.equal(perRecipe([{ recipe: "Colombo", qty: g(2) }, { recipe: "Dahl", qty: g(1) }]), "2 gousses pour Colombo, 1 pour Dahl");
  const w = (grams: number) => ({ grams, pieces: null, unit: null, pieceG: null });
  assert.equal(perRecipe([{ recipe: "A", qty: w(300) }, { recipe: "B", qty: w(200) }]), "300 g pour A, 200 g pour B");
});

test("sans catalogue : l'ail de trois recettes fait une ligne, en gousses, les grammes convertis", async () => {
  const lines = [ing("r1", "3 gousses d'ail", "Ail, haché", null, 3), ing("r2", "4 gousses d'ail", "Ail, râpé", null, 4), ing("r3", "20 g ail", "Ail, écrasé", 20, null)];
  const plan = await planList(lines, { resolveLine: offline, resolveTotal: offline });
  assert.equal(plan.lines.length, 1);
  const need = plan.lines[0].need;
  assert.equal(need.label, "Ail");
  assert.equal(need.allPieces, true);
  assert.equal(need.unit, "gousse");
  assert.equal(need.pieces, 11, "3 + 4 + 20 g (4 gousses de 5 g)");
  assert.equal(need.grams, 55);
  assert.deepEqual([...need.recipeIds], ["r1", "r2", "r3"]);
  assert.equal(need.sources.length, 3);
  // Mêmes unités : la somme.
  const same = await planList(lines.slice(0, 2), { resolveLine: offline, resolveTotal: offline });
  assert.equal(same.lines.length, 1);
  assert.equal(qtyLabel(same.lines[0].need), "7 gousses");
  // Des oignons au poids et à la pièce : au poids, comme avant.
  const onions = await planList([ing("r1", "2 oignons", "Oignons, émincés", 300, 2, "oignon"), ing("r2", "200 g oignon", "Oignon, haché", 200, null, "oignon")], { resolveLine: offline, resolveTotal: offline });
  assert.equal(onions.lines.length, 1);
  assert.equal(onions.lines[0].need.allPieces, false);
  assert.equal(onions.lines[0].need.grams, 500);
  // Un autre aliment reste une autre ligne.
  const red = await planList([ing("r1", "1 oignon", "Oignon, haché", 150, 1, "oignon"), ing("r2", "1 oignon rouge", "Oignon rouge, en quartiers", 150, 1, "oignon")], { resolveLine: offline, resolveTotal: offline });
  assert.equal(red.lines.length, 2);
});

test("unités qui ne s'additionnent pas : deux lignes, côte à côte", async () => {
  // Une tête d'ail (pas de poids connu) et des grammes : jamais une somme fausse.
  const lines = [ing("r1", "1 tête d'ail", "Ail", null, 1), ing("r2", "Persil", "Persil", null, null, "zero"), ing("r3", "20 g ail", "Ail, haché", 20, null)];
  assert.deepEqual(partition([sourceQty({ lineRaw: "1 tête d'ail", grams: null, units: 1 }, "ail"), sourceQty({ lineRaw: "20 g ail", grams: 20, units: null }, "ail")]), [[0], [1]]);
  const plan = await planList(lines, { resolveLine: offline, resolveTotal: offline });
  const ail = plan.lines.filter((l) => nameKey(l.need.label) === "ail");
  assert.equal(ail.length, 2);
  assert.deepEqual(ail.map((l) => l.need.key).sort(), ["item:ail", "item:ail#1"]);
  assert.deepEqual(ail.map((l) => qtyLabel(l.need)).sort(), ["1 tête", "20 g"].sort());
  // Dans la liste (et pour une liste enregistrée avant le regroupement), elles se suivent.
  const rows = clusterRows(["Ail, haché", "Persil", "Ail", "Ail, râpé"], nameKey);
  assert.deepEqual(rows.map((r) => [r.row, r.cont]), [["Ail, haché", false], ["Ail", true], ["Ail, râpé", true], ["Persil", false]]);
});

// ─── Avec le catalogue ───

const card = (id: string, weightG: number, price: number): ResolvedProduct => ({
  id, name: `Ail ${id}`, slug: id, productUrl: `https://example.test/${id}-P1`, imageUrl: null, brandName: null, quantityLabel: `${weightG} g`, weightG, isFrozen: false,
  currentPrice: price, currentPricePerKg: null, promoPriceEur: null, stockStatus: "HIGH_STOCK", source: "chronodrive", isFavorite: false,
});
const TETE = card("ail-tete", 50, 0.6);
const FILET = card("ail-filet", 250, 1.9);

/** Le catalogue lit la ligne : « N gousses » (5 g la gousse), « N g » ; un type « Ail ». */
const withCatalog = async (q: string): Promise<ResolveResponse> => {
  const s = q.toLowerCase();
  const g = Number(s.match(/^(\d+)\s*g\b/)?.[1] ?? NaN);
  const pc = Number(s.match(/^(\d+)\s+(?!g\b)/)?.[1] ?? NaN);
  const quantity = { value: g || pc || 0, unit: g ? "g" : "piece", grams: g || (pc ? pc * 5 : null), pieces: g ? null : pc || null, basis: "test" };
  if (!s.includes("ail")) return { query: q, source: "test", matchedTypes: [], none: { reason: "no_match", why: "test" } };
  return { query: q, source: "test", matchedTypes: [{ id: "t", slug: "ail", name: "Ail", broadCategory: "legume", unit: "kg", products: [TETE, FILET] }], quantity };
};

test("catalogue : une ligne regroupée, paquets sur le total, manques et remplaçant justes", async () => {
  const lines = [ing("r1", "6 gousses d'ail", "Ail, haché", null, 6), ing("r2", "4 gousses d'ail", "Ail, râpé", null, 4), ing("r3", "3 gousses d'ail", "Ail, écrasé", null, 3)];
  const plan = await planList(lines, { resolveLine: withCatalog, resolveTotal: withCatalog });
  assert.equal(plan.lines.length, 1);
  const l = plan.lines[0];
  assert.equal(l.need.key, "type:ail");
  assert.equal(l.need.pieces, 13);
  assert.equal(l.needG, 65);
  assert.equal(l.product?.id, "ail-tete");
  assert.equal(l.packs, 2, "65 g en têtes de 50 g");
  // Le panier ne prend qu'une tête : 50 g manquent sur la seule ligne, le filet de 250 g complète.
  const items = [{ id: "ail", pantry: false, packs: l.packs, productJson: l.product, needG: l.needG }];
  assert.deepEqual(cartPayload(items), [{ productId: "ail-tete", quantity: 2 }]);
  const result: CartAddResult = { lines: [{ refs: ["ail-tete"], requested: 2, after: 1, outcome: "partial", chronoId: "P1" }], summary: {} } as unknown as CartAddResult;
  const sf = shortfalls(items, result);
  assert.deepEqual(sf, [{ productId: "ail-tete", itemIds: ["ail"], wanted: 2, inCart: 1, missingG: 50 }]);
  assert.equal(pickSubstitute(sf[0].missingG, TETE, [TETE, FILET])?.product.id, "ail-filet");
});

test("en base : une ligne d'ail pour trois recettes du carnet, ses sources par recette, quantité relue", async () => {
  const { db } = openDb(":memory:");
  bootstrap(db);
  const slugs = ["colombo-porc", "dahl-pois-casses-poulet", "butter-chicken-express"];
  const id = await buildShoppingList(db, slugs, { resolveLine: offline, resolveTotal: offline });
  const items = db.select().from(shoppingItems).where(eq(shoppingItems.listId, id)).all();
  const ail = items.filter((i) => !i.pantry && nameKey(i.item) === "ail");
  assert.equal(ail.length, 1, "une seule ligne « Ail »");
  const src = db
    .select({ recipeId: shoppingItemSources.recipeId, lineRaw: shoppingItemSources.lineRaw, grams: shoppingItemSources.grams, units: shoppingItemSources.units, foodId: recipeIngredients.foodId })
    .from(shoppingItemSources)
    .leftJoin(recipeIngredients, eq(recipeIngredients.id, shoppingItemSources.recipeIngredientId))
    .where(eq(shoppingItemSources.itemId, ail[0].id))
    .all();
  const rs = db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(inArray(recipes.slug, slugs)).all();
  assert.equal(new Set(src.map((s) => s.recipeId)).size, 3);
  const units = src.reduce((t, s) => t + (s.units ?? 0), 0);
  assert.equal(qtyLabel(total(src.map((s) => sourceQty(s, s.foodId)))), `${units} gousses`);
  const detail = perRecipe(src.map((s) => ({ recipe: rs.find((r) => r.id === s.recipeId)!.name, qty: sourceQty(s, s.foodId) })))!;
  assert.equal(detail.match(/ pour /g)?.length, 3);
  assert.match(detail, /^\d+ gousses? pour .+, \d+ pour .+, \d+ pour .+$/);
});

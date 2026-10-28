// Achats, placard, cuissons et coûts sur une base en mémoire (sans chronocatalog).
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/lib/db/open";
import { cookUsages, pantryLots, people, purchases, recipeIngredients, recipes, shoppingItems, shoppingItemSources, shoppingLists } from "@/lib/db/schema";
import type { ResolvedProduct } from "@/lib/chronocatalog";
import { setInCart, setPacks, undoOrder, validateOrder } from "@/lib/shopping/cart";
import { orderedIngredientsFor } from "@/lib/shopping/ordered";
import { closeLot, cookRecipe, planCookUsage, recipeCost, recordCookUsage } from "@/lib/costs";

const product = (id: string, weightG: number | null, price: number, promo: number | null = null): ResolvedProduct => ({
  id,
  name: `Produit ${id}`,
  slug: id,
  productUrl: "https://example.test/" + id,
  imageUrl: null,
  brandName: "MARQUE",
  quantityLabel: weightG ? `${weightG} g` : "x1",
  weightG,
  isFrozen: false,
  currentPrice: price,
  currentPricePerKg: null,
  promoPriceEur: promo,
  stockStatus: "HIGH_STOCK",
  source: "chronodrive",
  isFavorite: false,
  availability: { status: "available", stockStatus: "HIGH_STOCK", label: null, remainingStock: null, maxQuantity: 3, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 0, stale: false },
});

/**
 * Deux recettes de 10 unités :
 *  - A : 600 g de riz, 300 g de porc ; B : 400 g de riz.
 *  - riz : paquets de 1 kg à 2 € → 1 paquet partagé (A 60 %, B 40 %).
 *  - porc : barquettes de 500 g à 5 € (promo 4 €) → 1 barquette pour A.
 */
function setup(): { db: Db; listId: string; A: string; B: string; riz: string; porc: string } {
  const { db } = openDb(":memory:");
  db.insert(people).values([
    { id: "alex", name: "Alex", rank: 0, portionUnits: 5 },
    { id: "sam", name: "Sam", rank: 1, portionUnits: 4 },
  ]).run();
  db.insert(recipes).values([
    { id: "A", name: "Recette A", slug: "a", servingsUnits: 10 },
    { id: "B", name: "Recette B", slug: "b", servingsUnits: 10 },
  ]).run();
  db.insert(recipeIngredients).values([
    { id: "a-riz", recipeId: "A", position: 0, lineRaw: "600 g riz", item: "Riz", grams: 600 },
    { id: "a-porc", recipeId: "A", position: 1, lineRaw: "300 g porc", item: "Porc", grams: 300 },
    { id: "b-riz", recipeId: "B", position: 0, lineRaw: "400 g riz", item: "Riz", grams: 400 },
  ]).run();
  db.insert(shoppingLists).values({ id: "L", title: "A + B", recipeSlugs: ["a", "b"], buildDone: 3, buildTotal: 3 }).run();
  const riz = product("riz", 1000, 2);
  const porc = product("porc", 500, 5, 4);
  db.insert(shoppingItems).values([
    { id: "i-riz", listId: "L", item: "Riz", needG: 1000, recipeIds: ["A", "B"], chronoProductId: "riz", packs: 1, unitPrice: 2, totalPrice: 2, productJson: riz, state: "ok", aisle: "Épicerie" },
    { id: "i-porc", listId: "L", item: "Porc", needG: 300, recipeIds: ["A"], chronoProductId: "porc", packs: 1, unitPrice: 4, totalPrice: 4, productJson: porc, state: "ok", aisle: "Boucherie" },
  ]).run();
  db.insert(shoppingItemSources).values([
    { id: "s1", itemId: "i-riz", recipeIngredientId: "a-riz", recipeId: "A", lineRaw: "600 g riz", grams: 600 },
    { id: "s2", itemId: "i-riz", recipeIngredientId: "b-riz", recipeId: "B", lineRaw: "400 g riz", grams: 400 },
    { id: "s3", itemId: "i-porc", recipeIngredientId: "a-porc", recipeId: "A", lineRaw: "300 g porc", grams: 300 },
  ]).run();
  return { db, listId: "L", A: "A", B: "B", riz: "i-riz", porc: "i-porc" };
}

test("estimé avant la commande : théorique au prorata, pratique en paquets entiers", () => {
  const { db, A } = setup();
  const c = recipeCost(db, A)!;
  assert.equal(c.kind, "estimate");
  // théorique : 600 g × 0,002 + 300 g × 0,008 = 1,20 + 2,40 ; pratique : 60 % × 2 + 4
  assert.deepEqual(c.batch, { theoretical: 3.6, practical: 5.2 });
  assert.deepEqual(c.partLead, { theoretical: 1.8, practical: 2.6 }); // 5 unités sur 10
  assert.deepEqual(c.parts.map((p) => p.personId), ["alex", "sam"]);
  assert.equal(c.waste, 1.6);
});

test("+/− paquets : la limite par commande colore la pastille", () => {
  const { db, riz } = setup();
  setPacks(db, riz, 4);
  const it = db.select().from(shoppingItems).where(eq(shoppingItems.id, riz)).get()!;
  assert.equal(it.packs, 4);
  assert.equal(it.totalPrice, 8);
  assert.equal(it.state, "ko");
  setPacks(db, riz, 1);
});

test("valider la commande : seules les lignes cochées, prix effectif, lots créés, liste figée", () => {
  const { db, listId, porc } = setup();
  setInCart(db, porc, true);
  const r = validateOrder(db, listId, "2026-10-20T10:00:00.000Z");
  assert.deepEqual(r, { purchases: 1, total: 4, skipped: 1, unpriced: 0 });
  const p = db.select().from(purchases).all();
  assert.equal(p[0].pricePaid, 4);
  assert.equal(p[0].promo, true);
  assert.equal(p[0].packG, 500);
  const lot = db.select().from(pantryLots).all()[0];
  assert.equal(lot.gramsLeft, 500);
  assert.equal(lot.valueInitial, 4);
  assert.equal(db.select().from(shoppingLists).get()!.status, "ordered");
  assert.throws(() => setInCart(db, porc, false), /déjà validée/);
  undoOrder(db, listId);
  assert.equal(db.select().from(purchases).all().length, 0);
  assert.equal(db.select().from(shoppingLists).get()!.status, "draft");
});

test("orderedIngredientsFor : produit commandé par ligne de recette, manque et surplus", () => {
  const { db, listId } = setup();
  validateOrder(db, listId); // rien de coché : tout est acheté
  const [a, b] = orderedIngredientsFor(db, listId);
  assert.equal(a.slug, "a");
  const rizA = a.ingredients.find((i) => i.recipeIngredientId === "a-riz")!;
  assert.equal(rizA.product?.name, "Produit riz");
  assert.equal(rizA.boughtG, 600);
  assert.equal(rizA.status, "ok");
  const porcA = a.ingredients.find((i) => i.recipeIngredientId === "a-porc")!;
  assert.equal(porcA.status, "surplus"); // 500 g pour 300 g : 200 g au placard
  assert.equal(porcA.gapG, 200);
  assert.equal(b.ingredients[0].boughtG, 400);
  assert.equal(a.suggestedUnits, 10);
});

test("orderedIngredientsFor : un manque propose moins d'unités au prorata", () => {
  const { db, listId, riz } = setup();
  db.update(shoppingItems).set({ productJson: product("riz", 500, 1.2), packs: 1 }).where(eq(shoppingItems.id, riz)).run();
  const [a] = orderedIngredientsFor(db, listId);
  const rizA = a.ingredients.find((i) => i.recipeIngredientId === "a-riz")!;
  assert.equal(rizA.status, "short"); // 300 g sur 600
  assert.equal(a.coverage, 0.5);
  assert.equal(a.suggestedUnits, 5);
});

test("j'ai cuisiné : lots décrémentés au prorata, coût réel, reste perdu compté à la recette", () => {
  const { db, listId, A, B } = setup();
  validateOrder(db, listId);
  const plan = planCookUsage(db, A);
  assert.deepEqual(
    plan.map((p) => [p.item, p.grams, p.value, p.source]),
    [["Riz", 600, 1.2, "lot"], ["Porc", 300, 2.4, "lot"]]
  );
  const r = cookRecipe(db, A);
  assert.equal(r.total, 3.6);
  const lots = new Map(db.select().from(pantryLots).all().map((l) => [l.item, l]));
  assert.equal(lots.get("Riz")!.gramsLeft, 400);
  assert.equal(lots.get("Porc")!.gramsLeft, 200);
  assert.equal(lots.get("Porc")!.valueLeft, 1.6);

  let c = recipeCost(db, A)!;
  assert.equal(c.kind, "real");
  assert.deepEqual(c.batch, { theoretical: 3.6, practical: 3.6 }); // le reste de porc servira ailleurs

  closeLot(db, lots.get("Porc")!.id, "lost");
  c = recipeCost(db, A)!;
  assert.deepEqual(c.batch, { theoretical: 3.6, practical: 5.2 }); // le porc jeté revient à A
  assert.equal(c.waste, 1.6);

  // B prend le reste du riz : le lot est vidé et passe en « used ».
  cookRecipe(db, B);
  const rizLot = db.select().from(pantryLots).where(eq(pantryLots.item, "Riz")).get()!;
  assert.equal(rizLot.status, "used");
  assert.equal(rizLot.gramsLeft, 0);
  assert.deepEqual(recipeCost(db, B)!.batch, { theoretical: 0.8, practical: 0.8 });
});

test("recordCookUsage sans session ni lot : prix du catalogue, puis refus d'un lot clos", () => {
  const { db, listId, A } = setup();
  const r = recordCookUsage(db, { recipeId: A, usages: [{ lotId: null, grams: 100, value: 0.2, item: "Riz" }] });
  assert.equal(r.total, 0.2);
  assert.equal(db.select().from(cookUsages).get()!.sessionId, null);
  validateOrder(db, listId);
  const lot = db.select().from(pantryLots).get()!;
  closeLot(db, lot.id, "used");
  assert.throws(() => recordCookUsage(db, { recipeId: A, usages: [{ lotId: lot.id, grams: 10 }] }), /déjà utilisé/);
});

test("lot sans poids connu : consommé en entier", () => {
  const { db, listId, A, porc } = setup();
  db.update(shoppingItems).set({ productJson: product("porc", null, 4), needG: null }).where(eq(shoppingItems.id, porc)).run();
  db.update(shoppingItemSources).set({ grams: null }).where(eq(shoppingItemSources.id, "s3")).run();
  validateOrder(db, listId);
  const lot = db.select().from(pantryLots).where(eq(pantryLots.item, "Porc")).get()!;
  assert.equal(lot.gramsInitial, 0);
  cookRecipe(db, A);
  const after = db.select().from(pantryLots).where(eq(pantryLots.id, lot.id)).get()!;
  assert.equal(after.status, "used");
  assert.equal(after.valueLeft, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { pantryLots, purchases, shoppingItems, shoppingLists } from "@/lib/db/schema";
import type { CartAddResult, ChronoOrder, ResolvedProduct } from "@/lib/chronocatalog";
import { applyOrder, cartPayload, cartUpdates, chronoIdFromUrl, completeShortfalls, matchOrder, orderSummary, orderUpdates, pickSubstitute, shortfalls } from "@/lib/shopping/drive";

const product = (id: string, chrono: string, weightG: number, price: number, source: "chronodrive" | "manual" = "chronodrive"): ResolvedProduct => ({
  id,
  name: `Produit ${id}`,
  slug: id,
  productUrl: `https://www.chronodrive.com/auchan--produit-${chrono}`,
  imageUrl: null,
  brandName: null,
  quantityLabel: `${weightG} g`,
  weightG,
  isFrozen: false,
  currentPrice: price,
  currentPricePerKg: null,
  promoPriceEur: null,
  stockStatus: "HIGH_STOCK",
  source,
  isFavorite: false,
});

const items = [
  { id: "i1", pantry: false, packs: 2, productJson: product("u-riz", "P100", 1000, 2) },
  { id: "i2", pantry: false, packs: 1, productJson: product("u-porc", "P200", 500, 5) },
  { id: "i3", pantry: false, packs: 1, productJson: product("u-riz", "P100", 1000, 2) }, // même produit qu'i1
  { id: "i4", pantry: true, packs: 1, productJson: product("u-sel", "P300", 500, 1) }, // placard
  { id: "i5", pantry: false, packs: 1, productJson: product("u-maison", "MANUAL", 100, 1, "manual") },
  { id: "i6", pantry: false, packs: 0, productJson: product("u-zero", "P400", 100, 1) },
];

test("id Chronodrive tiré de productUrl", () => {
  assert.equal(chronoIdFromUrl("https://www.chronodrive.com/auchan--filets-de-poulet-P409519"), "P409519");
  assert.equal(chronoIdFromUrl("/products/filet-de-poulet"), null);
});

test("ce qui part au panier : produits du drive, paquets cumulés, ni placard ni manuel", () => {
  assert.deepEqual(cartPayload(items), [
    { productId: "u-riz", quantity: 3 },
    { productId: "u-porc", quantity: 1 },
  ]);
});

test("rapport du panier → chaque ligne de courses", () => {
  const result: CartAddResult = {
    cartId: "c",
    totalCartAmount: 11,
    lines: [
      { chronoId: "P100", refs: ["u-riz"], wanted: 3, before: 0, sent: 3, after: 3, outcome: "added", label: null, unitPrice: 2, stock: "HIGH_STOCK", remainingStock: 9, maxCartQuantity: 99 },
      { chronoId: "P200", refs: ["u-porc"], wanted: 1, before: 0, sent: 1, after: 0, outcome: "unavailable", label: null, unitPrice: 5, stock: "NO_STOCK", remainingStock: 0, maxCartQuantity: 99 },
    ],
    summary: { added: 1, already: 0, partial: 0, unavailable: 1, failed: 0 },
    skipped: [],
  };
  const u = cartUpdates(items, result);
  assert.deepEqual(u.get("i1"), { outcome: "added", qty: 3, chronoId: "P100" });
  assert.deepEqual(u.get("i3"), { outcome: "added", qty: 3, chronoId: "P100" });
  assert.equal(u.get("i2")?.outcome, "unavailable");
  assert.equal(u.get("i5")?.outcome, "skipped");
  assert.equal(u.has("i4"), false);
});

const order = (id: string, lines: [string, number, number][], createdAt = "2026-10-26T10:00:00+01:00"): ChronoOrder => ({
  id,
  status: "DELIVERED",
  mode: "DRIVE",
  createdAt,
  withdrawalDate: null,
  total: lines.reduce((s, l) => s + l[2], 0),
  discount: 0,
  items: lines.map(([chronoId, quantity, totalAmount]) => ({ chronoId, quantity, totalAmount, unitPrice: totalAmount / quantity, label: null, brand: null, unitQuantityLabel: null })),
});

test("la commande qui ressemble le plus à la liste", () => {
  const a = order("A", [["P999", 1, 3]]);
  const b = order("B", [["P100", 2, 3.8], ["P200", 1, 4.5], ["P777", 1, 2]]);
  assert.equal(matchOrder([a, b], new Set(["P100", "P200"]))?.order.id, "B");
  assert.equal(matchOrder([a], new Set(["P100"])), null);
  const { updates, missing } = orderUpdates(
    [
      { id: "p1", chronoId: "P100", packs: 3, pricePaid: 6 },
      { id: "p2", chronoId: "P200", packs: 1, pricePaid: 5 },
      { id: "p3", chronoId: "P300", packs: 1, pricePaid: 1 },
    ],
    b
  );
  assert.deepEqual(updates.get("p1"), { packs: 2, pricePaid: 3.8 });
  assert.deepEqual(updates.get("p2"), { packs: 1, pricePaid: 4.5 });
  assert.deepEqual(missing, ["p3"]);
});

test("relire la commande : la liste est validée, les achats prennent le prix payé", () => {
  const { db } = openDb(":memory:");
  db.insert(shoppingLists).values({ id: "L", title: "Test", recipeSlugs: [], buildDone: 1, buildTotal: 1 }).run();
  db.insert(shoppingItems)
    .values([
      { id: "i1", listId: "L", item: "Riz", needG: 2000, chronoProductId: "u-riz", packs: 2, unitPrice: 2, totalPrice: 4, productJson: product("u-riz", "P100", 1000, 2), state: "ok", aisle: "Épicerie", inCartAt: "2026-10-26T09:00:00Z", chronoId: "P100" },
      { id: "i2", listId: "L", item: "Porc", needG: 500, chronoProductId: "u-porc", packs: 1, unitPrice: 5, totalPrice: 5, productJson: product("u-porc", "P200", 500, 5), state: "ok", aisle: "Boucherie", inCartAt: "2026-10-26T09:00:00Z" },
    ])
    .run();
  const msg = applyOrder(db, "L", order("B", [["P100", 2, 3.8], ["P200", 1, 4.5]]));
  assert.match(msg, /2 achats au prix payé \(8,30 €, −0,70 € sur l'estimation\)/);
  const l = db.select().from(shoppingLists).where(eq(shoppingLists.id, "L")).get()!;
  assert.equal(l.status, "ordered");
  assert.equal(l.chronoOrderId, "B");
  const ps = db.select().from(purchases).all();
  const riz = ps.find((p) => p.item === "Riz")!;
  assert.equal(riz.pricePaid, 3.8);
  assert.equal(riz.priceEstimated, 4);
  const lot = db.select().from(pantryLots).where(eq(pantryLots.purchaseId, riz.id)).get()!;
  assert.equal(lot.valueInitial, 3.8);
  assert.equal(lot.valueLeft, 3.8);
  assert.deepEqual(orderSummary(db, "L"), { paid: 8.3, estimated: 9, matched: 2, total: 2 });
});

// ─── Rupture au panier : ce qui manque est complété ───

const line = (refs: string[], wanted: number, after: number, outcome: CartAddResult["lines"][number]["outcome"]): CartAddResult["lines"][number] => ({
  chronoId: `C-${refs[0]}`, refs, wanted, before: 0, sent: wanted, after, outcome, label: null, unitPrice: null, stock: null, remainingStock: after, maxCartQuantity: 999,
});
const cartResult = (lines: CartAddResult["lines"]): CartAddResult => ({ cartId: "c", totalCartAmount: 0, lines, summary: { added: 0, already: 0, partial: 0, unavailable: 0, failed: 0 }, skipped: [] });

test("ce qui manque au panier : par produit, lignes cumulées, en grammes", () => {
  const filets = product("u-filets", "P170743", 600, 6.49);
  const its = [
    { id: "a", pantry: false, packs: 4, productJson: filets },
    { id: "b", pantry: false, packs: 3, productJson: filets }, // même produit, autre recette : 7 paquets voulus
    { id: "c", pantry: false, packs: 1, productJson: product("u-riz", "P100", 1000, 2) },
  ];
  const sf = shortfalls(its, cartResult([line(["u-filets"], 7, 4, "partial"), line(["u-riz"], 1, 1, "added")]));
  assert.deepEqual(sf, [{ productId: "u-filets", itemIds: ["a", "b"], wanted: 7, inCart: 4, missingG: 1800 }]);
});

test("remplaçant : en stock, même rayon froid, le moins cher pour les grammes manquants ; à coût égal, le grand format", () => {
  const original = product("u-filets", "P1", 600, 6.49);
  const kilo = product("u-kilo", "P2", 1000, 11.99); // 2 × 1 kg = 23,98 €
  const small = product("u-720", "P3", 720, 8.99); // 3 × 720 g = 26,97 €
  const frozen = { ...product("u-surg", "P4", 1000, 7), isFrozen: true };
  const out = { ...product("u-out", "P5", 1000, 5), stockStatus: "NO_STOCK" as const };
  const counter = { ...product("u-detail", "P6", 1000, 9.99), quantityLabel: "Au détail (au choix)" };
  assert.deepEqual(pickSubstitute(1800, original, [original, small, frozen, out, counter, kilo]), { product: kilo, packs: 2 });
  const big = product("u-2kg", "P7", 2000, 23.98); // même coût qu'2 × 1 kg, un seul paquet
  assert.equal(pickSubstitute(1800, original, [kilo, big])!.product.id, "u-2kg");
  assert.equal(pickSubstitute(1800, original, [original, frozen, out]), null);
});

test("complément : la ligne d'origine garde ce que le panier a pris, une ligne de remplaçant s'ajoute", async () => {
  const { db } = openDb(":memory:");
  db.insert(shoppingLists).values({ id: "L", title: "Test", recipeSlugs: [], buildDone: 1, buildTotal: 1 }).run();
  const filets = product("u-filets", "P170743", 600, 6.49);
  const kilo = product("u-kilo", "P2", 1000, 11.99);
  db.insert(shoppingItems)
    .values([
      { id: "a", listId: "L", item: "Filets de poulet", needG: 2400, packs: 4, productJson: filets, aisle: "Boucherie", line: "2,4 kg filets de poulet", recipeIds: ["r1"], position: 0 },
      { id: "b", listId: "L", item: "Filets de poulet", needG: 1300, packs: 3, productJson: filets, aisle: "Boucherie", line: "1,3 kg filets de poulet", recipeIds: ["r2"], position: 1 },
    ])
    .run();
  const its = db.select().from(shoppingItems).all();
  const sf = shortfalls(its, cartResult([line(["u-filets"], 7, 4, "partial")]));
  const added = await completeShortfalls(db, "L", sf, async () => ({ query: "", source: "fts", totalProducts: 2, matchedTypes: [{ id: "t", slug: "filet_poulet", name: "Filet de poulet", broadCategory: "viande", unit: "kg", products: [filets, kilo] }] }) as never);
  assert.equal(added, 1);
  const after = db.select().from(shoppingItems).all();
  assert.equal(after.find((i) => i.id === "a")!.packs, 4);
  assert.equal(after.find((i) => i.id === "b"), undefined, "la ligne que le panier n'a pas prise disparaît");
  const extra = after.find((i) => i.id !== "a" && i.id !== "b")!;
  assert.equal(extra.item, "Filets de poulet (complément)");
  assert.equal(extra.chronoProductId, "u-kilo");
  assert.equal(extra.packs, 2);
  assert.equal(extra.needG, 1800);
  assert.deepEqual(extra.recipeIds, ["r1", "r2"]);
  // Le panier renvoyé : 4 paquets d'origine (déjà dedans) et 2 de remplaçant.
  assert.deepEqual(cartPayload(after), [{ productId: "u-filets", quantity: 4 }, { productId: "u-kilo", quantity: 2 }]);
});

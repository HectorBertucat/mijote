import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { pantryLots, purchases, shoppingItems, shoppingLists } from "@/lib/db/schema";
import type { CartAddResult, ChronoOrder, ResolvedProduct } from "@/lib/chronocatalog";
import { applyOrder, cartPayload, cartUpdates, chronoIdFromUrl, matchOrder, orderSummary, orderUpdates } from "@/lib/shopping/drive";

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

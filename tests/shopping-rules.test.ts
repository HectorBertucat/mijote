import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedProduct } from "@/lib/chronocatalog";
import { aisleFor, judge, packsFor, pickProduct } from "@/lib/shopping/rules";

const prod = (over: Partial<ResolvedProduct> = {}, a: Partial<NonNullable<ResolvedProduct["availability"]>> = {}): ResolvedProduct => ({
  id: over.id ?? "p1",
  name: "Produit",
  slug: "p",
  productUrl: "https://www.chronodrive.com/x",
  imageUrl: null,
  brandName: null,
  quantityLabel: "500 g",
  weightG: 500,
  isFrozen: false,
  currentPrice: 4,
  currentPricePerKg: 8,
  promoPriceEur: null,
  stockStatus: "IN_STOCK",
  source: "chronodrive",
  isFavorite: false,
  availability: { status: "available", stockStatus: "IN_STOCK", label: null, remainingStock: 20, maxQuantity: null, isDeliverable: true, lastCheckedAt: new Date().toISOString(), ageHours: 1, stale: false, ...a },
  ...over,
});

test("vert si frais et en stock, orange si ancien, rouge si limite dépassée", () => {
  assert.equal(judge({ product: prod(), packs: 2, aisle: "Épicerie" }).state, "ok");
  assert.equal(judge({ product: prod({}, { ageHours: 8 }), packs: 2, aisle: "Épicerie" }).state, "warn");
  const ko = judge({ product: prod({}, { maxQuantity: 3 }), packs: 4, aisle: "Boucherie" });
  assert.equal(ko.state, "ko");
  assert.match(ko.warnings[0], /limité à 3/);
  assert.equal(judge({ product: null, packs: 0, aisle: "Épicerie", offline: false }).state, "ko");
  // Sans catalogue relié, une ligne sans produit est normale : à prendre en magasin.
  assert.equal(judge({ product: null, packs: 0, aisle: "Épicerie", offline: true }).state, "ok");
});

test("persil en sachets de 6 g et produit au détail : signalés", () => {
  assert.ok(judge({ product: prod({ weightG: 6, quantityLabel: "6 g" }), packs: 4, aisle: "Épicerie" }).warnings.some((w) => w.includes("petits sachets")));
  assert.ok(judge({ product: prod({ quantityLabel: "Au détail (au choix)" }), packs: 1, aisle: "Boucherie" }).warnings.some((w) => w.includes("au détail")));
});

test("on évite le produit au détail ou ancien quand le type en a un autre", () => {
  const detail = prod({ id: "d", quantityLabel: "Au détail (au choix)" }, { ageHours: 3500, stale: true });
  const barquette = prod({ id: "b", quantityLabel: "600 g", weightG: 600 });
  const pick = pickProduct([{ id: "t", slug: "filet_poulet", name: "Filet de poulet", broadCategory: "viande", unit: "kg", products: [detail, barquette] }]);
  assert.equal(pick?.product.id, "b");
  assert.equal(packsFor(barquette, 1100), 2);
  assert.equal(aisleFor("viande"), "Boucherie");
  assert.equal(aisleFor("legume", { isFrozen: true }), "Surgelés");
});

// Catalogue relié : une liste de courses faite contre le catalogue d'exemple (examples/catalogue-csv),
// servi en vrai sur un port local. Vérifie le contrat de docs/catalogue.md de bout en bout :
// /resolve (produit, paquets, prix), /search, /live, puis la validation et le coût.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { asc, eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { shoppingItems } from "@/lib/db/schema";
import { buildShoppingList, startLiveCheck } from "@/lib/shopping/build";
import { validateOrder } from "@/lib/shopping/cart";
import { catalogEnabled, resolve, search } from "@/lib/chronocatalog";
import { addPerson } from "@/lib/household";
import { syncRecipes } from "@/seed/bootstrap";
import { seedBase } from "@/seed/seed";
import { createServer, loadCsv, parseQuantity } from "../examples/catalogue-csv/server";

let server: Server;
before(async () => {
  server = createServer(loadCsv(path.join(process.cwd(), "examples/catalogue-csv/produits.csv")));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.CHRONOCATALOG_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
after(() => {
  delete process.env.CHRONOCATALOG_URL;
  server.close();
});

test("exemple : lecture des quantités en tête de ligne", () => {
  assert.deepEqual(parseQuantity("1,5 kg sauté de porc")?.grams, 1500);
  assert.deepEqual(parseQuantity("25 cl vin blanc")?.grams, 250);
  assert.deepEqual(parseQuantity("3 échalotes")?.pieces, 3);
  assert.equal(parseQuantity("sel"), null);
});

test("contrat : /resolve rend un type, des produits, l'achat en paquets entiers ; /search cherche", async () => {
  assert.ok(catalogEnabled());
  const r = await resolve("1,5 kg sauté de porc");
  assert.equal(r.matchedTypes[0]?.products[0]?.id, "p-saute-porc");
  assert.equal(r.purchase?.packs, 3);
  assert.equal(r.purchase?.totalPrice, 17.85);
  assert.equal(r.matchedTypes[0].broadCategory, "viande");
  const none = await resolve("200 g de caviar");
  assert.deepEqual(none.matchedTypes, []);
  assert.equal(none.none?.reason, "no_match");
  const s = await search("tomate");
  assert.ok(s.results.length >= 2);
});

test("liste de bout en bout avec le catalogue : produits, paquets, prix, rayons, vérification, validation", async () => {
  const { db } = openDb(":memory:");
  seedBase(db);
  syncRecipes(db, path.join(process.cwd(), "src/seed/recipes"));
  addPerson(db, { name: "Alex", portionUnits: 5 });
  const listId = await buildShoppingList(db, ["chasseur-porc"]);
  const rows = db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).orderBy(asc(shoppingItems.position)).all();
  const buy = rows.filter((r) => !r.pantry);
  const withProduct = buy.filter((r) => r.chronoProductId);
  assert.ok(withProduct.length >= buy.length - 1, `${withProduct.length}/${buy.length} lignes avec un produit`);
  const porc = buy.find((r) => r.chronoProductId === "p-saute-porc")!;
  assert.equal(porc.aisle, "Boucherie");
  assert.ok(porc.packs! >= 3 && porc.totalPrice! > 15, `${porc.packs} × ${porc.totalPrice} €`);
  assert.ok(buy.find((r) => r.chronoProductId === "p-haricots")?.aisle === "Surgelés");
  // « Vérifier en direct » : le catalogue d'exemple répond tout de suite.
  await startLiveCheck(db, listId);
  // Validation : achats aux prix du catalogue.
  const v = validateOrder(db, listId);
  assert.equal(v.purchases, withProduct.length);
  assert.ok(v.total > 25, `${v.total} €`);
  assert.equal(v.unpriced, buy.length - withProduct.length);
});

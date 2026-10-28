// Courses sans catalogue relié (le cas par défaut d'une instance neuve) : la liste se construit
// depuis les recettes, se range par rayon, se coche en magasin, les prix se saisissent ligne par ligne,
// et la validation alimente le placard et le coût des recettes. Aucun appel réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { and, asc, eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { pantryLots, purchases, recipes, shoppingItems, shoppingLists } from "@/lib/db/schema";
import { buildShoppingList } from "@/lib/shopping/build";
import { setAllInCart, setInCart, setLinePrice, undoOrder, validateOrder } from "@/lib/shopping/cart";
import { catalogEnabled, resolve, search } from "@/lib/chronocatalog";
import { guessAisle, judge } from "@/lib/shopping/rules";
import { addPerson } from "@/lib/household";
import { cookRecipe, recipeCost } from "@/lib/costs";
import { syncRecipes } from "@/seed/bootstrap";
import { seedBase } from "@/seed/seed";

delete process.env.CHRONOCATALOG_URL;

function setup() {
  const { db } = openDb(":memory:");
  seedBase(db);
  syncRecipes(db, path.join(process.cwd(), "src/seed/recipes"));
  addPerson(db, { name: "Alex", portionUnits: 5 });
  addPerson(db, { name: "Sam", portionUnits: 4 });
  return db;
}
const items = (db: ReturnType<typeof setup>, listId: string) => db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).orderBy(asc(shoppingItems.position)).all();

test("sans catalogue : le client ne fait aucun appel et répond « rien trouvé »", async () => {
  assert.equal(catalogEnabled(), false);
  const r = await resolve("500 g sauté de porc");
  assert.deepEqual(r.matchedTypes, []);
  assert.equal(r.none, null);
  assert.deepEqual((await search("porc")).results, []);
  assert.equal(judge({ product: null, packs: 0, aisle: "Épicerie" }).state, "ok", "pas de rouge partout");
});

test("rayon deviné au nom", () => {
  const cases: [string, string][] = [
    ["Sauté de porc sans os", "Boucherie"],
    ["Filet de poulet", "Boucherie"],
    ["Crème fraîche légère", "Crèmerie"],
    ["Œufs", "Crèmerie"],
    ["Ail, haché", "Fruits et légumes"],
    ["Champignons de Paris", "Fruits et légumes"],
    ["Pulpe de tomates concassées", "Épicerie"],
    ["Concentré de tomate", "Épicerie"],
    ["Haricots verts surgelés", "Surgelés"],
    ["Vin blanc sec", "Boissons"],
    ["Quelque chose d'inconnu", "Épicerie"],
  ];
  for (const [item, aisle] of cases) assert.equal(guessAisle(item), aisle, item);
});

test("liste de bout en bout : construite, rangée, cochée, payée à la main, validée, coûts réels", async () => {
  const db = setup();
  const listId = await buildShoppingList(db, ["chasseur-porc", "pasta-al-forno-saucisse-ricotta"]);
  const list = db.select().from(shoppingLists).where(eq(shoppingLists.id, listId)).get()!;
  assert.equal(list.buildError ?? null, null);
  const rows = items(db, listId);
  const buy = rows.filter((r) => !r.pantry);
  assert.ok(buy.length >= 8, `${buy.length} lignes à acheter`);
  assert.ok(rows.some((r) => r.pantry), "le placard est listé à part");
  assert.ok(buy.every((r) => r.state === "ok" && r.chronoProductId == null), "aucune ligne en rouge, aucun produit");
  assert.ok(buy.every((r) => r.needG == null || r.needG > 0));
  const aisles = new Set(buy.map((r) => r.aisle));
  assert.ok(aisles.has("Boucherie") && aisles.has("Fruits et légumes") && aisles.has("Crèmerie"), [...aisles].join(", "));
  // Le porc des deux recettes est sur une seule ligne, besoin cumulé.
  const porc = buy.filter((r) => /porc/i.test(r.item));
  assert.ok(porc.length >= 1);

  // En magasin : tout cocher, saisir deux prix, puis valider.
  setAllInCart(db, listId, true);
  assert.ok(items(db, listId).filter((r) => !r.pantry).every((r) => r.inCartAt), "« tout cocher » marche sans produit");
  setLinePrice(db, porc[0].id, 14.85);
  const champi = buy.find((r) => /champignon/i.test(r.item))!;
  setLinePrice(db, champi.id, 4.2);
  assert.throws(() => setLinePrice(db, champi.id, -1), /Prix/);
  setLinePrice(db, champi.id, null);
  setLinePrice(db, champi.id, 4.2);
  const v = validateOrder(db, listId);
  assert.equal(v.purchases, 2);
  assert.equal(v.total, 19.05);
  assert.equal(v.unpriced, buy.length - 2);
  assert.equal(db.select().from(shoppingLists).where(eq(shoppingLists.id, listId)).get()!.status, "ordered");
  assert.equal(db.select().from(purchases).where(eq(purchases.listId, listId)).all().length, 2);
  const lots = db.select().from(pantryLots).all();
  assert.equal(lots.length, 2);
  assert.ok(lots.every((l) => (l.gramsInitial ?? 0) > 0), "le lot prend le besoin de la ligne comme poids");
  assert.throws(() => setLinePrice(db, champi.id, 5), /validée/, "plus de prix après la validation");

  // Le coût des recettes suit (estimé depuis la liste), puis réel après la cuisson.
  const chasseur = db.select().from(recipes).where(eq(recipes.slug, "chasseur-porc")).get()!;
  const before = recipeCost(db, chasseur.id)!;
  assert.ok(before.parts.length === 2, "une part par personne");
  cookRecipe(db, chasseur.id);
  const after = recipeCost(db, chasseur.id)!;
  assert.equal(after.kind, "real");
  assert.ok(after.batch && after.batch.theoretical > 0, JSON.stringify(after.batch));

  // Annuler la validation rend la liste.
  const other = await buildShoppingList(db, ["porc-caramel-oeufs"]);
  setInCart(db, items(db, other).find((r) => !r.pantry)!.id, true);
  validateOrder(db, other);
  undoOrder(db, other);
  assert.equal(db.select().from(shoppingLists).where(eq(shoppingLists.id, other)).get()!.status, "draft");
});

test("une liste sans rien de coché ni de prix se valide quand même (achats sans coût)", async () => {
  const db = setup();
  const listId = await buildShoppingList(db, ["saute-minute-porc-gingembre-miel"]);
  const v = validateOrder(db, listId);
  assert.equal(v.purchases, 0);
  assert.ok(v.unpriced > 0);
  assert.ok(items(db, listId).filter((r) => !r.pantry).every((r) => r.inCartAt));
  assert.equal(db.select().from(purchases).where(and(eq(purchases.listId, listId))).all().length, 0);
});

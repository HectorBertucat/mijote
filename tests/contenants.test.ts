import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateBowls, classifyBowl, inventoryOf, type BowlNeed, type ContainerKind } from "@/lib/session/containers";
import { DEFAULT_KITCHEN, kitchenEquipment } from "@/lib/kitchen/presets";

const item = (food: string, gesture: string | null = null, label = food) => ({ food, item: label, gesture });

test("au moment ou dans un bol : la pulpe se verse au moment, la marinade et les légumes coupés vont au bol", () => {
  assert.deepEqual(classifyBowl([item("pulpe_tomate"), item("concentre_tomate"), item("miel")], { kinds: ["braise"] }), { content: "weigh", moment: true });
  // Les mêmes, versés dans une saisie qui va vite : un bol prêt d'avance.
  assert.equal(classifyBowl([item("sauce_soja"), item("miel")], { kinds: ["sear"] }).moment, false);
  assert.equal(classifyBowl([item("creme_legere")], { kinds: ["sear"] }).moment, true, "un seul ingrédient se verse toujours au moment");
  assert.deepEqual(classifyBowl([item("filet_poulet", "en morceaux"), item("skyr"), item("zero")], { kinds: ["sear"] }), { content: "meat", moment: false });
  assert.deepEqual(classifyBowl([item("oignon", "émincés"), item("ail", "râpé")], { kinds: ["braise"] }), { content: "cut", moment: false });
  assert.deepEqual(classifyBowl([item("bouillon_cube")], { kinds: ["braise"], liquidL: 1.3 }), { content: "mix", moment: false }, "bouillon délayé : un bol");
  assert.equal(classifyBowl([item("skyr"), item("zero")], { kinds: ["cool"], mixText: "skyr + ail + herbes + sel, mélangé" }).content, "mix");
  assert.equal(classifyBowl([item("riz_basmati")], { kinds: ["boil"] }).moment, true, "le riz se rince dans la passoire et se verse");
});

const K: ContainerKind[] = [
  { id: "bol-petit", kind: "bol", label: "Petit bol", liters: 0.5, count: 2 },
  { id: "bol-moyen", kind: "bol", label: "Bol moyen", liters: 1.5, count: 2 },
  { id: "bol-grand", kind: "bol", label: "Grand bol", liters: 3, count: 1 },
  { id: "boite-prep", kind: "boite", label: "Boîte", liters: 1, count: 1 },
];
const need = (letter: string, liters: number, fillAt: number, releaseAt: number, content: BowlNeed["content"] = "cut", extra: Partial<BowlNeed> = {}): BowlNeed => ({ letter, recipeSlug: "r", liters, fillAt, releaseAt, content, moment: false, ...extra });

test("le plus petit contenant qui convient, un bol plutôt qu'une boîte, et une boîte pour la nuit au frigo", () => {
  const a = allocateBowls([need("A", 0.3, -Infinity, 10), need("B", 1.2, -Infinity, 20), need("C", 2.4, -Infinity, 30), need("D", 0.6, -Infinity, 5, "cut", { fridge: true })], K);
  assert.equal(a.places.get("A")!.label, "Petit bol");
  assert.equal(a.places.get("B")!.label, "Bol moyen");
  assert.equal(a.places.get("C")!.label, "Grand bol");
  assert.equal(a.places.get("D")!.holder, "boite");
  assert.equal(a.peak, 4);
  assert.deepEqual(a.missing, []);
});

test("un bol vidé se rince et resert ; deux groupes qui entrent ensemble partagent un bol", () => {
  const a = allocateBowls([need("A", 1, 0, 10), need("B", 1, 11, 20), need("C", 1, 11, 20)], [{ id: "bol", kind: "bol", label: "Bol", liters: 1.2, count: 2 }]);
  assert.equal(a.places.get("B")!.container, a.places.get("A")!.container, "rincé en 1 min, il resert");
  assert.equal(a.used, 2);
  const b = allocateBowls([need("E", 0.4, -Infinity, 5, "cut", { together: "s#1|0" }), need("F", 0.3, -Infinity, 5, "weigh", { together: "s#1|0" })], K);
  assert.equal(b.places.get("E")!.container, b.places.get("F")!.container);
  assert.deepEqual(b.places.get("E")!.with, ["F"]);
  // Jamais la viande crue avec autre chose.
  const c = allocateBowls([need("G", 0.3, -Infinity, 5, "meat", { together: "x" }), need("H", 0.1, -Infinity, 5, "cut", { together: "x" })], K);
  assert.notEqual(c.places.get("G")!.container, c.places.get("H")!.container);
});

test("inventaire trop court : pesé au moment, une assiette, deux bols, rempli plus tard, ou manquant", () => {
  const one: ContainerKind[] = [{ id: "bol", kind: "bol", label: "Bol", liters: 1, count: 1 }];
  const a = allocateBowls([need("A", 0.5, -Infinity, 30, "meat"), need("B", 0.3, -Infinity, 40, "weigh"), need("C", 0.4, -Infinity, 50, "cut"), need("D", 0.5, -Infinity, 60, "mix")], one);
  assert.equal(a.places.get("A")!.holder, "bol");
  assert.equal(a.places.get("B")!.holder, "moment");
  assert.equal(a.places.get("C")!.holder, "assiette");
  assert.equal(a.places.get("D")!.fillAfter, "A", "remplis D quand le bol de A est vidé");
  assert.deepEqual(a.missing, []);
  // Rien ne se libère à temps : manquant, et le plan le dira.
  const b = allocateBowls([need("A", 0.5, -Infinity, 30, "meat"), need("D", 0.5, -Infinity, 31, "mix")], one);
  assert.deepEqual(b.missing, ["D"]);
  // Trop gros pour un seul : deux bols.
  const c = allocateBowls([need("P", 2, -Infinity, 30, "meat")], [{ id: "bol-moyen", kind: "bol", label: "Bol moyen", liters: 1.5, count: 2 }]);
  assert.equal(c.places.get("P")!.label, "2 × bol moyen");
  assert.equal(c.peak, 2);
});

test("l'inventaire d'une cuisine : ses bols et boîtes de prep, pas les boîtes du frigo ; celui par défaut sinon", () => {
  const eq = kitchenEquipment(DEFAULT_KITCHEN).equipment.map((e) => ({ ...e, capacityL: e.capacityL ?? null, count: e.count ?? 1, dimsJson: e.dimsJson ?? null }));
  const inv = inventoryOf(eq);
  assert.deepEqual(inv.map((k) => [k.id, k.count, k.liters]), [["bol-petit", 4, 0.5], ["bol-moyen", 3, 1.5], ["bol-grand", 2, 3], ["boite-prep", 4, 1]]);
  assert.deepEqual(inventoryOf([]), inv, "sans ligne en base : l'inventaire par défaut");
  assert.deepEqual(inventoryOf([{ id: "bol-petit", kind: "container", name: "Petits bols", capacityL: 0.3, count: 6, dimsJson: { role: "bol", label: "Ramequin" } }]), [{ id: "bol-petit", kind: "bol", label: "Ramequin", liters: 0.3, count: 6 }]);
});

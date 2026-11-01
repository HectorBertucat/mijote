import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { and, eq } from "drizzle-orm";
import { freshness, limitOf, mealAt, placeFor, sideRatio, sideWords, splitPot, type PotModel, type PotPerson } from "@/lib/boxes/core";
import { eatBox, freezeBox, listStock, potModel, sessionPots, storeBoxes, thawBox, throwBox } from "@/lib/boxes/store";
import { openDb } from "@/lib/db/open";
import { cookSessions, foodLog, mealBoxes, mealSlots, recipeIngredients, recipes, weekPlans } from "@/lib/db/schema";
import { upsertRecipe } from "@/lib/recipes/store";
import { seedTest } from "./helpers";

const person = (id: string, name: string, baseUnits: number, extra: Partial<PotPerson> = {}): PotPerson => ({ id, name, baseUnits, ref: null, planned: [], ...extra });
const pot = (p: Partial<PotModel>): PotModel => ({
  recipeId: "r",
  slug: "r",
  name: "Recette",
  cookedUnits: 18,
  dish: { kcal: 3600, protein: 270 },
  side: null,
  fridgeDays: 4,
  freezerOk: true,
  people: [person("alex", "Alex", 5), person("sam", "Sam", 4)],
  ...p,
});

test("sans repère : la marmite se partage selon la part de base, en boîtes entières tour à tour", () => {
  const s = splitPot(pot({}), { dishG: 3600 });
  // 18 unités : Alex 5, Sam 4, Alex 5, Sam 4 → 4 boîtes, 200 g l'unité.
  assert.equal(s.boxes.length, 4);
  assert.deepEqual(
    s.byPerson.map((p) => [p.name, p.count, p.dishG, p.kcal]),
    [
      ["Alex", 2, 1000, 1000],
      ["Sam", 2, 800, 800],
    ]
  );
  assert.equal(s.fill, 1);
  assert.equal(s.modes.alex, "simple");
});

test("les repas prévus d'abord, la marge ensuite ; un reste de moins de 3/4 de part se répartit", () => {
  const planned = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-0${i + 2}`, meal: "lunch" as const }));
  const s = splitPot(pot({ cookedUnits: 28, people: [person("alex", "Alex", 5, { planned: planned(3) }), person("sam", "Sam", 4, { planned: planned(2) })] }), { dishG: 5600 });
  // Prévu : 15 + 8 = 23 u ; reste 5 : une boîte de marge pour Alex, puis 0.
  assert.equal(s.boxes.filter((b) => b.plannedFor).length, 5);
  assert.deepEqual(
    s.boxes.filter((b) => !b.plannedFor).map((b) => b.personId),
    ["alex"]
  );
  assert.equal(s.byPerson.find((p) => p.personId === "alex")!.dishG, 1000);
  // La marmite est vidée : Σ grammes = poids pesé.
  assert.equal(s.boxes.reduce((x, b) => x + b.dishG!, 0), 5600);
});

test("marmite plus petite que la semaine prévue : toutes les boîtes rapetissent, et on le dit", () => {
  const planned = Array.from({ length: 4 }, (_, i) => ({ date: `2026-11-0${i + 2}`, meal: "dinner" as const }));
  const s = splitPot(pot({ cookedUnits: 18, people: [person("alex", "Alex", 5, { planned }), person("sam", "Sam", 4, { planned })] }), { dishG: 3600 });
  assert.equal(s.boxes.length, 8);
  assert.ok(s.fill < 0.6);
  assert.equal(s.byPerson[0].dishG, 500);
});

test("marmite pas encore pesée : le nombre de boîtes et leurs macros, sans grammes", () => {
  const s = splitPot(pot({}), { dishG: null });
  assert.equal(s.boxes.length, 4);
  assert.equal(s.byPerson[0].dishG, null);
  assert.equal(s.byPerson[0].kcal, 1000);
});

test("garniture à part : le rapport riz / plat vise kcal et protéines, dans ses bornes", () => {
  const dish = { kcalG: 1.2, proteinG: 0.15 };
  const rice = { kcalG: 1.3, proteinG: 0.03 };
  // 700 kcal et 50 g : t = (0,15 − 0,0714 × 1,2) / (0,0714 × 1,3 − 0,03) ≈ 1,02
  const r = sideRatio({ kcal: 700, protein: 50 }, dish, rice, 0.8);
  assert.equal(r.mode, "cible");
  const d = 700 / (dish.kcalG + r.ratio * rice.kcalG);
  assert.ok(Math.abs(d * dish.proteinG + r.ratio * d * rice.proteinG - 50) < 0.01);
  // Plus de protéines que le plat seul n'en donne : le moins de riz permis (la moitié de la marmite).
  assert.deepEqual(sideRatio({ kcal: 700, protein: 120 }, dish, rice, 0.8), { ratio: 0.4, mode: "borne" });
  // Presque pas de protéines : le plus de riz permis (le double).
  assert.deepEqual(sideRatio({ kcal: 700, protein: 5 }, dish, rice, 0.8), { ratio: 1.6, mode: "borne" });
});

test("garniture à part : plat et riz de chacun, la marmite et le riz entièrement répartis", () => {
  const ref = (kcal: number, protein: number) => ({ kcalMin: kcal - 30, kcalMax: kcal + 30, proteinMin: protein - 5, proteinMax: protein + 5 });
  const m = pot({
    cookedUnits: 28,
    // 3000 g de plat cuit (3600 kcal, 450 g de protéines), 1400 g de riz cuit (1820 kcal, 42 g)
    dish: { kcal: 3600, protein: 450 },
    side: { label: "riz", kcal: 1820, protein: 42 },
    people: [person("alex", "Alex", 5, { ref: ref(750, 70) }), person("sam", "Sam", 4, { ref: ref(600, 35) })],
  });
  const s = splitPot(m, { dishG: 3000, sideG: 1400 });
  const alex = s.byPerson.find((p) => p.personId === "alex")!;
  const sam = s.byPerson.find((p) => p.personId === "sam")!;
  // Alex vise plus de protéines par kcal : moins de riz pour autant de plat que Sam.
  assert.ok(alex.sideG! / alex.dishG! < sam.sideG! / sam.dishG!);
  const sum = (k: "dishG" | "sideG") => s.boxes.reduce((x, b) => x + b[k]!, 0);
  assert.ok(Math.abs(sum("dishG") - 3000) <= 5 * s.boxes.length);
  assert.ok(Math.abs(sum("sideG") - 1400) <= 5 * s.boxes.length);
  // Sans le poids du riz : la proportion simple.
  const simple = splitPot(m, { dishG: 3000 });
  assert.equal(simple.modes.alex, "simple");
  assert.equal(simple.byPerson[0].sideG, null);
});

test("rangement : frigo si le repas tombe dans ses jours, sinon congélateur ; dates limites", () => {
  assert.equal(placeFor("2026-11-01", "2026-11-04", 4, true), "fridge");
  assert.equal(placeFor("2026-11-01", "2026-11-06", 4, true), "freezer");
  assert.equal(placeFor("2026-11-01", null, 4, true), "freezer");
  assert.equal(placeFor("2026-11-01", null, 4, false), "fridge");
  const box = { place: "fridge" as const, cookedOn: "2026-11-01", fridgeDays: 4, frozenOn: null, thawedOn: null };
  assert.equal(limitOf(box), "2026-11-05");
  assert.equal(limitOf({ ...box, place: "freezer", frozenOn: "2026-11-03" }), "2027-02-01");
  assert.equal(limitOf({ ...box, thawedOn: "2026-12-10" }), "2026-12-11");
  assert.equal(freshness("2026-11-05", "2026-11-02"), "ok");
  assert.equal(freshness("2026-11-05", "2026-11-04"), "soon");
  assert.equal(freshness("2026-11-05", "2026-11-06"), "past");
  assert.equal(mealAt(12), "lunch");
  assert.equal(mealAt(20), "dinner");
  assert.equal(mealAt(16), "snack");
});

// ─── En base ───

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  upsertRecipe(db, JSON.parse(fs.readFileSync("src/seed/recipes/butter-chicken-express.json", "utf8")));
  const r = db.select().from(recipes).where(eq(recipes.slug, "butter-chicken-express")).get()!;
  // Session terminée le dimanche 1er novembre (18 h à Paris).
  const plan = { version: 1, recipes: [{ slug: r.slug, name: r.name, color: "var(--c-recipe-1)", scale: 1 }] };
  db.insert(cookSessions).values({ id: "S", planJson: plan, status: "done", startedAt: "2026-11-01T14:00:00Z", endedAt: "2026-11-01T17:00:00Z" }).run();
  // Semaine du 2 novembre : Alex lundi, mardi, samedi midi ; Sam lundi soir.
  db.insert(weekPlans).values({ id: "W", weekStart: "2026-11-02" }).run();
  const slot = (day: number, meal: "lunch" | "dinner", personId: string) => ({ id: `${day}${meal}${personId}`, weekPlanId: "W", day, meal, personId, place: "home" as const, recipeId: r.id });
  db.insert(mealSlots).values([slot(0, "lunch", "alex"), slot(1, "lunch", "alex"), slot(5, "lunch", "alex"), slot(0, "dinner", "sam")]).run();
  return { db, r };
}

test("la marque « cuit à part » vient de la fiche : le riz du butter chicken", () => {
  const { db, r } = setup();
  const sides = db.select().from(recipeIngredients).where(and(eq(recipeIngredients.recipeId, r.id), eq(recipeIngredients.side, true))).all();
  assert.deepEqual(sides.map((i) => i.item), ["Riz basmati"]);
  const m = potModel(db, r.slug)!;
  assert.equal(m.side?.label, "riz");
  assert.ok(m.dish!.kcal > m.side!.kcal);
});

test("fin de session : les boîtes sont rangées au frigo ou au congélateur, puis mangées, congelées, jetées", () => {
  const { db, r } = setup();
  const pots = sessionPots(db, "S")!;
  assert.equal(pots.pots.length, 1);
  assert.deepEqual(pots.pots[0].people.find((p) => p.id === "alex")!.planned.map((x) => x.date), ["2026-11-02", "2026-11-03", "2026-11-07"]);
  const n = storeBoxes(db, "S", r.id, { dishG: 3800, sideG: 1350 });
  const boxes = db.select().from(mealBoxes).all();
  assert.equal(boxes.length, n);
  assert.ok(n >= 6, `${n} boîtes`);
  // Lundi et mardi au frigo (4 jours), samedi au congélateur, la marge aussi.
  const alexPlanned = boxes.filter((b) => b.personId === "alex" && b.plannedFor).sort((a, b) => a.plannedFor!.localeCompare(b.plannedFor!));
  assert.deepEqual(alexPlanned.map((b) => b.place), ["fridge", "fridge", "freezer"]);
  assert.ok(boxes.filter((b) => !b.plannedFor).every((b) => b.place === "freezer"));
  assert.ok(boxes.every((b) => b.grams! > 0 && b.sideGrams! > 0 && b.sideLabel === "riz"));

  const stock = listStock(db, "2026-11-02");
  assert.equal(stock.length, n);
  assert.equal(stock[0].limit, "2026-11-05");

  // « Je mange cette boîte » : la ligne du journal porte les macros de la boîte.
  const first = stock[0];
  const entry = eatBox(db, first.id, "alex", new Date("2026-11-02T11:30:00Z"));
  assert.equal(entry.meal, "lunch");
  assert.equal(entry.date, "2026-11-02");
  assert.equal(entry.kcal, Math.round(first.kcal!));
  assert.match(entry.label, /Butter chicken.*g \+ riz \d+ g/i);
  assert.equal(db.select().from(foodLog).where(eq(foodLog.id, entry.id)).get()?.recipeId, r.id);
  assert.throws(() => eatBox(db, first.id, "alex"));

  const fridgeBox = listStock(db, "2026-11-02").find((b) => b.place === "fridge")!;
  freezeBox(db, fridgeBox.id, "2026-11-02");
  assert.equal(listStock(db, "2026-11-02").find((b) => b.id === fridgeBox.id)!.limit, "2027-01-31");
  thawBox(db, fridgeBox.id, "2026-11-08");
  const thawed = listStock(db, "2026-11-08").find((b) => b.id === fridgeBox.id)!;
  assert.equal(thawed.place, "fridge");
  assert.equal(thawed.limit, "2026-11-09");
  throwBox(db, fridgeBox.id);
  assert.equal(listStock(db).length, n - 2);

  // Ranger à nouveau : le stock est remplacé, les boîtes mangées ou jetées restent comptées.
  const again = storeBoxes(db, "S", r.id, { dishG: 3800, sideG: 1350 });
  assert.equal(again, n - 2);
  assert.equal(db.select().from(mealBoxes).all().length, n);
  assert.equal(sessionPots(db, "S")!.stored[r.id].open, n - 2);
});

test("une session test ne range rien", () => {
  const { db, r } = setup();
  db.update(cookSessions).set({ test: true }).where(eq(cookSessions.id, "S")).run();
  assert.throws(() => storeBoxes(db, "S", r.id, { dishG: 3000 }), /test/);
});

test("accompagnement accordé : le riz cuit, la semoule cuite, les pâtes cuites", () => {
  assert.deepEqual([sideWords("riz").the, sideWords("riz").cooked], ["le riz", "cuit"]);
  assert.deepEqual([sideWords("semoule").the, sideWords("semoule").cooked, sideWords("semoule").of], ["la semoule", "cuite", "de la semoule"]);
  assert.deepEqual([sideWords("pâtes").the, sideWords("pâtes").cooked, sideWords("pâtes").stays], ["les pâtes", "cuites", "restent"]);
  assert.equal(sideWords("quinoa").the, "le quinoa");
  assert.equal(sideWords("riz et lentilles").cooked, "cuits");
});

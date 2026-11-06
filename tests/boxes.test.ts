import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { and, eq } from "drizzle-orm";
import { fillUp, freshness, limitOf, mealAt, placeFor, sideWords, splitNote, splitPot, type PotModel, type PotPerson } from "@/lib/boxes/core";
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

test("surplus : chaque boîte grossit du même facteur jusqu'à son plafond, le reste va aux autres", () => {
  // 10 + 5 unités, 3 de plus : facteur 1,2 → 12 et 6 ; la première plafonnée à 11 laisse 7 à la seconde.
  assert.deepEqual(fillUp([{ units: 10, cap: Infinity }, { units: 5, cap: Infinity }], 3), { units: [12, 6], over: 0 });
  assert.deepEqual(fillUp([{ units: 10, cap: 11 }, { units: 5, cap: Infinity }], 3), { units: [11, 7], over: 0 });
  // Tout le monde au plafond : ce qui ne tient nulle part.
  assert.deepEqual(fillUp([{ units: 10, cap: 11 }, { units: 5, cap: 5.5 }], 3), { units: [11, 5.5], over: 1.5 });
});

// Un grand et un petit gabarit, une marmite de poulet laqué et son riz cuit à part (chiffres fictifs).
const laque = (people: PotPerson[]) =>
  pot({
    cookedUnits: 26,
    dish: { kcal: 2270, protein: 262 },
    side: { label: "riz", kcal: 1580, protein: 34 },
    people,
  });
const days = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-0${i + 2}`, meal: "dinner" as const }));

test("petit gabarit : ni plus de riz ni plus de plat que le grand, repères tenus, la marmite entièrement répartie", () => {
  const alex = person("alex", "Alex", 5, { planned: days(3), ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 } });
  // Petit gabarit qui mange peu de protéines hors batch : un repère de protéines bas pour ses kcal.
  const sam = person("sam", "Sam", 4, { planned: days(2), ref: { kcalMin: 555, kcalMax: 705, proteinMin: 34, proteinMax: 43 } });
  const m = laque([alex, sam]);
  const s = splitPot(m, { dishG: 1180, sideG: 1020 });
  const a = s.byPerson.find((p) => p.personId === "alex")!;
  const b = s.byPerson.find((p) => p.personId === "sam")!;
  assert.ok(b.sideG! <= a.sideG!, `riz : Sam ${b.sideG} g, Alex ${a.sideG} g`);
  assert.ok(b.dishG! <= a.dishG!);
  assert.ok(a.kcal! <= 760 * 1.03, `Alex ${a.kcal} kcal`);
  assert.ok(b.kcal! <= 705 * 1.03, `Sam ${b.kcal} kcal`);
  // Sam, plus petite part, laisse de quoi faire une boîte de marge de plus (3 + 3 boîtes).
  assert.equal(s.boxes.length, 6);
  const sum = (k: "dishG" | "sideG") => s.boxes.reduce((x, y) => x + y[k]!, 0);
  assert.ok(Math.abs(sum("dishG") - 1180) <= 5 * s.boxes.length);
  assert.ok(Math.abs(sum("sideG") - 1020) <= 5 * s.boxes.length);
  assert.equal(splitNote(m, s), null);
});

test("surplus de moins de 3 % : réparti sur les boîtes, sans boîte de reste", () => {
  const alex = person("alex", "Alex", 5, { planned: days(3), ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 } });
  const sam = person("sam", "Sam", 4, { planned: days(2), ref: { kcalMin: 600, kcalMax: 740, proteinMin: 34, proteinMax: 43 } });
  const s = splitPot(laque([alex, sam]), { dishG: 1180, sideG: 1020 });
  assert.equal(s.rest, null);
  for (const p of s.byPerson) assert.ok(p.kcal! <= (p.personId === "alex" ? 760 : 740) * 1.03, `${p.name} ${p.kcal} kcal`);
});

test("le riz glisse dans le sens qui corrige : moins pour qui manque de protéines, plus pour qui en a trop, et on le dit", () => {
  // Alex vise beaucoup de protéines : moins de riz, plus de plat. Sam en a trop avec ce plat : plus de riz, moins de plat.
  const alex = person("alex", "Alex", 5, { planned: days(3), ref: { kcalMin: 700, kcalMax: 780, proteinMin: 80, proteinMax: 95 } });
  const sam = person("sam", "Sam", 4, { planned: days(2), ref: { kcalMin: 600, kcalMax: 700, proteinMin: 34, proteinMax: 43 } });
  const m = laque([alex, sam]);
  const s = splitPot(m, { dishG: 1180, sideG: 1020 });
  const a = s.byPerson.find((p) => p.personId === "alex")!;
  const b = s.byPerson.find((p) => p.personId === "sam")!;
  assert.ok(s.sideRatios.alex < 1 && s.sideRatios.alex >= 0.5);
  assert.ok(s.sideRatios.sam > 1 && s.sideRatios.sam <= 1.5);
  assert.ok(b.sideG! / b.dishG! > a.sideG! / a.dishG!);
  assert.equal(
    splitNote(m, s),
    "Moins de riz et plus de plat pour Alex, à qui il faut plus de protéines ; plus de riz et moins de plat pour Sam, pour qui la recette est trop protéinée."
  );
});

test("repère tenu : la proportion de la fiche, rien à dire", () => {
  const alex = person("alex", "Alex", 5, { planned: days(3), ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 } });
  const m = laque([alex]);
  const s = splitPot(m, { dishG: 1180, sideG: 1020 });
  assert.equal(s.modes.alex, "simple");
  assert.equal(s.sideRatios.alex, 1);
  assert.equal(splitNote(m, s), null);
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
  // Alex tient son repère à la fiche ; Sam, trop protéiné même au plus de riz permis dans ses kcal, garde aussi la fiche.
  assert.ok(Math.abs(alex.sideG! / alex.dishG! - sam.sideG! / sam.dishG!) < 0.05);
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

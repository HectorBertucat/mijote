// Période libre de la Semaine : « du … au … » (1 à 14 jours), session la veille du premier jour.
// Logique pure (src/lib/week/period.ts), puis la base en mémoire (foyer fictif Alex et Sam).
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { mealSlots, recipes as recipesT, weekPlans } from "@/lib/db/schema";
import { seedTest } from "./helpers";
import { addDays, assign, daysAfterSession, defaultPlace, type SlotIn } from "@/lib/week/propose";
import {
  clampDays,
  dayIndexIn,
  defaultPeriod,
  endOf,
  isClassicWeek,
  isDay,
  MAX_DAYS,
  neighbour,
  parsePeriod,
  periodDays,
  periodHeading,
  periodLabel,
  remapPlaces,
  spanDays,
  weekdayOf,
} from "@/lib/week/period";
import { weekNutrition } from "@/lib/week/nutrition";
import { ensureWeek, loadWeek, periodPlans, setPeriod } from "@/lib/week/store";
import { plannedMeals } from "@/lib/health/log";

test("période : dates, longueur, plafond", () => {
  assert.ok(isDay("2026-11-05"));
  assert.ok(!isDay("2026-02-30"));
  assert.ok(!isDay("5/11/2026"));
  assert.equal(weekdayOf("2026-11-02"), 0); // lundi
  assert.equal(weekdayOf("2026-11-08"), 6); // dimanche
  assert.equal(spanDays("2026-11-05", "2026-11-14"), 10);
  assert.equal(endOf("2026-11-05", 10), "2026-11-14");
  assert.equal(clampDays(30), MAX_DAYS);
  assert.equal(clampDays(0), 1);
  assert.equal(clampDays(Number("x")), 7);
  assert.deepEqual(parsePeriod("2026-11-05", "2026-11-14"), { start: "2026-11-05", days: 10 });
  assert.deepEqual(parsePeriod("2026-11-05", "2026-12-31"), { start: "2026-11-05", days: 14 });
  assert.deepEqual(parsePeriod("2026-11-05", "2026-11-01"), { start: "2026-11-05", days: 1 });
  assert.deepEqual(parsePeriod("2026-11-05", ""), { start: "2026-11-05", days: 7 });
  assert.equal(parsePeriod("", "2026-11-14"), null);
  assert.equal(dayIndexIn("2026-11-05", 10, "2026-11-14"), 9);
  assert.equal(dayIndexIn("2026-11-05", 10, "2026-11-15"), null);
  assert.equal(dayIndexIn("2026-11-05", 10, "2026-11-04"), null);
});

test("période : jours, libellés, semaine classique", () => {
  const d = periodDays("2026-11-05", 10);
  assert.equal(d.length, 10);
  assert.deepEqual(d[0], { i: 0, date: "2026-11-05", weekday: 3, short: "jeu", long: "Jeudi", letter: "J", num: 5 });
  assert.equal(d[9].date, "2026-11-14");
  assert.ok(isClassicWeek("2026-11-02", 7));
  assert.ok(!isClassicWeek("2026-11-05", 7));
  assert.ok(!isClassicWeek("2026-11-02", 10));
  assert.equal(periodLabel("2026-11-02", 7), "semaine du 2 novembre");
  assert.equal(periodLabel("2026-11-05", 10), "du 5 au 14 novembre");
  assert.equal(periodLabel("2026-10-29", 5), "du 29 octobre au 2 novembre");
  assert.equal(periodHeading("2026-11-05", 10), "Du 5 au 14 novembre");
});

test("période par défaut : en cours tant qu'il reste plus de 3 jours, puis la suivante", () => {
  const at = (ymd: string) => new Date(`${ymd}T10:00:00Z`);
  // Rien de touché : la règle du lundi (semaine en cours jusqu'au jeudi, la suivante ensuite).
  assert.deepEqual(defaultPeriod([], at("2026-10-20")), { start: "2026-10-19", days: 7 });
  assert.deepEqual(defaultPeriod([{ start: "2026-10-19", days: 7, touched: false }], at("2026-10-24")), { start: "2026-10-26", days: 7 });
  // Une période de 10 jours du jeudi 5 au samedi 14 novembre.
  const ten = { start: "2026-11-05", days: 10, touched: true };
  assert.deepEqual(defaultPeriod([ten], at("2026-11-10")), { start: "2026-11-05", days: 10 }); // 5 jours restent
  assert.deepEqual(defaultPeriod([ten], at("2026-11-12")), { start: "2026-11-15", days: 10 }); // 3 jours : la suivante, même longueur
  assert.deepEqual(defaultPeriod([ten], at("2026-11-02")), { start: "2026-11-05", days: 10 }); // à venir
  const after = { start: "2026-11-15", days: 5, touched: true };
  assert.deepEqual(defaultPeriod([ten, after], at("2026-11-13")), { start: "2026-11-15", days: 5 });
});

test("navigation : bout à bout avec les périodes existantes, sinon même longueur", () => {
  const plans = [
    { start: "2026-11-05", days: 10 },
    { start: "2026-10-29", days: 7 },
  ];
  assert.deepEqual(neighbour(plans, "2026-11-05", 10, 1), { start: "2026-11-15", days: 10 });
  assert.deepEqual(neighbour(plans, "2026-11-05", 10, -1), { start: "2026-10-29", days: 7 }); // finit le 4 : bout à bout
  assert.deepEqual(neighbour([], "2026-11-05", 10, -1), { start: "2026-10-26", days: 10 });
  assert.deepEqual(neighbour([{ start: "2026-11-01", days: 4 }], "2026-11-05", 10, -1), { start: "2026-11-01", days: 4 });
  assert.deepEqual(neighbour([{ start: "2026-11-15", days: 3 }], "2026-11-05", 10, 1), { start: "2026-11-15", days: 3 });
});

test("période déplacée : chaque repas garde sa présence à la même date", () => {
  const old = {
    start: "2026-11-02",
    slots: [
      { day: 3, meal: "dinner" as const, personId: "sam", place: "away" as const }, // jeudi 5 soir
      { day: 0, meal: "lunch" as const, personId: "sam", place: "away" as const }, // lundi 2 : hors de la nouvelle période
    ],
  };
  const out = remapPlaces(old, { start: "2026-11-05", days: 10 }, ["lunch", "dinner"] as const, ["alex", "sam"], defaultPlace);
  assert.equal(out.length, 10 * 2 * 2);
  assert.equal(out.find((s) => s.day === 0 && s.meal === "dinner" && s.personId === "sam")!.place, "away");
  // Les jours nouveaux suivent le jour de la semaine : samedi 7 midi = maison, lundi 9 midi = bureau.
  assert.equal(out.find((s) => s.day === 2 && s.meal === "lunch" && s.personId === "alex")!.place, "home");
  assert.equal(out.find((s) => s.day === 4 && s.meal === "lunch" && s.personId === "alex")!.place, "office");
});

test("12 jours : au-delà du frigo, congélateur ; sinon non couvert", () => {
  const slots: SlotIn[] = [];
  for (const d of periodDays("2026-11-05", 12)) for (const meal of ["lunch", "dinner"] as const) slots.push({ day: d.i, meal, personId: "alex", place: defaultPlace(d.weekday, meal), portionUnits: 2 });
  const base = { name: "", tags: [], steps: [], kcalUnit: 500, proteinUnit: 30, fridgeDays: 4 };
  const a = assign(
    [
      { ...base, slug: "frais", servingsUnits: 20, freezerOk: false },
      { ...base, slug: "congele", servingsUnits: 40, freezerOk: true },
    ],
    slots
  );
  assert.equal(a.uncovered.length, 0);
  for (const p of a.recipes) for (const m of p.meals) if (daysAfterSession(m.day) > 4) assert.ok(m.frozen && p.slug === "congele", `${p.slug} J+${daysAfterSession(m.day)}`);
  assert.equal(daysAfterSession(11), 12);
});

test("nutrition par jour sur la longueur de la période", () => {
  const slots = periodDays("2026-11-05", 12).map((d) => ({ day: d.i, meal: "lunch" as const, personId: "alex", portionUnits: 2, recipeId: "r" }));
  const [w] = weekNutrition(slots, [{ id: "r", kcalUnit: 300, proteinUnit: 20 }], ["alex"], undefined, 12);
  assert.equal(w.byDay.length, 12);
  assert.equal(w.byDay[11]?.macros.kcal, 600);
  assert.equal(w.days, 12);
});

test("en base : semaine existante intacte, période allongée puis déplacée, journal du jour", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  // Une semaine classique créée avant la migration : 7 jours, du lundi.
  const id = ensureWeek(db, "2026-11-02");
  assert.equal(db.select().from(weekPlans).where(eq(weekPlans.id, id)).get()!.days, 7);
  let w = loadWeek(db, "2026-11-02");
  assert.equal(w.days, 7);
  assert.equal(w.slots.length, 7 * 2 * 2);
  assert.ok(!periodPlans(db)[0].touched);
  // Sam absent le jeudi 5 au soir.
  const thu = w.slots.find((s) => s.day === 3 && s.meal === "dinner" && s.personId === "sam")!;
  db.update(mealSlots).set({ place: "away" }).where(eq(mealSlots.id, thu.id)).run();

  // Allongée à 10 jours : même plan, 3 jours de plus, l'absence reste.
  assert.equal(setPeriod(db, "2026-11-02", { start: "2026-11-02", days: 10 }), "2026-11-02");
  w = loadWeek(db, "2026-11-02");
  assert.equal(w.planId, id);
  assert.equal(w.days, 10);
  assert.equal(w.slots.length, 10 * 2 * 2);
  assert.equal(w.slots.find((s) => s.day === 3 && s.meal === "dinner" && s.personId === "sam")!.place, "away");
  assert.equal(w.slots.find((s) => s.day === 7 && s.meal === "lunch" && s.personId === "alex")!.place, "office"); // lundi 9
  assert.ok(periodPlans(db)[0].touched);

  // Déplacée au jeudi 5, 12 jours : le plan suit, le jeudi soir de Sam devient le jour 0.
  assert.equal(setPeriod(db, "2026-11-02", { start: "2026-11-05", days: 12 }), "2026-11-05");
  assert.equal(db.select().from(weekPlans).all().length, 1);
  w = loadWeek(db, "2026-11-05");
  assert.equal(w.planId, id);
  assert.equal(w.slots.length, 12 * 2 * 2);
  assert.equal(w.slots.find((s) => s.day === 0 && s.meal === "dinner" && s.personId === "sam")!.place, "away");

  // Le journal de Santé trouve le repas du dernier jour (lundi 16), et rien après.
  db.insert(recipesT).values({ id: "r1", name: "Chasseur", slug: "chasseur", servingsUnits: 18, kcalUnit: 150, proteinUnit: 12 }).run();
  db.update(mealSlots).set({ recipeId: "r1" }).where(and(eq(mealSlots.weekPlanId, id), eq(mealSlots.day, 11), eq(mealSlots.meal, "dinner"), eq(mealSlots.personId, "alex"))).run();
  assert.equal(plannedMeals(db, "alex", addDays("2026-11-05", 11)).length, 1);
  assert.equal(plannedMeals(db, "alex", addDays("2026-11-05", 12)).length, 0);

  // Raccourcie à 5 jours : les créneaux en trop disparaissent.
  setPeriod(db, "2026-11-05", { start: "2026-11-05", days: 5 });
  assert.equal(loadWeek(db, "2026-11-05").slots.length, 5 * 2 * 2);
  assert.equal(db.select().from(mealSlots).where(eq(mealSlots.weekPlanId, id)).all().length, 5 * 2 * 2);
});

test("en base : une période nouvelle reçoit sa longueur, une existante garde la sienne", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  assert.equal(loadWeek(db, "2026-11-05", 10).days, 10);
  assert.equal(loadWeek(db, "2026-11-05", 3).days, 10);
  // Régler une date où un plan existe déjà : c'est lui qu'on règle, l'autre reste.
  ensureWeek(db, "2026-11-02");
  setPeriod(db, "2026-11-02", { start: "2026-11-05", days: 14 });
  assert.equal(db.select().from(weekPlans).all().length, 2);
  assert.equal(loadWeek(db, "2026-11-05").days, 14);
  assert.equal(loadWeek(db, "2026-11-02").days, 7);
});

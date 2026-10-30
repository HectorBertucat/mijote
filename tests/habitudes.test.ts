// Habitudes hors batch : macros calculées en code, hors batch du jour, repère, conseil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { openDb } from "@/lib/db/open";
import { people, recipes, weighIns } from "@/lib/db/schema";
import { mealRef } from "@/lib/eaters/core";
import { adviceOf, checkHabit, daysLabel, habitMacros, HABIT_PRESETS, outsideMean, outsideWeek } from "@/lib/eaters/habits";
import { listHabits, removeHabit, saveHabit, setNothingOutside } from "@/lib/eaters/setup";
import { adviceFor, eaterOf } from "@/lib/eaters/store";
import { listTemplates, pending } from "@/lib/health/log";
import { weekNutrition } from "@/lib/week/nutrition";
import { seedTest } from "./helpers";

const shaker = HABIT_PRESETS.find((p) => p.id === "shaker")!;

test("macros d'une habitude : grammes × table nutritionnelle pour 100 g", () => {
  // 35 g de whey (380 kcal, 75 g) + 250 g de lait (46, 3,3) + 120 g de banane (90, 1,1)
  const m = habitMacros(shaker.items);
  assert.equal(m.kcal, Math.round(133 + 115 + 108));
  assert.equal(m.proteinG, Math.round((26.25 + 8.25 + 1.32) * 10) / 10);
  // Aliment inconnu ou grammes nuls : ignorés.
  assert.equal(habitMacros([{ food: "inconnu", grams: 100 }, { food: "banane", grams: 0 }]).kcal, 0);
});

test("hors batch du jour : seulement les jours où l'habitude est prise ; repère sur la moyenne", () => {
  const h = [
    { weekdays: [0, 1, 2, 3, 4], items: shaker.items, kcal: 0, proteinG: 0 },
    { weekdays: [5, 6], items: [], kcal: 400, proteinG: 15 }, // ancienne habitude, chiffres saisis
  ];
  const week = outsideWeek(h);
  assert.equal(week[0].kcal, 356);
  assert.equal(week[6].kcal, 400);
  const mean = outsideMean(week);
  assert.equal(mean.kcal, Math.round((356 * 5 + 400 * 2) / 7));
  // Le repère d'un repas du batch suit la moyenne (parts identiques toute la semaine).
  const ref = mealRef({ kcal: 2300, proteinG: 150 }, mean);
  assert.equal(ref.kcalMin, Math.round((2150 - mean.kcal) / 2));
  // La Semaine compte jour par jour : le lundi avec le shaker, le samedi avec le brunch.
  const [wk] = weekNutrition(
    [
      { day: 0, meal: "lunch", personId: "a", portionUnits: 1, recipeId: "r" },
      { day: 5, meal: "lunch", personId: "a", portionUnits: 1, recipeId: "r" },
    ],
    [{ id: "r", kcalUnit: 700, proteinUnit: 50 }],
    ["a"],
    new Map([["a", week]])
  );
  assert.equal(wk.byDay[0]!.macros.kcal, 700 + 356);
  assert.equal(wk.byDay[5]!.macros.kcal, 700 + 400);
  assert.equal(wk.perDay!.kcal, (700 * 2 + 356 + 400) / 2);
});

test("conseil : un manque notable de protéines appelle un shaker, sinon rien n'est utile", () => {
  const target = { kcal: 2300, proteinG: 160 };
  const gap = adviceOf(target, { kcal: 1000, protein: 60 }, { kcal: 300, protein: 0 });
  assert.equal(gap.kind, "gap");
  assert.equal(gap.proteinG, 40);
  assert.match(gap.text, /il manque ~40 g de protéines par jour : un shaker le matin les couvre/i);
  // Un shaker déjà pris : on propose autre chose.
  assert.match(adviceOf(target, { kcal: 1000, protein: 60 }, { kcal: 300, protein: 0 }, true).text, /en-cas protéiné/);
  // Des kcal seulement : le petit-déjeuner classique.
  const kcal = adviceOf(target, { kcal: 900, protein: 75 }, { kcal: 0, protein: 10 });
  assert.equal(kcal.kind, "gap");
  assert.match(kcal.text, /Il manque ~500 kcal par jour : un petit-déjeuner classique/);
  // Rien de notable (moins de 15 g, moins de 250 kcal).
  const ok = adviceOf(target, { kcal: 1000, protein: 70 }, { kcal: 300, protein: 12 });
  assert.equal(ok.kind, "ok");
  assert.match(ok.text, /aucun complément n'est utile/);
});

test("une habitude saisie est vérifiée", () => {
  const base = { label: "Shaker", meal: "breakfast", weekdays: [0], items: [{ food: "whey", grams: 30 }] };
  assert.equal(checkHabit(base), null);
  assert.match(checkHabit({ ...base, label: " " })!, /nom/);
  assert.match(checkHabit({ ...base, weekdays: [] })!, /jour/);
  assert.match(checkHabit({ ...base, items: [{ food: "plutonium", grams: 3 }] })!, /inconnu/);
  assert.match(checkHabit({ ...base, items: [{ food: "whey", grams: 5000 }] })!, /1 000 g/);
  assert.match(checkHabit({ ...base, meal: "lunch" })!, /matin/);
  assert.equal(daysLabel([0, 1, 2, 3, 4]), "du lundi au vendredi");
  assert.equal(daysLabel([6, 5]), "le week-end");
});

test("en base : l'habitude fait le hors batch, « rien » le remet à zéro, le journal la propose", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  db.update(people).set({ heightCm: 165, goal: "maintain", ratePct: 0, proteinGPerKg: 1.6 }).where(eq(people.id, "sam")).run();
  db.insert(weighIns).values({ id: "w1", personId: "sam", date: "2026-10-27", measuredAt: "2026-10-27T07:00:00Z", kg: 58, source: "manual" }).run();
  const now = new Date("2026-10-27T12:00:00Z");
  const sam = () => eaterOf(db, db.select().from(people).where(eq(people.id, "sam")).get()!, now);

  // Rien de dit : valeur par défaut, et ce n'est pas un manque.
  const s0 = sam();
  assert.equal(s0.outsideSource, null);
  assert.deepEqual(s0.missing, []);
  assert.ok(s0.ref);

  const id = saveHabit(db, "sam", { label: "Petit-déjeuner", meal: "breakfast", weekdays: [0, 1, 2, 3, 4, 5, 6], items: HABIT_PRESETS[1].items });
  const s1 = sam();
  assert.equal(s1.outsideSource, "habitudes");
  assert.equal(s1.outside!.kcal, habitMacros(HABIT_PRESETS[1].items).kcal);
  assert.ok(s1.ref!.kcalMax < s0.ref!.kcalMax + 200);
  const row = listHabits(db, "sam").find((h) => h.id === id)!;
  assert.equal(row.kcal, habitMacros(HABIT_PRESETS[1].items).kcal, "macros recalculées et gardées pour le journal");

  // Proposé d'office dans le journal du jour.
  const todo = pending([], listTemplates(db, "sam"), [], "2026-10-27");
  assert.ok(todo.templates.find((t) => t.id === id)?.suggested);

  // Le conseil se fonde sur la bibliothèque à défaut de Semaine.
  assert.equal(adviceFor(db, s1, now), null, "sans recette, pas de conseil");
  db.insert(recipes).values({ id: "r1", name: "Plat léger", slug: "plat-leger", servingsUnits: 20, kcalUnit: 110, proteinUnit: 5 }).run();
  const advice = adviceFor(db, s1, now);
  assert.ok(advice && advice.from === "bibliotheque");
  // Un plat pauvre en protéines (5 g pour 110 kcal) : il en manque, la carte le dit.
  assert.equal(advice.kind, "gap");
  assert.match(advice.text, /protéines/);

  // Modifier, puis « rien hors batch ».
  saveHabit(db, "sam", { label: "Petit-déjeuner", meal: "breakfast", weekdays: [5, 6], items: HABIT_PRESETS[1].items }, id);
  assert.equal(sam().outsideByDay![0].kcal, 0);
  setNothingOutside(db, "sam");
  const s2 = sam();
  assert.equal(s2.outsideSource, "chiffre");
  assert.deepEqual(s2.outside, { kcal: 0, protein: 0 });
  assert.equal(listHabits(db, "sam").filter((h) => h.personId === "sam").length, 0);

  // Une habitude d'une autre personne ne se retire pas.
  removeHabit(db, "sam", "tpl-shaker-alex");
  assert.ok(listHabits(db, "alex").some((h) => h.id === "tpl-shaker-alex"));
});

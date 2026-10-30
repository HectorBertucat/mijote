import { test } from "node:test";
import assert from "node:assert/strict";
import { gapOf, mealRef, meanGap, portionOf, portionUnits, type Eater } from "@/lib/eaters/core";
import { assign, propose, type SlotIn, type WeekRecipe } from "@/lib/week/propose";
import { dayRefOf, weekNutrition } from "@/lib/week/nutrition";
import { openDb } from "@/lib/db/open";
import { foodTemplates, people, weighIns } from "@/lib/db/schema";
import { eaterOf } from "@/lib/eaters/store";
import { addDislikes, listDislikes, removeDislike, setOutside } from "@/lib/eaters/setup";
import { seedTest } from "./helpers";
import { eq } from "drizzle-orm";

const alex: Eater = { id: "alex", name: "Alex", baseUnits: 5, ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 }, source: "estimation", missing: [] };
const sam: Eater = { id: "sam", name: "Sam", baseUnits: 4, ref: mealRef({ kcal: 1800, proteinG: 100 }, { kcal: 350, protein: 12 }), source: "estimation", missing: [] };

test("repère d'un repas : (cible du jour ± 150 − hors batch) / 2", () => {
  assert.deepEqual(sam.ref, { kcalMin: 650, kcalMax: 800, proteinMin: 40, proteinMax: 50 });
});

test("la part vise le milieu du repère, au demi près, dans ses bornes", () => {
  // 150 kcal l'unité : 730 / 150 = 4,87 → 5 pour Alex ; 725 / 150 = 4,83 → 5 pour Sam
  assert.equal(portionUnits(alex, { kcalUnit: 150, proteinUnit: 12 }), 5);
  assert.equal(portionUnits(sam, { kcalUnit: 150, proteinUnit: 12 }), 5);
  // plat riche (200 kcal/u) : Sam 3,5 u, Alex 3,5 u
  assert.equal(portionUnits(sam, { kcalUnit: 200, proteinUnit: 12 }), 3.5);
  assert.equal(portionUnits(alex, { kcalUnit: 200, proteinUnit: 12 }), 3.5);
  // plat très léger : bornée à 160 % de la part de base (8 u pour Alex), et dite « bornée »
  const light = portionOf(alex, { kcalUnit: 50, proteinUnit: 5 });
  assert.equal(light.units, 8);
  assert.equal(light.capped, true);
  // sans repère ou sans macros : la part de base
  assert.equal(portionUnits({ baseUnits: 4, ref: null }, { kcalUnit: 200, proteinUnit: 10 }), 4);
  assert.equal(portionUnits(alex, { kcalUnit: null, proteinUnit: null }), 5);
});

test("l'écart au repère porte surtout sur les protéines", () => {
  const lean = { kcalUnit: 146, proteinUnit: 12 }; // 5 u : 730 kcal, 60 g
  const poor = { kcalUnit: 146, proteinUnit: 6 }; // 5 u : 30 g de protéines
  assert.equal(gapOf(alex, lean), 0);
  assert.ok(gapOf(alex, poor) > 10);
  assert.ok(meanGap([alex, sam], poor) > meanGap([alex, sam], lean));
});

const rec = (slug: string, kcalUnit: number, proteinUnit: number, units = 20): WeekRecipe => ({
  slug,
  name: slug,
  tags: [],
  fridgeDays: 4,
  freezerOk: true,
  servingsUnits: units,
  kcalUnit,
  proteinUnit,
  status: "liked",
  steps: [],
});

test("répartition : chacun reçoit sa part de la recette, gardée par créneau", () => {
  const slots: SlotIn[] = [
    { day: 0, meal: "dinner", personId: "alex", place: "home", portionUnits: 5 },
    { day: 0, meal: "dinner", personId: "sam", place: "home", portionUnits: 4 },
  ];
  const r = rec("riche", 200, 15);
  const a = assign([r], slots, { eaters: new Map([["alex", alex], ["sam", sam]]) });
  assert.equal(a.unitsBySlot.get("0:dinner:alex"), 3.5);
  assert.equal(a.unitsBySlot.get("0:dinner:sam"), 3.5);
  assert.equal(a.recipes[0].unitsUsed, 7);
  // sans mangeurs : la part du créneau
  const b = assign([r], slots);
  assert.equal(b.unitsBySlot.get("0:dinner:sam"), 4);
});

test("proposition : la recette pauvre en protéines perd face à une riche, quand les mangeurs comptent", () => {
  const slots: SlotIn[] = [0, 1, 2].flatMap((day) => (["lunch", "dinner"] as const).map((meal) => ({ day, meal, personId: "alex", place: "home" as const, portionUnits: 5 })));
  const lib = [rec("pates-pauvres", 146, 6, 40), rec("poulet", 146, 12, 40), rec("porc", 146, 11.5, 40)];
  const p = propose(lib, slots, { eaters: new Map([["alex", alex]]) })!;
  assert.ok(!p.slugs.includes("pates-pauvres"), p.slugs.join());
});

test("bilan de la semaine : le hors batch dit par Sam s'ajoute à ses jours", () => {
  const [, j] = weekNutrition(
    [
      { day: 0, meal: "lunch", personId: "sam", portionUnits: 4, recipeId: "r" },
      { day: 0, meal: "dinner", personId: "sam", portionUnits: 4, recipeId: "r" },
      { day: 0, meal: "dinner", personId: "alex", portionUnits: 5, recipeId: "r" },
    ],
    [{ id: "r", kcalUnit: 100, proteinUnit: 10 }],
    ["alex", "sam"],
    new Map([["sam", { kcal: 350, protein: 12 }]])
  );
  assert.equal(j.outsideDays, 1);
  assert.equal(j.perDay!.kcal, 800 + 350);
  const ref = dayRefOf({ source: "estimation", dayTarget: { kcal: 1800, proteinG: 100 }, ref: sam.ref })!;
  assert.equal(ref.kcalMin, 1650);
  assert.equal(ref.source, "estimation");
});

test("mangeur en base : formule dès la première pesée, ce qui manque est dit", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  let j = eaterOf(db, db.select().from(people).where(eq(people.id, "sam")).get()!);
  assert.equal(j.ref, null);
  assert.ok(j.missing.includes("taille") && j.missing.includes("poids"));
  // Un hors batch non dit n'est pas un manque : la valeur par défaut suffit.
  assert.ok(!j.missing.some((m) => /hors batch/.test(m)));
  db.update(people).set({ heightCm: 165, goal: "maintain", ratePct: 0, proteinGPerKg: 1.6 }).where(eq(people.id, "sam")).run();
  db.insert(weighIns).values({ id: "w1", personId: "sam", date: "2026-10-27", measuredAt: "2026-10-27T07:00:00Z", kg: 58, source: "manual" }).run();
  setOutside(db, "sam", 350, 12);
  j = eaterOf(db, db.select().from(people).where(eq(people.id, "sam")).get()!, new Date("2026-10-27T12:00:00Z"));
  assert.equal(j.source, "estimation");
  assert.deepEqual(j.missing, []);
  assert.ok(j.ref && j.ref.kcalMin > 400 && j.ref.kcalMax < 1000, JSON.stringify(j.ref));
  // Alex, sans pesée : pas encore de repère, la pesée manque.
  const h = eaterOf(db, db.select().from(people).where(eq(people.id, "alex")).get()!);
  assert.equal(h.ref, null);
  assert.ok(h.missing.includes("poids"));
});

test("goûts réglés dans l'appli : un dislike de départ retiré ne revient pas au seed", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const brocoli = listDislikes(db, "sam").find((d) => /brocoli/i.test(d.text))!;
  removeDislike(db, "sam", brocoli.id);
  addDislikes(db, "sam", "poivron, champignons");
  seedTest(db);
  const now = listDislikes(db, "sam").map((d) => d.text);
  assert.ok(!now.some((t) => /brocoli/i.test(t)));
  assert.ok(now.includes("Poivron") && now.includes("Champignons"));
});

test("repère fixe du profil : prime sur la formule, cède à la dépense mesurée, et fait la journée de la Semaine", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const ref = { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 };
  db.update(people).set({ fixedMealRef: ref, outsideKcal: 335, outsideProteinG: 43 }).where(eq(people.id, "alex")).run();
  db.insert(weighIns).values({ id: "w-a", personId: "alex", date: "2026-10-27", measuredAt: "2026-10-27T07:00:00Z", kg: 75, source: "manual" }).run();
  const a = eaterOf(db, db.select().from(people).where(eq(people.id, "alex")).get()!, new Date("2026-10-27T12:00:00Z"));
  assert.equal(a.source, "fixe");
  assert.deepEqual(a.ref, ref);
  // Alex a son shaker du matin (habitude, 336 kcal et 42 g, du lundi au vendredi) : il prime sur
  // le chiffre libre, en moyenne de la semaine.
  assert.equal(a.outsideSource, "habitudes");
  assert.deepEqual(a.outside, { kcal: Math.round((336 * 5) / 7), protein: Math.round((42 * 5) / 7) });
  let day = dayRefOf(a)!;
  assert.equal(day.source, "fixe");
  assert.equal(day.kcalMin, 2 * 700 + 240);
  // Sans habitude, le chiffre libre reprend la main.
  db.update(foodTemplates).set({ archived: true }).where(eq(foodTemplates.personId, "alex")).run();
  const b = eaterOf(db, db.select().from(people).where(eq(people.id, "alex")).get()!, new Date("2026-10-27T12:00:00Z"));
  assert.equal(b.outsideSource, "chiffre");
  day = dayRefOf(b)!;
  assert.equal(day.kcalMin, 2 * 700 + 335);
  assert.equal(day.proteinMax, 2 * 68 + 43);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNutrition, round, scale, verdictFor } from "@/lib/nutrition/compute";

const REF = { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 };

test("macros : grammes × valeurs pour 100 g, pièces converties, herbes ignorées", () => {
  const n = computeNutrition(
    [
      { item: "Filet de poulet", food: "filet_poulet", grams: 500, units: null }, // 550 kcal, 117,5 g P
      { item: "Œufs", food: "oeuf", grams: null, units: 2 }, // 120 g → 168 kcal, 15 g P
      { item: "Thym", food: "zero", grams: null, units: null },
    ],
    10
  );
  assert.equal(n.total.kcal, 718);
  assert.equal(n.total.protein, 132.5);
  assert.equal(n.coverage, 1);
  const h = round(scale(n.perUnit, 5));
  assert.equal(h.kcal, 359);
  assert.deepEqual(verdictFor(REF, h), { kcal: "low", protein: "ok" });
  assert.equal(verdictFor(null, h), null);
});

test("un ingrédient sans valeur baisse la couverture et est listé", () => {
  const n = computeNutrition([
    { item: "Riz", food: "riz_basmati", grams: 100, units: null },
    { item: "Truc inconnu", food: null, grams: 50, units: null },
  ], 5);
  assert.equal(n.coverage, 0.5);
  assert.deepEqual(n.missing, ["Truc inconnu"]);
});

// ─── Rendement : ce qui est réellement mangé ───
import fs from "fs";
import { eatenOf } from "@/lib/nutrition/compute";
import { PAN_LOSS } from "@/lib/nutrition/foods";
import { RecipeInput } from "@/lib/recipes/format";
import { dayRef, weekNutrition } from "@/lib/week/nutrition";

test("huile : le défaut est une saisie (30 % reste dans la poêle), une ligne peut le remplacer", () => {
  const def = eatenOf({ item: "Huile", food: "huile", grams: 45, units: null })!;
  assert.equal(PAN_LOSS.saisie, 30);
  assert.equal(def.panFatG, 13.5); // « 45 g dont ~14 g restent dans la poêle »
  assert.equal(Math.round(def.macros.kcal), 284); // 31,5 g × 9
  const sauce = eatenOf({ item: "Huile", food: "huile", grams: 45, units: null, yield: { panLossPct: 0 } })!;
  assert.equal(sauce.macros.kcal, 405);
  const n = computeNutrition([{ item: "Huile", food: "huile", grams: 45, units: null, yield: { panLossPct: 10 } }], 1);
  assert.equal(n.total.kcal, 365);
  assert.equal(n.total.fat, 40.5);
});

test("parure : la cuisse de poulet perd os et peau par défaut, les valeurs portent sur la viande", () => {
  const e = eatenOf({ item: "Cuisses de poulet", food: "cuisse_poulet", grams: 1000, units: null })!;
  assert.equal(e.trimG, 350);
  assert.equal(e.eatenG, 650);
  assert.equal(Math.round(e.macros.protein), 127); // 650 g × 19,5 %
  const sansParure = eatenOf({ item: "Cuisses", food: "cuisse_poulet", grams: 1000, units: null, yield: { trimPct: 0 } })!;
  assert.equal(sansParure.eatenG, 1000);
});

test("part du paquet : seul ce qui est utilisé compte (râpé 150 g sur 200 g, la moitié du pot)", () => {
  const rape = eatenOf({ item: "Râpé", food: "emmental_rape", grams: 200, units: null, yield: { usedGrams: 150 } })!;
  assert.equal(rape.usedG, 150);
  assert.equal(Math.round(rape.macros.kcal), 570);
  const pot = eatenOf({ item: "Colombo", food: "colombo", grams: 40, units: null, yield: { usedPct: 50 } })!;
  assert.equal(pot.usedG, 20);
  assert.equal(pot.macros.kcal, 60);
});

test("gras jeté d'une viande : seuls les lipides baissent", () => {
  const e = eatenOf({ item: "Saucisse", food: "saucisse_toulouse", grams: 700, units: null, yield: { panLossPct: 20 } })!;
  assert.equal(Math.round(e.panFatG * 10) / 10, 32.2); // 161 g de lipides × 20 %
  assert.equal(Math.round(e.macros.protein), 105); // inchangé
  assert.equal(Math.round(e.macros.kcal), 1600); // 1890 − 32,2 × 9
});

test("les fiches de src/seed/recipes passent le schéma et leurs rendements sont pris en compte", () => {
  const dir = "src/seed/recipes";
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const r = RecipeInput.parse(JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
    for (const i of r.ingredients.filter((x) => x.food === "huile")) assert.ok(i.yield?.panLossPct != null, `${f} : rendement de l'huile à préciser`);
    const n = computeNutrition(r.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })), r.servingsUnits);
    assert.equal(n.coverage, 1, f);
  }
});

// ─── Semaine ───

test("semaine : moyennes par repas et par jour, hors batch ajouté chaque jour compté", () => {
  const recipes = [{ id: "r1", kcalUnit: 160, proteinUnit: 12, carbsUnit: 10, fatUnit: 7, fiberUnit: 1 }];
  const slots = [
    { day: 0, meal: "lunch" as const, personId: "alex", portionUnits: 5, recipeId: "r1" },
    { day: 0, meal: "dinner" as const, personId: "alex", portionUnits: 5, recipeId: "r1" },
    { day: 5, meal: "lunch" as const, personId: "alex", portionUnits: 5, recipeId: "r1" },
    { day: 1, meal: "lunch" as const, personId: "alex", portionUnits: 5, recipeId: null }, // non couvert
    { day: 0, meal: "dinner" as const, personId: "sam", portionUnits: 4, recipeId: "r1" },
  ];
  const outside = new Map([["alex", { kcal: 335, protein: 43 }]]);
  const [h, j] = weekNutrition(slots, recipes, ["alex", "sam"], outside);
  assert.equal(h.meals, 3);
  assert.equal(h.days, 2);
  assert.equal(h.outsideDays, 2);
  assert.deepEqual(h.perMeal, { kcal: 800, protein: 60, carbs: 50, fat: 35, fiber: 5 });
  assert.ok(Math.abs(h.perDay!.kcal - (3 * 800 + 2 * 335) / 2) <= 0.5);
  assert.ok(Math.abs(h.perDay!.protein - (3 * 60 + 2 * 43) / 2) <= 0.5);
  assert.equal(j.outsideDays, 0);
  assert.deepEqual(j.perDay, { kcal: 640, protein: 48, carbs: 40, fat: 28, fiber: 4 });
  // Jour par jour (barres de la Semaine) : lundi = 2 repas + hors batch, mardi non couvert.
  assert.equal(h.byDay.length, 7);
  assert.equal(h.byDay[0]!.meals, 2);
  assert.ok(Math.abs(h.byDay[0]!.macros.kcal - (2 * 800 + 335)) <= 0.5);
  assert.equal(h.byDay[5]!.meals, 1);
  assert.equal(h.byDay[1], null);
  assert.equal(j.byDay[0]!.macros.kcal, 640);
});

test("semaine : une recette sans macros n'est pas comptée mais signalée", () => {
  const [h] = weekNutrition([{ day: 0, meal: "lunch", personId: "alex", portionUnits: 5, recipeId: "x" }], [{ id: "x", kcalUnit: null, proteinUnit: null }]);
  assert.equal(h.meals, 0);
  assert.equal(h.unknownMeals, 1);
  assert.equal(h.perDay, null);
});

test("repère de la Semaine : cible du jour de Santé, repas = (jour − hors batch) / 2", () => {
  const h = dayRef({ kcal: 2300, proteinG: 160 }, { kcal: 335, protein: 43 })!;
  assert.deepEqual([h.kcalMin, h.kcalMax, h.proteinMin, h.proteinMax, h.source], [2150, 2450, 147, 179, "sante"]);
  assert.equal(h.meal.kcalMin, Math.round((2150 - 335) / 2));
  assert.equal(h.meal.proteinMax, Math.round((179 - 43) / 2));
  const j = dayRef({ kcal: 1800, proteinG: 100 })!;
  assert.equal(j.meal.kcalMin, 825);
  // Sans cible : pas de repère.
  assert.equal(dayRef(null), null);
});

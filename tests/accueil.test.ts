// Accueil : l'action du moment et le titre de la semaine (src/lib/home/next.ts, pur), puis ce que la
// page lit en base (src/lib/home/store.ts) sur le foyer fictif Alex et Sam.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { openDb } from "@/lib/db/open";
import { cookSessions } from "@/lib/db/schema";
import { upsertRecipe } from "@/lib/recipes/store";
import { addRecipe, weekView } from "@/lib/week/store";
import { buildPlan } from "@/lib/session/store";
import { dayWord, headline, minutesText, nextStep, stepLabel, type HomeState } from "@/lib/home/next";
import { groupBoxes, homeView } from "@/lib/home/store";
import type { StockBox } from "@/lib/boxes/store";
import { seedTest } from "./helpers";

const NB = " ";
const base: HomeState = { active: null, dishes: 3, missing: 0, cooked: false, list: { id: "L", ordered: true, changed: false, building: false }, cookDay: "2026-11-01", today: "2026-10-31" };

test("l'action du moment suit l'ordre du batch", () => {
  assert.deepEqual(nextStep({ ...base, active: { id: "S" } }), { kind: "resume", sessionId: "S" });
  assert.deepEqual(nextStep({ ...base, dishes: 0, list: null }), { kind: "choose" });
  assert.deepEqual(nextStep({ ...base, missing: 4 }), { kind: "cover", missing: 4 });
  assert.deepEqual(nextStep({ ...base, cooked: true }), { kind: "eat" });
  assert.deepEqual(nextStep({ ...base, list: null }), { kind: "list", changed: false });
  assert.deepEqual(nextStep({ ...base, list: { ...base.list!, changed: true } }), { kind: "list", changed: true });
  assert.deepEqual(nextStep({ ...base, list: { ...base.list!, ordered: false, building: true } }), { kind: "wait", listId: "L" });
  assert.deepEqual(nextStep({ ...base, list: { ...base.list!, ordered: false } }), { kind: "shop", listId: "L" });
  assert.deepEqual(nextStep(base), { kind: "cook", listId: "L" });
});

test("le bouton nomme ce qu'on fait, le jour dit par rapport à aujourd'hui", () => {
  const cook = { kind: "cook", listId: "L" } as const;
  assert.equal(stepLabel(cook, "2026-11-01", "2026-10-31"), "Cuisiner demain");
  assert.equal(stepLabel(cook, "2026-11-01", "2026-10-28"), "Cuisiner dimanche");
  assert.equal(stepLabel(cook, "2026-11-01", "2026-11-01"), "Cuisiner maintenant");
  assert.equal(stepLabel(cook, "2026-11-01", "2026-11-03"), "Cuisiner maintenant");
  assert.equal(stepLabel({ kind: "choose" }, base.cookDay, base.today), "Choisir les plats de la semaine");
  assert.equal(stepLabel({ kind: "cover", missing: 1 }, base.cookDay, base.today), "Couvrir le repas qui manque");
  assert.equal(stepLabel({ kind: "shop", listId: "L" }, base.cookDay, base.today), "Faire les courses");
  assert.equal(dayWord("2026-11-01", "2026-11-01"), "aujourd’hui");
  assert.equal(dayWord("2026-10-25", "2026-10-31"), "dimanche dernier");
  assert.equal(dayWord("2026-11-08", "2026-10-31"), "dimanche 8 novembre");
});

test("le titre de la semaine : des chiffres, une ligne par idée", () => {
  assert.equal(minutesText(158), `2${NB}h${NB}40`);
  assert.equal(minutesText(42), `40${NB}min`);
  assert.deepEqual(headline({ dishes: 3, meals: 28, minutes: 160, cookDay: "2026-11-01", today: "2026-10-28" }), [`3${NB}plats,`, `28${NB}repas,`, `2${NB}h${NB}40 dimanche.`]);
  assert.deepEqual(headline({ dishes: 1, meals: 1, minutes: null, cookDay: "2026-11-01", today: "2026-10-31" }), [`1${NB}plat,`, `1${NB}repas,`, "en cuisine demain."]);
  assert.deepEqual(headline({ dishes: 0, meals: 28, minutes: null, cookDay: "2026-11-01", today: "2026-10-31" }), [`28${NB}repas`, "à prévoir."]);
});

test("frigo : boîtes regroupées par plat et date limite, la plus pressée d'abord", () => {
  const box = (id: string, name: string, limit: string, person: string): StockBox => ({
    id, name, slug: name.toLowerCase(), personId: person, personName: person, grams: 400, sideGrams: null, sideLabel: null, kcal: 600, proteinG: 40,
    cookedOn: "2026-11-01", plannedFor: null, plannedMeal: null, place: "fridge", thawed: false, limit, freshness: "ok",
  });
  const g = groupBoxes([box("1", "Dahl", "2026-11-04", "Sam"), box("2", "Chasseur", "2026-11-03", "Alex"), box("3", "Chasseur", "2026-11-03", "Sam"), box("4", "Chasseur", "2026-11-03", "Alex")]);
  assert.deepEqual(g.map((x) => [x.name, x.count, x.people.join(",")]), [["Chasseur", 3, "Alex,Sam"], ["Dahl", 1, "Sam"]]);
});

test("en base : de la semaine vide à la liste de courses, puis « Ouvrir le frigo » quand la session est finie", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  for (const f of ["chasseur-porc.json", "butter-chicken-express.json"]) upsertRecipe(db, JSON.parse(fs.readFileSync(`src/seed/recipes/${f}`, "utf8")));
  // Mercredi 28 octobre : la période par défaut est la semaine en cours (du lundi 26).
  const now = new Date("2026-10-28T10:00:00Z");
  let h = homeView(db, "sam", now);
  assert.equal(h.step.kind, "choose");
  assert.equal(h.dishes.length, 0);
  assert.equal(h.start, "2026-10-26");
  assert.equal(h.toEat, 28);

  addRecipe(db, h.start, "chasseur-porc");
  addRecipe(db, h.start, "butter-chicken-express");
  h = homeView(db, "sam", now);
  assert.equal(h.dishes.length, 2);
  assert.ok(h.minutes! > 30);
  assert.equal(h.covered + (h.toEat - h.covered), h.toEat);
  assert.equal(h.week.length, 7);
  assert.equal(h.lead?.name, "Sam");
  // Les repas du jour de Sam (mercredi) : ceux de la grille, avec leurs calories.
  const view = weekView(db, h.start);
  const samToday = view.grid.filter((s) => s.day === 2 && s.personId === "sam" && s.slug);
  assert.equal(h.todayMeals.length, samToday.length);
  assert.ok(h.todayMeals.every((m) => m.kcal == null || m.kcal > 0));
  if (h.step.kind !== "cover") assert.equal(h.step.kind, "list");

  // Une session finie sur cette période : place au frigo.
  const plan = buildPlan(db, { slugs: ["chasseur-porc", "butter-chicken-express"], mode: "solo" });
  db.insert(cookSessions).values({ id: "S", weekPlanId: view.planId, planJson: plan, status: "done" }).run();
  h = homeView(db, "sam", now);
  assert.equal(h.cooked, true);
  if (h.step.kind !== "cover") assert.equal(h.step.kind, "eat");
});

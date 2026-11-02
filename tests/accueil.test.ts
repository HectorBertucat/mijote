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
import { coverIgnored, dayWord, headline, minutesText, nextStep, stepLabel, type HomeState } from "@/lib/home/next";
import { homeView } from "@/lib/home/store";
import { setMissingIgnored } from "@/lib/week/store";
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

test("repas sans plat ignorés : l'étape passe, et revient si d'autres repas se retrouvent sans plat", () => {
  assert.equal(coverIgnored(2, null), false);
  assert.equal(coverIgnored(2, 2), true);
  assert.equal(coverIgnored(1, 2), true);
  assert.equal(coverIgnored(3, 2), false);
  assert.equal(coverIgnored(0, 2), false);
  assert.deepEqual(nextStep({ ...base, missing: 2, missingIgnored: 2 }), { kind: "cook", listId: "L" });
  assert.deepEqual(nextStep({ ...base, missing: 2, missingIgnored: 2, cooked: true }), { kind: "eat" });
  assert.deepEqual(nextStep({ ...base, missing: 3, missingIgnored: 2 }), { kind: "cover", missing: 3 });
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

test("en base : de la semaine vide à la liste de courses, puis « Voir nos plats » quand la session est finie", () => {
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
  // Que manger : rien de cuit, les portions prévues des plats de la période, pour chacun.
  const view = weekView(db, h.start);
  assert.equal(h.reserve.length, 0);
  assert.deepEqual(h.planned.map((d) => d.slug).sort(), ["butter-chicken-express", "chasseur-porc"].filter((x) => view.grid.some((s) => s.slug === x)).sort());
  const samMeals = view.grid.filter((s) => s.personId === "sam" && s.slug && s.place !== "away").length;
  assert.equal(h.planned.reduce((n, d) => n + (d.people.find((p) => p.personId === "sam")?.total ?? 0), 0), samMeals);
  assert.deepEqual(h.people.map((p) => p.name).sort(), ["Alex", "Sam"]);
  if (h.step.kind === "cover") {
    // Ignorer pour cette période : l'étape passe à la liste, la note reste (réversible).
    setMissingIgnored(db, h.start, h.step.missing);
    const g = homeView(db, "sam", now);
    assert.equal(g.step.kind, "list");
    assert.equal(g.missingIgnored, true);
    setMissingIgnored(db, h.start, null);
    assert.equal(homeView(db, "sam", now).step.kind, "cover");
  } else assert.equal(h.step.kind, "list");

  // Une session finie sur cette période : place au frigo.
  const plan = buildPlan(db, { slugs: ["chasseur-porc", "butter-chicken-express"], mode: "solo" });
  db.insert(cookSessions).values({ id: "S", weekPlanId: view.planId, planJson: plan, status: "done" }).run();
  h = homeView(db, "sam", now);
  assert.equal(h.cooked, true);
  if (h.step.kind !== "cover") assert.equal(h.step.kind, "eat");
});

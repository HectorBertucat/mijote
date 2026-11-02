// Le bilan du batch (src/lib/reserve/batch.ts, pur ; store.ts en base) : une session finie sans pesée met
// ses plats en réserve, estimés ; la pesée vient plus tard, avant ou après un repas ; le premier pas
// « Peser et ranger » mène au bilan et n'est fait qu'une fois un plat pesé. Foyer fictif Alex et Sam.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { eq } from "drizzle-orm";
import { batchInPeriod, batchSummary, batchTitle, estimatedReserve, toEstimate, weighedOnce, weighState, type SessionIn } from "@/lib/reserve/batch";
import { splitGroups } from "@/lib/reserve/core";
import { adjustReserve, batchView, calcModel, currentBatch, eatPortion, ensureEstimates, listDishes, saveReserve, sessionReserves } from "@/lib/reserve/store";
import { firstSteps } from "@/lib/tour/core";
import { firstStepsFacts, tourView } from "@/lib/tour/store";
import { openDb } from "@/lib/db/open";
import { cookEvents, cookSessions, mealSlots, recipes, reserves, weekPlans } from "@/lib/db/schema";
import { upsertRecipe } from "@/lib/recipes/store";
import { setSetting, SETTING } from "@/lib/settings";
import { seedTest } from "./helpers";

// ─── Pur ───

test("état de pesée : estimé, en partie pesé, pesé", () => {
  assert.equal(weighState([{ estimated: true }, { estimated: true }]), "estimated");
  assert.equal(weighState([{ estimated: false }, { estimated: true }]), "partial");
  assert.equal(weighState([{}, {}]), "weighed");
  assert.equal(weighState([]), "weighed");
});

const S = (id: string, cookedOn: string, endedAt: string, recipeIds: string[], cooked = true): SessionIn => ({ id, cookedOn, endedAt, cooked, recipeIds });

test("plats à estimer : la dernière session qui a cuisiné, une fois par recette, dans la fenêtre", () => {
  const today = "2026-11-02";
  // Une session finie, rien en réserve : ses deux plats.
  assert.deepEqual(toEstimate([S("A", "2026-11-01", "2026-11-01T18:00:00Z", ["r1", "r2"])], [], today), [
    { sessionId: "A", recipeId: "r1" },
    { sessionId: "A", recipeId: "r2" },
  ]);
  // Déjà en réserve (rangé depuis cette session ou une autre, le lendemain) : rien.
  assert.deepEqual(toEstimate([S("A", "2026-11-01", "2026-11-01T18:00:00Z", ["r1", "r2"])], [{ recipeId: "r1", cookedOn: "2026-11-02" }], today), [{ sessionId: "A", recipeId: "r2" }]);
  // Une réserve d'un batch d'avant ne compte pas.
  assert.equal(toEstimate([S("A", "2026-11-01", "2026-11-01T18:00:00Z", ["r1"])], [{ recipeId: "r1", cookedOn: "2026-10-20" }], today).length, 1);
  // Deux sessions du même batch (relancée) : seule la dernière qui a cuisiné.
  assert.deepEqual(toEstimate([S("A", "2026-11-01", "2026-11-01T17:00:00Z", ["r1"]), S("B", "2026-11-01", "2026-11-01T19:00:00Z", ["r1"])], [], today), [{ sessionId: "B", recipeId: "r1" }]);
  // Une session terminée sans rien cuire (ouverte pour ranger) ne compte pas.
  assert.deepEqual(toEstimate([S("A", "2026-11-01", "2026-11-01T17:00:00Z", ["r1"]), S("B", "2026-11-02", "2026-11-02T19:00:00Z", ["r1"], false)], [], today), [{ sessionId: "A", recipeId: "r1" }]);
  // Au-delà de 7 jours : rien.
  assert.equal(toEstimate([S("A", "2026-10-20", "2026-10-20T18:00:00Z", ["r1"])], [], today).length, 0);
});

test("résumé et titre du batch, batch d'une période", () => {
  const s = batchSummary([
    { open: true, weigh: "estimated", total: 7, left: 7 },
    { open: true, weigh: "weighed", total: 6, left: 4 },
    { open: false, weigh: "partial", total: 5, left: 0 },
  ]);
  assert.deepEqual(s, { dishes: 3, toWeigh: 1, portions: 18, left: 11, estimated: true });
  assert.equal(batchTitle("2026-11-01"), "Le batch du 1er novembre");
  assert.equal(batchTitle("2026-11-14"), "Le batch du 14 novembre");
  assert.ok(batchInPeriod("2026-11-01", "2026-11-02", 7));
  assert.ok(!batchInPeriod("2026-10-25", "2026-11-02", 7));
});

test("premier pas « Peser et ranger » : fait quand un plat est pesé en entier ; sinon il mène au bilan", () => {
  assert.equal(weighedOnce([{ groups: [{ estimated: true }] }], false), false);
  assert.equal(weighedOnce([{ groups: [{ estimated: true }] }, { groups: [{}, {}] }], false), true);
  assert.equal(weighedOnce([], true), true);
  const facts = { target: true, dishes: true, list: true, session: true, boxes: false };
  const pending = firstSteps(facts, { id: "S", title: "Le batch du 1er novembre", toWeigh: 3 });
  const step = pending.items.find((i) => i.id === "boxes")!;
  assert.equal(step.done, false);
  assert.equal(step.href, "/plats/batch/S");
  assert.match(step.hint, /3 plats à peser/);
  assert.equal(firstSteps(facts).items.find((i) => i.id === "boxes")!.href, "/plats");
  assert.equal(firstSteps({ ...facts, boxes: true }, null).complete, true);
});

// ─── En base ───

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  for (const f of ["poulet-teriyaki-riz.json", "chasseur-porc.json"]) upsertRecipe(db, JSON.parse(fs.readFileSync(`src/seed/recipes/${f}`, "utf8")));
  const r = db.select().from(recipes).where(eq(recipes.slug, "poulet-teriyaki-riz")).get()!;
  const c = db.select().from(recipes).where(eq(recipes.slug, "chasseur-porc")).get()!;
  const plan = { version: 1, recipes: [r, c].map((x, i) => ({ slug: x.slug, name: x.name, color: `var(--c-recipe-${i + 1})`, scale: 1 })), steps: [] };
  db.insert(cookSessions).values({ id: "S", planJson: plan, status: "done", startedAt: "2026-11-01T14:00:00Z", endedAt: "2026-11-01T17:00:00Z" }).run();
  db.insert(cookEvents).values({ id: "e1", sessionId: "S", at: "2026-11-01T15:00:00Z", kind: "step_done", ref: "s1" }).run();
  db.insert(weekPlans).values({ id: "W", weekStart: "2026-11-02" }).run();
  const slot = (day: number, meal: "lunch" | "dinner", personId: string, recipeId: string) => ({ id: `${day}${meal}${personId}`, weekPlanId: "W", day, meal, personId, place: "home" as const, recipeId });
  db.insert(mealSlots).values([slot(0, "lunch", "alex", r.id), slot(1, "lunch", "alex", r.id), slot(0, "dinner", "sam", r.id), slot(1, "dinner", "sam", c.id), slot(2, "dinner", "alex", c.id)]).run();
  return { db, r, c };
}
const NOW = new Date("2026-11-01T18:00:00Z");

test("portions estimées sans pesée : la session finie met ses plats en réserve, marqués estimés", () => {
  const { db, r } = setup();
  const m = calcModel(db, r.slug, { cookedOn: "2026-11-01", week: true }, NOW)!;
  // Pur : les groupes estimés d'après le cru, les portions de la Semaine plus la marge.
  const est = estimatedReserve(m, NOW.toISOString());
  assert.ok(est.groups.every((g) => g.estimated && g.g > 0));
  assert.ok(est.counts.alex >= 2 && est.counts.sam >= 1);
  const split = splitGroups(est.groups, Object.fromEntries(est.groups.map((g) => [g.key, g.g])), m.people, est.counts);
  assert.ok(split.portions.alex.grams.plat > 0 && split.portions.alex.grams.riz > 0, "des grammes par groupe, même sans pesée");

  // En base : lues par Nos plats, les deux réserves existent, estimées ; une seule fois.
  const dishes = listDishes(db, "alex", NOW).filter((d) => d.status === "cooked");
  assert.equal(dishes.length, 2);
  assert.ok(dishes.every((d) => d.estimated && d.sessionId === "S"));
  assert.ok(dishes.every((d) => d.people.find((p) => p.personId === "alex")!.next!.grams.length > 0));
  assert.equal(ensureEstimates(db, NOW), 0);
  assert.equal(db.select().from(reserves).all().length, 2);
  // Plus « à cuisiner » : les plats sont cuits.
  assert.equal(listDishes(db, "alex", NOW).filter((d) => d.status === "planned").length, 0);

  const b = batchView(db, "S", NOW)!;
  assert.equal(b.title, "Le batch du 1er novembre");
  assert.equal(b.summary.toWeigh, 2);
  assert.ok(b.dishes.every((d) => d.weigh === "estimated" && d.groups.every((g) => g.estimated)));
  assert.equal(currentBatch(db, NOW)?.id, "S");
  const saved = sessionReserves(db, "S", NOW)!.saved[r.id];
  assert.equal(saved.weigh, "estimated");
  assert.equal(saved.eaten, 0);
});

test("estimé → pesé : avant un repas (la marmite entière), après un repas (ce qui reste), kcal gardées", () => {
  const { db, r, c } = setup();
  listDishes(db, "alex", NOW);
  const before = db.select().from(reserves).where(eq(reserves.recipeId, r.id)).get()!;
  const kcal = before.groups.reduce((s, g) => s + g.g * g.kcalG!, 0);
  // Pesée tardive, rien de mangé : la réserve de la session, pesée, mêmes portions de chacun.
  const counts = sessionReserves(db, "S", NOW)!.saved[r.id].counts;
  saveReserve(db, "S", r.id, { weights: { plat: 1500, riz: 1100, "haricots-verts": 600 }, counts, freezer: {} }, new Date("2026-11-01T20:00:00Z"));
  const after = db.select().from(reserves).where(eq(reserves.recipeId, r.id)).get()!;
  assert.equal(after.id, before.id);
  assert.equal(weighState(after.groups), "weighed");
  assert.ok(Math.abs(after.groups.reduce((s, g) => s + g.g * g.kcalG!, 0) - kcal) < 1, "la pesée ne change pas les kcal de la marmite");

  // L'autre plat : une portion mangée avant de peser, puis la pesée de ce qui reste.
  const ch = listDishes(db, "sam", NOW).find((d) => d.recipeId === c.id)!;
  assert.ok(ch.estimated);
  eatPortion(db, ch.id, "sam", {}, new Date("2026-11-02T19:00:00Z"));
  const row = db.select().from(reserves).where(eq(reserves.id, ch.id)).get()!;
  const leftG = Object.fromEntries(listDishes(db, "sam", new Date("2026-11-02T19:30:00Z")).find((d) => d.id === ch.id)!.groups.map((g) => [g.key, g.leftG!]));
  const leftKcal = row.groups.reduce((s, g) => s + leftG[g.key] * g.kcalG!, 0);
  const at = new Date("2026-11-02T20:00:00Z");
  adjustReserve(db, ch.id, { weights: Object.fromEntries(row.groups.map((g) => [g.key, Math.round(leftG[g.key] * 0.9)])) }, at);
  const w = db.select().from(reserves).where(eq(reserves.id, ch.id)).get()!;
  assert.equal(weighState(w.groups), "weighed");
  const now = listDishes(db, "sam", at).find((d) => d.id === ch.id)!;
  assert.equal(now.estimated, false);
  assert.ok(Math.abs(w.groups.reduce((s, g) => s + (now.groups.find((x) => x.key === g.key)!.leftG ?? 0) * g.kcalG!, 0) - leftKcal) < leftKcal * 0.02, "les kcal restantes ne changent pas");
  assert.equal(now.people.find((p) => p.personId === "sam")!.eaten, 1);
  assert.equal(batchView(db, "S", at)!.summary.toWeigh, 0);
});

test("premier pas en base : la session finie sans pesée n'est pas « rangée », le pas mène au bilan ; pesée, il est fait", () => {
  const { db, r } = setup();
  setSetting(db, SETTING.setupDone, NOW.toISOString());
  listDishes(db, "alex", NOW);
  assert.equal(firstStepsFacts(db, "alex").boxes, false);
  const step = tourView(db, "alex").steps.items.find((i) => i.id === "boxes")!;
  assert.equal(step.href, "/plats/batch/S");
  const counts = sessionReserves(db, "S", NOW)!.saved[r.id].counts;
  saveReserve(db, "S", r.id, { weights: { plat: 1500, riz: 1100, "haricots-verts": 600 }, counts, freezer: {} }, NOW);
  assert.equal(firstStepsFacts(db, "alex").boxes, true);
});

test("une session test, ou finie sans rien cuire, ne met rien en réserve", () => {
  const { db } = setup();
  db.update(cookSessions).set({ test: true }).where(eq(cookSessions.id, "S")).run();
  assert.equal(ensureEstimates(db, NOW), 0);
  db.update(cookSessions).set({ test: false }).where(eq(cookSessions.id, "S")).run();
  db.delete(cookEvents).run();
  assert.equal(ensureEstimates(db, NOW), 0);
  assert.equal(batchView(db, "S", NOW), null);
});

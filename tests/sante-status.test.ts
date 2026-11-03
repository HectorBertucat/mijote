// « Où j'en suis » : repère automatique (bornes, pas), source de la cible et ce qui manque pour qu'elle
// s'ajuste, rythme, protéines, journée complète en un geste, et l'API de l'app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { AUTO_REF, autoMealRef } from "@/lib/eaters/core";
import { eaterOf } from "@/lib/eaters/store";
import { completeDay, dayCheck, isComplete, listEntries, listTemplates, pending, plannedMeals } from "@/lib/health/log";
import { paceOf, whereIAm, type StatusInput } from "@/lib/health/status";
import { statusFor } from "@/lib/health/status-store";
import type { IntakeDay, Profile, WeighIn } from "@/lib/health/core";
import { appApi } from "@/lib/app-api/core";
import { ensureLink } from "@/lib/health/link";
import { openDb } from "@/lib/db/open";
import { people, weeklyTargets, weighIns } from "@/lib/db/schema";
import { addDays } from "@/lib/week/propose";
import { seedTest } from "./helpers";

// ─── Repère automatique ───

test("repère automatique : sans repère d'avant, celui de la cible ; ensuite, d'au plus un pas", () => {
  const t = { kcal: 2400, proteinG: 160 };
  const out = { kcal: 340, protein: 40 };
  const first = autoMealRef(t, out, null);
  assert.deepEqual(first.ref, { kcalMin: 955, kcalMax: 1105, proteinMin: 54, proteinMax: 70 });
  assert.deepEqual(first.ref, first.raw);
  assert.equal(first.limited, false);
  // La semaine d'avant visait 700–760 kcal : le milieu monte de 100 kcal au plus, la largeur reste celle de la cible.
  const next = autoMealRef(t, out, { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 });
  assert.equal(next.limited, true);
  assert.deepEqual(next.ref, { kcalMin: 730 + AUTO_REF.kcalStep - 75, kcalMax: 730 + AUTO_REF.kcalStep + 75, proteinMin: 54, proteinMax: 70 });
  // Une cible qui ne bouge pas ne bouge pas le repère.
  assert.deepEqual(autoMealRef(t, out, first.ref).ref, first.ref);
});

test("repère automatique : le milieu reste dans ses bornes", () => {
  const low = autoMealRef({ kcal: 900, proteinG: 40 }, { kcal: 400, protein: 10 }, null);
  assert.equal(low.bounded, true);
  assert.equal((low.ref.kcalMin + low.ref.kcalMax) / 2, AUTO_REF.kcalMin);
  assert.ok((low.ref.proteinMin + low.ref.proteinMax) / 2 >= AUTO_REF.proteinMin);
  const high = autoMealRef({ kcal: 4200, proteinG: 300 }, { kcal: 0, protein: 0 }, null);
  assert.equal((high.ref.kcalMin + high.ref.kcalMax) / 2, AUTO_REF.kcalMax);
  assert.equal((high.ref.proteinMin + high.ref.proteinMax) / 2, AUTO_REF.proteinMax);
});

// ─── Où j'en suis (pur) ───

const TODAY = "2026-11-04"; // un mercredi : prochaine mise à jour le lundi 9, fenêtre du 19 octobre au 8 novembre
const PROFILE: Profile = { sex: "m", birthDate: "1990-06-13", heightCm: 180, activity: "moderate", goal: "recomp", ratePct: -0.4, proteinGPerKg: null, proteinG: 160 };
const weighs = (dates: string[], kg = (i: number) => 75 - i * 0.02): WeighIn[] => dates.map((d, i) => ({ date: d, measuredAt: `${d}T07:00:00Z`, kg: kg(i) }));
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const intake = (complete: string[], logged: string[] = []): IntakeDay[] => [...complete.map((d) => ({ date: d, kcal: 2300, proteinG: 150, complete: true })), ...logged.map((d) => ({ date: d, kcal: 1500, proteinG: 90, complete: false }))];
const base = (over: Partial<StatusInput> = {}): StatusInput => ({
  today: TODAY,
  profile: PROFILE,
  review: { tdee: 2600, confidence: "estimate", targets: { kcal: 2380, proteinG: 160, fatMinG: 45, dailyDeltaKcal: -220 } },
  weighIns: weighs(days("2026-09-01", TODAY)),
  intake: [],
  meal: { mode: "auto", ref: { kcalMin: 950, kcalMax: 1100, proteinMin: 54, proteinMax: 70 }, targetRef: { kcalMin: 950, kcalMax: 1100, proteinMin: 54, proteinMax: 70 }, limited: false },
  ...over,
});

test("où j'en suis : trop peu de journées complètes pour lundi, et le lundi où ce sera possible", () => {
  const s = whereIAm(base({ intake: intake(["2026-10-20", "2026-10-27", "2026-11-02"], ["2026-11-03"]) }));
  assert.equal(s.update.next, "2026-11-09");
  assert.deepEqual(s.update.window, { start: "2026-10-19", end: "2026-11-08" });
  assert.equal(s.update.complete.have, 3);
  assert.equal(s.update.complete.need, 12);
  assert.equal(s.update.complete.daysLeft, 5);
  assert.equal(s.update.ready, false);
  assert.equal(s.update.nextConfidence, "estimate");
  assert.ok(s.todo.some((x) => /ce ne sera pas assez lundi/.test(x)), s.todo.join(" | "));
  // En notant chaque jour à partir d'aujourd'hui : 2 + 12 journées dans la fenêtre du lundi 16.
  assert.equal(s.update.measuredBy, "2026-11-16");
  assert.ok(s.todo.some((x) => /lundi 16 novembre/.test(x)));
  assert.equal(s.target?.word, "estimation");
  assert.match(s.headline, /mesurée le lundi 16 novembre/);
});

test("où j'en suis : assez de jours restants, il dit combien de journées complètes de plus", () => {
  const done = days("2026-10-19", "2026-10-28").slice(0, 9); // 9 sur 12
  const s = whereIAm(base({ intake: intake(done), review: { tdee: 2600, confidence: "holding", targets: { kcal: 2380, proteinG: 160, fatMinG: 45, dailyDeltaKcal: -220 } } }));
  assert.ok(s.todo.some((x) => x.startsWith("3 journées complètes de plus d’ici dimanche")), s.todo.join(" | "));
  assert.equal(s.update.nextConfidence, "holding");
  assert.equal(s.update.measuredBy, "2026-11-09");
});

test("où j'en suis : peu de pesées, il demande de se peser ; tout y est, la dépense sera mesurée", () => {
  const few = whereIAm(base({ weighIns: weighs(["2026-09-10", "2026-10-01", "2026-10-25"]) }));
  assert.equal(few.update.weighIns.have, 1);
  assert.equal(few.update.weighIns.thisWeek, 0);
  assert.ok(few.todo.some((x) => /^Pèse-toi 2.fois de plus d’ici dimanche/.test(x)), few.todo.join(" | "));
  // Une première pesée trop récente : la tendance n'existe pas au début de la fenêtre.
  const late = whereIAm(base({ weighIns: weighs(days("2026-10-25", TODAY)), intake: intake(days("2026-10-19", "2026-10-30")) }));
  assert.equal(late.update.firstWeighOk, false);
  assert.equal(late.update.ready, false);
  assert.ok(late.todo.some((x) => /première date du/.test(x)));
  const ready = whereIAm(base({ intake: intake(days("2026-10-19", "2026-10-30")) }));
  assert.equal(ready.update.ready, true);
  assert.equal(ready.update.nextConfidence, "adaptive");
  assert.deepEqual(ready.todo, []);
  // Sans aucune pesée : la première d'abord.
  assert.ok(whereIAm(base({ weighIns: [] })).todo[0].startsWith("Pèse-toi"));
});

test("rythme réel face au visé", () => {
  assert.equal(paceOf(-0.3, -0.29), "rythme");
  assert.equal(paceOf(0.2, -0.3), "inverse");
  assert.equal(paceOf(-0.08, -0.3), "lent");
  assert.equal(paceOf(-0.6, -0.3), "rapide");
  assert.equal(paceOf(0.05, 0), "stable");
  assert.equal(paceOf(0.3, 0), "ecart");
  const s = whereIAm(base());
  assert.ok(s.trend && s.trend.rateKg != null && s.trend.rateKg < 0);
  assert.equal(s.trend!.aimedPct, -0.4);
  assert.match(s.trend!.text, /\(visé −0,30\)/);
});

test("protéines : moyenne des journées complètes, g/kg proposé en recomposition", () => {
  const s = whereIAm(base({ intake: intake(["2026-10-27", "2026-11-02"], ["2026-11-03"]) }));
  assert.equal(s.protein.avg, 150);
  assert.equal(s.protein.days, 2);
  assert.equal(s.protein.fromComplete, true);
  assert.equal(s.protein.mode, "g");
  assert.ok(s.protein.suggestPerKg! > 2 && s.protein.suggestPerKg! <= 2.4);
  // En g/kg déjà, ou hors recomposition : rien à proposer.
  assert.equal(whereIAm(base({ profile: { ...PROFILE, proteinG: null, proteinGPerKg: 2.2 } })).protein.suggestPerKg, null);
  assert.equal(whereIAm(base({ profile: { ...PROFILE, goal: "gain", ratePct: 0.25 } })).protein.suggestPerKg, null);
  // Sans journée complète : les jours notés de la semaine, et on le dit.
  const partial = whereIAm(base({ intake: intake([], ["2026-11-02", "2026-11-03"]) }));
  assert.equal(partial.protein.fromComplete, false);
  assert.equal(partial.protein.avg, 90);
});

test("portions : un repère fixe ne suit pas la cible, et on le dit", () => {
  const fixed = whereIAm(base({ meal: { mode: "fixe", ref: { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 }, targetRef: { kcalMin: 950, kcalMax: 1100, proteinMin: 54, proteinMax: 70 }, limited: false } }));
  assert.equal(fixed.portions.follows, false);
  assert.match(fixed.portions.text, /ne suit pas ta cible/);
  assert.match(fixed.portions.text, /950–1.100/);
  const auto = whereIAm(base({ meal: { mode: "auto", ref: { kcalMin: 755, kcalMax: 905, proteinMin: 54, proteinMax: 70 }, targetRef: { kcalMin: 955, kcalMax: 1105, proteinMin: 54, proteinMax: 70 }, limited: true } }));
  assert.equal(auto.portions.follows, true);
  assert.match(auto.portions.text, /d’au plus 100.kcal par semaine/);
  assert.match(auto.portions.next!, /déjà mangé ne change pas/);
});

// ─── Base : mode du repère, pas mesuré à la semaine d'avant, journée complète ───

const alexOf = (db: ReturnType<typeof openDb>["db"]) => db.select().from(people).where(eq(people.id, "alex")).get()!;

test("mangeur : repère automatique par défaut, gardé pour la semaine, d'un pas limité depuis la semaine d'avant", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  db.insert(weighIns).values({ id: "w-a", personId: "alex", date: "2026-10-27", measuredAt: "2026-10-27T07:00:00Z", kg: 75, source: "manual" }).run();
  const now = new Date("2026-11-04T12:00:00Z");
  let a = eaterOf(db, alexOf(db), now);
  assert.equal(a.refMode, "auto");
  assert.equal(a.source, "estimation");
  assert.ok(a.ref && a.dayTarget);
  assert.deepEqual(a.ref, a.targetRef);
  const row = db.select().from(weeklyTargets).where(eq(weeklyTargets.weekStart, "2026-11-02")).get()!;
  assert.deepEqual(row.mealRef, a.ref);
  // La semaine d'avant visait bien moins : le repère s'en rapproche de 100 kcal au plus.
  db.insert(weeklyTargets).values({ id: "wt-old", personId: "alex", weekStart: "2026-10-26", tdeeKcal: 2400, kcalTarget: 2000, proteinG: 160, fatMinG: 45, confidence: "estimate", mealRef: { kcalMin: 500, kcalMax: 560, proteinMin: 50, proteinMax: 60 } }).run();
  a = eaterOf(db, alexOf(db), now);
  assert.equal(a.refLimited, true);
  assert.equal((a.ref!.kcalMin + a.ref!.kcalMax) / 2, 530 + AUTO_REF.kcalStep);
});

test("mangeur : en mode fixe, le repère fixe tel quel ; « où j'en suis » le dit et propose les g/kg", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const ref = { kcalMin: 700, kcalMax: 760, proteinMin: 52, proteinMax: 68 };
  db.update(people).set({ fixedMealRef: ref, mealRefAuto: false }).where(eq(people.id, "alex")).run();
  db.insert(weighIns).values({ id: "w-a", personId: "alex", date: "2026-10-27", measuredAt: "2026-10-27T07:00:00Z", kg: 75, source: "manual" }).run();
  const now = new Date("2026-11-04T12:00:00Z");
  const a = eaterOf(db, alexOf(db), now);
  assert.equal(a.refMode, "fixe");
  assert.equal(a.source, "fixe");
  assert.deepEqual(a.ref, ref);
  assert.equal(a.dayTarget, null);
  assert.ok(a.targetRef && a.targetRef.kcalMin !== ref.kcalMin);
  const s = statusFor(db, alexOf(db), now);
  assert.equal(s.portions.mode, "fixe");
  assert.equal(s.protein.suggestPerKg, 2.1); // 160 g pour 75 kg
  assert.equal(s.days.length, 17); // du 19 octobre au 4 novembre
  // Repasser en automatique : le repère fixe devient le point de départ du premier pas.
  db.update(people).set({ mealRefAuto: true }).where(eq(people.id, "alex")).run();
  const b = eaterOf(db, alexOf(db), now);
  assert.equal(b.refMode, "auto");
  assert.ok(Math.abs((b.ref!.kcalMin + b.ref!.kcalMax) / 2 - 730) <= AUTO_REF.kcalStep);
});

test("journée complète : ce qui reste est proposé d'office, noté et la journée marquée en un geste", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const date = "2026-11-04"; // mercredi : le shaker d'Alex est prévu
  const todo = pending(plannedMeals(db, "alex", date), listTemplates(db, "alex"), listEntries(db, "alex", date), date);
  const c = dayCheck(todo, listEntries(db, "alex", date));
  assert.deepEqual(c.templates, ["tpl-shaker-alex"]);
  assert.deepEqual(c.empty, ["lunch", "dinner"]);
  assert.equal(c.ready, false);
  assert.equal(completeDay(db, "alex", date, { templates: c.templates }), 1);
  assert.equal(isComplete(db, "alex", date), true);
  assert.equal(listEntries(db, "alex", date).length, 1);
  // Un repas noté à midi et au soir, rien de prévu : prête telle quelle.
  const after = dayCheck(pending([], listTemplates(db, "alex"), [], date), [{ meal: "lunch" }, { meal: "dinner" }]);
  assert.equal(after.empty.length, 0);
});

test("api app : statut et « terminer » la journée", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const key = ensureLink(db, "alex").key;
  const call = (method: "GET" | "POST", path: string, body: unknown = null) =>
    appApi(db, { method, path: path.split("/"), query: new URLSearchParams(), body, headers: new Headers({ "x-mijote-key": key }), now: Date.parse("2026-10-20T08:00:00Z") });
  db.insert(weighIns).values({ id: "w-a", personId: "alex", date: "2026-10-12", measuredAt: "2026-10-12T07:00:00Z", kg: 75, source: "manual" }).run();
  const r = call("GET", "statut");
  assert.equal(r.status, 200);
  const st = (r.body as { status: { update: { next: string }; todo: string[]; target: { word: string } } }).status;
  assert.equal(st.update.next, "2026-10-26");
  assert.ok(st.todo.length > 0);
  assert.equal(st.target.word, "estimation");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(r.body)));
  const t = call("POST", "jour", { action: "terminer", date: "2026-10-20" });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const jour = (t.body as { jour: { complete: boolean; entries: unknown[]; check: { ready: boolean } } }).jour;
  assert.equal(jour.complete, true);
  assert.equal(jour.entries.length, 1); // le shaker du mardi
  assert.ok((call("GET", "moi").body as { features: string[] }).features.includes("statut"));
});

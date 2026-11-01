// Vue d'ensemble de Santé : périodes, paquets (jour, semaine, mois), moyennes glissantes, comparaisons,
// courbe du poids, temps par type de séance et phrase de synthèse (src/lib/health/series.ts) ; puis le
// regroupement SQL de src/lib/health/overview.ts, qui doit tomber sur les mêmes paquets que le code pur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { openDb } from "@/lib/db/open";
import { healthSamples, workouts } from "@/lib/db/schema";
import { addWeighIn } from "@/lib/health/store";
import { bucketRows, firstDay, listActivities, overview, sleepBuckets, sleepNights } from "@/lib/health/overview";
import { bucketOf, bucketsBetween, daily, fillBuckets, groupRows, lineGrainOf, minutesByType, nextBucket, OTHER, periodOf, recent, rollingMean, sessionsSince, synthesis, weightGrain, weightView, type Activity } from "@/lib/health/series";
import { trendSeries } from "@/lib/health/core";
import { addDays } from "@/lib/week/propose";
import { dayString, weekdayOf } from "@/lib/days";
import { seedTest } from "./helpers";

const TODAY = "2026-11-01"; // un dimanche

test("paquets : lundi de la semaine, premier du mois, passage d'année", () => {
  assert.equal(bucketOf("2026-11-01", "week"), "2026-10-26");
  assert.equal(bucketOf("2026-10-26", "week"), "2026-10-26");
  assert.equal(bucketOf("2026-11-01", "month"), "2026-11-01");
  assert.equal(bucketOf("2026-10-31", "month"), "2026-10-01");
  assert.equal(nextBucket("2026-12-01", "month"), "2027-01-01");
  assert.equal(nextBucket("2026-12-28", "week"), "2027-01-04");
  assert.deepEqual(bucketsBetween("2026-10-15", "2026-12-02", "month"), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.equal(bucketsBetween("2026-01-01", "2026-12-31", "day").length, 365);
});

test("périodes : 7 et 30 jours au jour, 3 mois et 1 an à la semaine depuis un lundi, « Tout » selon l'historique", () => {
  const p7 = periodOf("7j", TODAY);
  assert.deepEqual([p7.from, p7.to, p7.grain], ["2026-10-26", TODAY, "day"]);
  const p30 = periodOf("30j", TODAY);
  assert.equal(p30.from, "2026-10-03");
  const p3 = periodOf("3m", TODAY);
  assert.equal(p3.grain, "week");
  assert.equal(new Date(`${p3.from}T00:00:00Z`).getUTCDay(), 1);
  assert.equal(bucketsBetween(p3.from, p3.to, "week").length, 13);
  assert.equal(bucketsBetween(periodOf("1an", TODAY).from, TODAY, "week").length, 52);
  // « Tout » : au mois au-delà de deux ans, à la semaine en dessous, au jour sous trois mois.
  assert.deepEqual([periodOf("tout", TODAY, "2019-03-14").from, periodOf("tout", TODAY, "2019-03-14").grain], ["2019-03-01", "month"]);
  assert.equal(periodOf("tout", TODAY, "2026-01-10").grain, "week");
  assert.equal(periodOf("tout", TODAY, "2026-10-01").grain, "day");
  assert.equal(periodOf("tout", TODAY, null).from, addDays(TODAY, -29));
});

test("remplir les paquets : moyenne par jour mesuré ou total, trous à null, le dernier est en cours", () => {
  const pts = [
    { date: "2026-10-20", value: 8000 },
    { date: "2026-10-21", value: 10000 },
    { date: "2026-10-27", value: 6000 },
  ];
  const period = { from: "2026-10-12", to: TODAY, grain: "week" as const };
  const mean = fillBuckets(groupRows(pts, "week"), period, "mean");
  assert.deepEqual(
    mean.map((b) => [b.start, b.value, b.n, b.partial]),
    [
      ["2026-10-12", null, 0, false],
      ["2026-10-19", 9000, 2, false],
      ["2026-10-26", 6000, 1, true],
    ]
  );
  assert.equal(mean[1].end, "2026-10-25");
  assert.equal(fillBuckets(groupRows(pts, "week"), period, "sum")[1].value, 18000);
  // Deux valeurs le même jour : un seul jour mesuré.
  assert.deepEqual(groupRows([...pts, { date: "2026-10-20", value: 1 }], "week")[0], { bucket: "2026-10-19", total: 18001, n: 2 });
});

test("moyenne glissante : des valeurs présentes seulement, null tant qu'il n'y a rien", () => {
  assert.deepEqual(rollingMean([null, 2, 4, null, 6], 3), [null, 2, 3, 3, 5]);
  assert.deepEqual(rollingMean([], 7), []);
  assert.deepEqual(daily([{ date: "2026-10-30", value: 3 }], "2026-10-29", "2026-10-31"), [
    { date: "2026-10-29", value: null },
    { date: "2026-10-30", value: 3 },
    { date: "2026-10-31", value: null },
  ]);
});

test("7 derniers jours face aux 4 semaines d'avant : la journée en cours ne compte pas pour les totaux", () => {
  const pts = Array.from({ length: 40 }, (_, i) => ({ date: addDays(TODAY, -i), value: i < 8 ? 11000 : 10000 }));
  pts[0].value = 500; // aujourd'hui, pas fini
  const r = recent(pts, TODAY);
  assert.equal(r.now, 11000);
  assert.equal(r.before, 10000);
  assert.equal(Math.round(r.pct!), 10);
  // Une mesure du matin (FC au repos) : aujourd'hui compte.
  assert.ok(recent(pts, TODAY, 7, false).now! < 11000);
  assert.deepEqual(recent([], TODAY), { now: null, before: null, pct: null });
});

test("poids : tendance calculée sur tout l'historique, fourchette des 7 derniers jours, à la semaine au-delà d'un an", () => {
  const kg = Array.from({ length: 900 }, (_, i) => ({ date: addDays("2024-05-01", i), kg: 80 - i * 0.004 + (i % 3) * 0.3 }));
  const last = kg[kg.length - 1].date;
  const month = weightView(kg, { from: addDays(last, -29), to: last });
  assert.equal(month.length, 30);
  const p = month[month.length - 1];
  assert.ok(p.lo! <= p.kg! && p.kg! <= p.hi!);
  assert.ok(Math.abs(p.trend - p.kg!) < 1, "la tendance est déjà lancée au premier jour de la période");
  const all = weightView(kg, { from: "2024-05-01", to: last });
  assert.ok(all.length >= 128 && all.length <= 130, `${all.length} semaines`);
  assert.ok(all.every((w) => w.lo == null || (w.lo <= w.kg! && w.kg! <= w.hi!)));
  // Sur plusieurs années au mois (« Tout ») : un point par mois, la dernière tendance du mois.
  const months = weightView(kg, { from: "2024-05-01", to: last, grain: "month" });
  assert.equal(months.length, 30);
  assert.equal(months[0].date, "2024-05-01");
  assert.equal(months[months.length - 1].trend, all[all.length - 1].trend);
  assert.ok(months.every((w) => w.lo == null || (w.lo <= w.kg! && w.kg! <= w.hi!)));
  // La tendance déjà calculée donne la même courbe.
  assert.deepEqual(weightView(kg, { from: addDays(last, -29), to: last }, trendSeries(kg, last)), month);
  assert.deepEqual(weightView(kg, { from: "2024-05-01", to: last }, trendSeries(kg, last)), all);
});

test("pas des courbes : au jour jusqu'à un an, au mois sur plusieurs années, comme le poids", () => {
  assert.deepEqual((["day", "week", "month"] as const).map(lineGrainOf), ["day", "day", "month"]);
  assert.equal(weightGrain({ from: "2026-01-01", to: "2026-10-31", grain: "week" }), "day");
  assert.equal(weightGrain({ from: "2024-01-01", to: "2026-10-31", grain: "week" }), "week");
  assert.equal(weightGrain({ from: "2018-01-01", to: "2026-10-31", grain: "month" }), "month");
});

test("addDays : le calendrier sans objet Date, identique à setUTCDate", () => {
  const ref = (d: string, n: number) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  for (let d = "1999-12-01"; d < "2001-03-31"; d = ref(d, 1)) for (const n of [-400, -60, -1, 0, 1, 28, 365, 2.5, -2.5]) assert.equal(addDays(d, n), ref(d, n), `${d} ${n}`);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2100-02-28", 1), "2100-03-01");
  assert.throws(() => addDays("pas une date", 1));
  for (let n = -30_000; n < 60_000; n += 7) {
    const d = new Date(n * 86_400_000);
    assert.equal(dayString(n), d.toISOString().slice(0, 10));
    assert.equal(weekdayOf(n), d.getUTCDay());
  }
});

const act = (date: string, label: string, minutes: number): Activity => ({ date, at: null, label, minutes, distanceM: null, kcal: null, source: "apple" });

test("temps par type : les 4 plus longs, le reste en « Autre » (sauf s'il n'y a qu'un type de trop)", () => {
  const period = { from: "2026-10-19", to: TODAY, grain: "week" as const };
  const acts = [act("2026-10-20", "Course", 40), act("2026-10-21", "Natation", 45), act("2026-10-22", "Vélo", 60), act("2026-10-27", "Course", 30), act("2026-10-28", "Yoga", 20), act("2026-10-29", "Marche", 15), act("2026-10-30", "Danse", 10), act("2026-09-01", "Course", 99)];
  const s = minutesByType(acts, period);
  assert.deepEqual(s.types, ["Course", "Vélo", "Natation", "Yoga", OTHER]);
  assert.deepEqual(s.buckets[1].parts, { Course: 30, Yoga: 20, [OTHER]: 25 });
  assert.equal(s.buckets[0].value, 145);
  const five = minutesByType(acts.filter((a) => a.label !== "Danse"), period);
  assert.deepEqual(five.types, ["Course", "Vélo", "Natation", "Yoga", "Marche"]);
  assert.deepEqual(sessionsSince(acts, TODAY), { count: 4, minutes: 75 });
});

test("synthèse : des chiffres, pas d'adjectifs ; rien sans mesure", () => {
  assert.deepEqual(synthesis({}), []);
  const s = synthesis({
    steps: { now: 8412, before: 7500, pct: 12.16 },
    sessions: { count: 3, minutes: 125, perWeek: 3 },
    sleepMin: 395,
    restingHr: { now: 62, before: 57, pct: 8 },
    trendKg: 81.24,
    rateKg: -0.31,
  });
  assert.equal(s[0], "En moyenne 8 412 pas par jour sur 7 jours, 12 % de plus que le mois d’avant.");
  assert.equal(s[1], "3 séances en 7 jours (2 h 05), le plan est tenu.");
  assert.equal(s[2], "6 h 35 de sommeil par nuit, un peu court.");
  assert.match(s[3], /^Cœur au repos plus haut que le mois d’avant \(\+5 bpm\) : fatigue/);
  assert.equal(s[4], "Poids 81,2 kg en tendance, −0,3 kg par semaine.");
  assert.equal(synthesis({ steps: { now: 8000, before: 7900, pct: 1.3 } })[0], "En moyenne 8 000 pas par jour sur 7 jours, autant que le mois d’avant.");
  assert.equal(synthesis({ sessions: { count: 0, minutes: 0, perWeek: 2 } })[0], "Aucune séance ces 7 derniers jours, 2 prévues par semaine.");
  assert.equal(synthesis({ sessions: { count: 1, minutes: 45, perWeek: 3 } })[0], "1 séance en 7 jours (45 min), 3 prévues.");
  // Le cœur ne se mentionne que s'il a bougé de 3 bpm au moins.
  assert.equal(synthesis({ restingHr: { now: 58, before: 57, pct: 1 } }).length, 0);
});

// ─── En base ───

function setup() {
  const { db } = openDb(":memory:");
  seedTest(db);
  const put = (kind: (typeof healthSamples.$inferSelect)["kind"], start: string, value: number, meta: Record<string, unknown> | null = null, end: string | null = null) =>
    db.insert(healthSamples).values({ id: randomUUID(), personId: "alex", kind, start, end, value, unit: "", meta, externalId: randomUUID() }).run();
  return { db, put };
}

test("SQL : les paquets de la base sont ceux du code pur (jour, semaine, mois), pour les totaux et les instants", () => {
  const { db, put } = setup();
  const pts: { date: string; value: number }[] = [];
  for (let i = 0; i < 120; i++) {
    const date = addDays("2026-07-01", i);
    if (i % 5 === 3) continue;
    const value = 6000 + ((i * 37) % 50) * 100;
    pts.push({ date, value });
    put("steps", date, value);
    // Deux mesures de FC dans la journée, dont une à 23 h 30 à Paris en hiver (22 h 30 UTC) : même jour.
    put("resting_hr", `${date}T05:00:00.000Z`, 60);
    put("resting_hr", `${date}T22:30:00.000Z`, 50);
  }
  for (const grain of ["day", "week", "month"] as const) {
    const sqlRows = bucketRows(db, "alex", "steps", "2026-07-01", "2026-10-28", grain);
    assert.deepEqual(sqlRows, groupRows(pts, grain), grain);
  }
  const hr = bucketRows(db, "alex", "resting_hr", "2026-10-01", "2026-10-28", "week");
  assert.ok(hr.every((r) => r.total / r.n === 55), "moyenne du jour, puis de la semaine");
  assert.equal(firstDay(db, "alex"), "2026-07-01");
});

test("séances : carnet et Apple réunis sans doublon, plus récentes d'abord, détails gardés", () => {
  const { db, put } = setup();
  db.insert(workouts).values({ id: "w1", personId: "alex", date: "2026-10-28", ts: Date.parse("2026-10-28T18:40:00Z"), type: "A", minutes: 35, note: null, entries: [] }).run();
  put("workout", "2026-10-28T18:00:00.000Z", 36, { type: "Renforcement", kcal: 210 }); // la même séance, vue par la montre
  put("workout", "2026-10-30T07:00:00.000Z", 42.4, { type: "Course", kcal: 380, distanceM: 6200 });
  const acts = listActivities(db, "alex", "2026-10-01").filter((a) => a.date >= "2026-10-28");
  assert.deepEqual(
    acts.map((a) => [a.date, a.label, a.minutes, a.distanceM, a.source]),
    [
      ["2026-10-30", "Course", 42, 6200, "apple"],
      ["2026-10-28", "Kettlebell", 35, null, "carnet"],
    ]
  );
  assert.equal(acts[1].sub, "séance A");
});

test("sommeil : nuits réunies puis regroupées, phases en moyenne par nuit", () => {
  const { db, put } = setup();
  for (let i = 0; i < 10; i++) {
    const wake = addDays("2026-10-20", i);
    const bed = addDays(wake, -1);
    put("sleep", `${bed}T22:00:00.000Z`, 90, { stage: "deep" }, `${bed}T23:30:00.000Z`);
    put("sleep", `${bed}T23:30:00.000Z`, 240, { stage: "core" }, `${wake}T03:30:00.000Z`);
    put("sleep", `${wake}T03:30:00.000Z`, 90, { stage: "rem" }, `${wake}T05:00:00.000Z`);
  }
  const list = sleepNights(db, "alex", "2026-10-20", "2026-10-29");
  assert.equal(list.length, 10);
  assert.ok(list.every((n) => n.asleepMin === 420));
  const b = sleepBuckets(list, { from: "2026-10-19", to: TODAY, grain: "week" });
  assert.deepEqual(
    b.map((x) => [x.start, x.value, x.n, x.deep, x.rem]),
    [
      ["2026-10-19", 420, 6, 90, 90],
      ["2026-10-26", 420, 4, 90, 90],
    ]
  );
});

test("vue d'ensemble : une personne sans aucune donnée n'a ni barres ni phrase, sans erreur", () => {
  const { db } = setup();
  const person = { id: "sam", name: "Sam", sportPlan: [] } as unknown as Parameters<typeof overview>[1];
  const o = overview(db, person, "30j", TODAY);
  assert.deepEqual(o.weight, []);
  assert.equal(o.bars.steps, null);
  assert.equal(o.sleep, null);
  assert.deepEqual(o.synthesis, []);
  assert.equal(o.tiles.steps, null);
});

test("vue d'ensemble : pesées et pas d'une personne donnent courbe, barres et phrase", () => {
  const { db, put } = setup();
  for (let i = 0; i < 60; i++) {
    const d = addDays(TODAY, -i);
    put("steps", d, 9000);
    if (i % 2 === 0) addWeighIn(db, "alex", 82 - i * 0.01, new Date(`${d}T06:10:00.000Z`));
  }
  const person = { id: "alex", name: "Alex", sportPlan: [{ kind: "course", perWeek: 2, minutes: 30 }] } as unknown as Parameters<typeof overview>[1];
  const o = overview(db, person, "3m", TODAY);
  assert.equal(o.period.grain, "week");
  assert.ok(o.weight.length > 50);
  assert.equal(o.bars.steps!.at(-1)!.value, 9000);
  assert.equal(o.tiles.steps!.now, 9000);
  assert.equal(o.tiles.steps!.spark.length, 30);
  assert.match(o.synthesis[0], /9 000 pas/);
  assert.match(o.synthesis[1], /Aucune séance/);
});

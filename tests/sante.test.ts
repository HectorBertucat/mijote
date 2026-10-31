// Santé : tendance, dépense adaptative, cibles (src/lib/health/core.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "@/lib/week/propose";
import {
  adaptiveTdee,
  ageOn,
  dailyWeights,
  estimatedTdee,
  mifflin,
  targetsFor,
  trendSeries,
  weeklyRate,
  weeklyReview,
  type IntakeDay,
  type Profile,
  type WeighIn,
} from "@/lib/health/core";

const ALEX: Profile = { sex: "m", birthDate: "1996-01-01", heightCm: 180, activity: "moderate", goal: "recomp", ratePct: -0.4, proteinGPerKg: null, proteinG: 160 };

// Poids qui baisse de 0,3 kg/sem. avec ±0,6 kg de bruit (eau, sel), une pesée chaque matin.
function weighIns(start: string, days: number, from: number, perWeek: number, skip = (_i: number) => false): WeighIn[] {
  const noise = [0.4, -0.3, 0.6, -0.5, 0.1, -0.2, 0.3];
  const out: WeighIn[] = [];
  for (let i = 0; i < days; i++) {
    if (skip(i)) continue;
    const date = addDays(start, i);
    out.push({ date, measuredAt: `${date}T06:30:00Z`, kg: from + (perWeek / 7) * i + noise[i % 7] });
  }
  return out;
}

test("une pesée par jour : la première du jour", () => {
  const d = dailyWeights([
    { date: "2026-10-01", measuredAt: "2026-10-01T18:00:00Z", kg: 75.2 },
    { date: "2026-10-01", measuredAt: "2026-10-01T06:00:00Z", kg: 74.1 },
  ]);
  assert.deepEqual(d, [{ date: "2026-10-01", kg: 74.1 }]);
});

test("la tendance filtre le bruit et suit la vraie pente", () => {
  const series = trendSeries(dailyWeights(weighIns("2026-08-01", 70, 77, -0.3)));
  const amplitudeRaw = 1.1; // bruit de la pesée du jour
  const steps = series.slice(20).map((p, i, a) => (i ? Math.abs(p.trend - a[i - 1].trend) : 0));
  assert.ok(Math.max(...steps) < amplitudeRaw / 5, "la tendance ne saute pas d'un jour à l'autre");
  const rate = weeklyRate(series, 28)!;
  assert.ok(Math.abs(rate - -0.3) < 0.08, `rythme ${rate}`);
});

test("les jours sans pesée ne font pas bouger la tendance", () => {
  const s = trendSeries([
    { date: "2026-10-01", kg: 74 },
    { date: "2026-10-05", kg: 73 },
  ]);
  assert.equal(s.length, 5);
  assert.equal(s[3].trend, 74);
  assert.equal(s[3].kg, null);
  assert.ok(Math.abs(s[4].trend - 73.9) < 1e-9);
});

test("âge au jour près", () => {
  assert.equal(ageOn("1990-06-13", "2026-06-12"), 35);
  assert.equal(ageOn("1990-06-13", "2026-06-13"), 36);
});

test("après plus de 21 jours sans pesée, la tendance repart de la pesée", () => {
  const s = trendSeries([
    { date: "2026-01-01", kg: 80 },
    { date: "2026-03-01", kg: 75 },
  ]);
  assert.equal(s[s.length - 1].trend, 75);
});

test("Mifflin-St Jeor et facteur d'activité", () => {
  assert.equal(mifflin("m", 74, 180, 30), 740 + 1125 - 150 + 5);
  assert.equal(mifflin("f", 60, 165, 30), 600 + 1031.25 - 150 - 161);
  assert.equal(Math.round(estimatedTdee(ALEX, 74, "2026-10-26")!), Math.round(mifflin("m", 74, 180, 30) * 1.55));
  assert.equal(estimatedTdee({ ...ALEX, birthDate: null }, 74, "2026-10-26"), null);
});

test("dépense adaptative : retrouve la dépense réelle à partir des apports et de la tendance", () => {
  // Il mange 2 300 kcal et perd 0,3 kg/sem. : dépense réelle = 2 300 + 0,3 × 7 700 / 7 = 2 630.
  const weekStart = "2026-10-26";
  const start = addDays(weekStart, -60);
  const ws = weighIns(start, 60, 76, -0.3);
  const intake: IntakeDay[] = Array.from({ length: 60 }, (_, i) => ({ date: addDays(start, i), kcal: 2300, complete: true }));
  const series = trendSeries(dailyWeights(ws), addDays(weekStart, -1));
  const r = adaptiveTdee(intake, series, weekStart);
  assert.ok(r.tdee != null);
  assert.ok(Math.abs(r.tdee! - 2630) < 120, `dépense ${r.tdee}`);
});

test("pas assez de journées complètes : en attente, les jours manquants ne comptent pas comme zéro", () => {
  const weekStart = "2026-10-26";
  const start = addDays(weekStart, -30);
  const ws = weighIns(start, 30, 76, -0.3);
  const intake: IntakeDay[] = Array.from({ length: 30 }, (_, i) => ({ date: addDays(start, i), kcal: 2300, complete: i % 3 === 0 }));
  const r = adaptiveTdee(intake, trendSeries(dailyWeights(ws), addDays(weekStart, -1)), weekStart);
  assert.equal(r.tdee, null);
  assert.match(r.reason, /journées complètes/);
});

test("cibles : déficit au rythme visé, protéines fixes ou en g/kg", () => {
  const t = targetsFor(ALEX, 2600, 74);
  // −0,4 % de 74 kg = −0,296 kg/sem. = −326 kcal/j
  assert.equal(t.dailyDeltaKcal, -326);
  assert.equal(t.kcal, 2270);
  assert.equal(t.proteinG, 160);
  assert.equal(t.fatMinG, 44);
  assert.equal(targetsFor({ ...ALEX, proteinG: null, proteinGPerKg: 1.8 }, 2600, 74).proteinG, 133);
  assert.equal(targetsFor({ ...ALEX, proteinG: null, proteinGPerKg: null }, 2600, 60).proteinG, 96);
});

test("bilan du lundi : estimation, puis adaptatif, et la cible bouge de 150 kcal au plus", () => {
  const weekStart = "2026-10-26";
  const start = addDays(weekStart, -10);
  const ws = weighIns(start, 10, 74, -0.3);
  const first = weeklyReview({ profile: ALEX, weekStart, weighIns: ws, intake: [], previous: null })!;
  assert.equal(first.confidence, "estimate");

  const start2 = addDays(weekStart, -40);
  const ws2 = weighIns(start2, 40, 75, -0.3);
  const intake: IntakeDay[] = Array.from({ length: 40 }, (_, i) => ({ date: addDays(start2, i), kcal: 1900, complete: true }));
  const r = weeklyReview({ profile: ALEX, weekStart, weighIns: ws2, intake, previous: { tdeeKcal: 2600, kcalTarget: 2300, confidence: "adaptive" } })!;
  assert.equal(r.confidence, "adaptive");
  assert.ok(r.tdee < 2400);
  assert.equal(r.targets.kcal, 2150);
  assert.ok(r.stepLimited);

  const holding = weeklyReview({ profile: ALEX, weekStart, weighIns: ws2, intake: [], previous: { tdeeKcal: 2600, kcalTarget: 2270, confidence: "adaptive" } })!;
  assert.equal(holding.confidence, "holding");
  assert.equal(holding.tdee, 2600);
});

test("sans pesée, pas de bilan", () => {
  assert.equal(weeklyReview({ profile: ALEX, weekStart: "2026-10-26", weighIns: [], intake: [], previous: null }), null);
});

// ─── Journal des repas ───
import { openDb } from "@/lib/db/open";
import { seedTest } from "./helpers";
import { mealSlots, recipes as recipesT } from "@/lib/db/schema";
import { ensureWeek } from "@/lib/week/store";
import { mondayOf } from "@/lib/week/propose";
import { and, eq } from "drizzle-orm";
import { addEntry, addRecipeEntry, listEntries, listTemplates, pending, plannedMeals, setComplete, setEntryUnits, totals } from "@/lib/health/log";
import { intakeDays } from "@/lib/health/store";

test("journal : le prévu de la Semaine se coche en un tap, les unités suivent, la journée complète compte", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  db.insert(recipesT).values({ id: "r1", name: "Chasseur", slug: "chasseur", servingsUnits: 18, kcalUnit: 150, proteinUnit: 12 }).run();
  const date = "2026-10-21"; // mercredi
  const plan = ensureWeek(db, mondayOf(new Date(`${date}T12:00:00Z`)));
  db.update(mealSlots).set({ recipeId: "r1", place: "office" }).where(and(eq(mealSlots.weekPlanId, plan), eq(mealSlots.day, 2), eq(mealSlots.meal, "lunch"), eq(mealSlots.personId, "alex"))).run();

  const planned = plannedMeals(db, "alex", date);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].units, 5);
  assert.equal(planned[0].kcal, 750);
  assert.equal(plannedMeals(db, "sam", date).length, 0, "Sam n'a pas ce repas");

  const shaker = listTemplates(db, "alex");
  assert.ok(pending(planned, shaker, [], date).templates[0].suggested, "shaker proposé en semaine");

  const e = addRecipeEntry(db, "alex", date, "lunch", "r1", 5, "plan");
  addEntry(db, { personId: "alex", date, meal: "breakfast", kind: "template", templateId: shaker[0].id, label: "Shaker", kcal: 335, proteinG: 43 });
  const left = pending(planned, shaker, listEntries(db, "alex", date), date);
  assert.equal(left.planned.length, 0);
  assert.equal(left.templates.length, 0);

  setEntryUnits(db, e.id, 6);
  assert.deepEqual(totals(listEntries(db, "alex", date)), { kcal: 900 + 335, proteinG: 72 + 43 });

  assert.equal(intakeDays(db, "alex", date)[0].complete, false);
  setComplete(db, "alex", date, true);
  assert.deepEqual(intakeDays(db, "alex", date), [{ date, kcal: 1235, complete: true }]);
});

// ─── Export Apple Santé ───
import { deflateRawSync } from "zlib";
import { exportDateToIso, readExport, weightsInXml, type ExportWeight } from "@/lib/health/apple-export";
import { ingest } from "@/lib/health/ingest";
import { listWeighIns } from "@/lib/health/store";

// Zip minimal (deflate, sans CRC : le lecteur ne le vérifie pas).
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text));
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(Buffer.byteLength(text), 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(Buffer.byteLength(text), 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const rec = (d: string, v: number, unit = "kg") => `<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Balance" unit="${unit}" creationDate="${d}" startDate="${d}" endDate="${d}" value="${v}"/>\n`;
const XML = `<?xml version="1.0"?>\n<HealthData>\n${rec("2026-01-10 06:31:00 +0100", 79.2)}${'<Record type="HKQuantityTypeIdentifierStepCount" value="5"/>\n'.repeat(5000)}${rec("2026-07-27 07:02:00 +0200", 77.05)}${rec("2026-07-28 07:02:00 +0200", 169.8, "lb")}</HealthData>\n`;

test("export Apple Santé : dates, pesées (kg et livres), dans un zip ou un xml", async () => {
  assert.equal(exportDateToIso("2026-07-27 07:02:00 +0200"), "2026-07-27T07:02:00+02:00");
  assert.equal(weightsInXml(XML).length, 3);
  for (const blob of [new Blob([new Uint8Array(zip({ "apple_health_export/export_cda.xml": "<x/>", "apple_health_export/export.xml": XML }))]), new Blob([XML])]) {
    const got: ExportWeight[] = [];
    await readExport(blob, (f) => got.push(...f.weights));
    assert.deepEqual(got, [
      { kg: 79.2, at: "2026-01-10T06:31:00+01:00" },
      { kg: 77.05, at: "2026-07-27T07:02:00+02:00" },
      { kg: 77.02, at: "2026-07-28T07:02:00+02:00" },
    ]);
  }
});

test("import : dédoublonné, pas et énergie remplacés dans la journée, séances gardées", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const payload = {
    person: "alex",
    source: "shortcut" as const,
    weights: [{ kg: 73.8, at: "2026-10-21T06:30:00+02:00" }],
    steps: [{ date: "2026-10-21T20:00:00+02:00", count: 4000 }],
    activeKcal: [],
    workouts: [{ type: "Natation", start: "2026-10-21T12:15:00+02:00", end: "2026-10-21T12:37:00+02:00", kcal: 210, distanceM: 1000 }],
  };
  assert.deepEqual(ingest(db, payload), { weights: 1, steps: 1, activeKcal: 0, workouts: 1, skipped: 0 });
  const again = ingest(db, { ...payload, steps: [{ date: "2026-10-21T22:00:00+02:00", count: 9000 }] });
  assert.equal(again.weights, 0);
  assert.equal(again.workouts, 0);
  const w = listWeighIns(db, "alex");
  assert.equal(w.length, 1);
  assert.equal(w[0].date, "2026-10-21");
  assert.equal(w[0].source, "health");
});

// ─── Export : séances et pas ───
import { dailySteps, scanXml } from "@/lib/health/apple-export";
import { workoutLabel } from "@/lib/health/ingest";

test("export Apple Santé : séances (type, durée, distance, énergie) et pas sans double compte iPhone + montre", () => {
  const steps = (src: string, d: string, v: number) => `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="${src}" unit="count" startDate="${d}" endDate="${d}" value="${v}"/>`;
  const xml = [
    `<Workout workoutActivityType="HKWorkoutActivityTypeSwimming" duration="21.5" durationUnit="min" totalDistance="1" totalDistanceUnit="km" totalEnergyBurned="230" totalEnergyBurnedUnit="kcal" sourceName="Watch" startDate="2026-10-20 12:15:00 +0200" endDate="2026-10-20 12:37:00 +0200">`,
    `<WorkoutStatistics type="x"/></Workout>`,
    `<Workout workoutActivityType="HKWorkoutActivityTypePilates" duration="3000" durationUnit="s" sourceName="Watch" startDate="2026-10-19 18:00:00 +0200" endDate="2026-10-19 18:50:00 +0200"/>`,
    steps("iPhone", "2026-10-20 08:00:00 +0200", 3000),
    steps("iPhone", "2026-10-20 18:00:00 +0200", 2000),
    steps("Watch", "2026-10-20 08:00:00 +0200", 4500),
    steps("Watch", "2026-10-20 18:00:00 +0200", 2500),
    steps("iPhone", "2026-10-21 08:00:00 +0200", 1200),
  ].join("\n");
  const f = scanXml(xml);
  assert.deepEqual(f.workouts, [
    { type: "HKWorkoutActivityTypeSwimming", start: "2026-10-20T12:15:00+02:00", end: "2026-10-20T12:37:00+02:00", durationMin: 21.5, distanceM: 1000, kcal: 230 },
    { type: "HKWorkoutActivityTypePilates", start: "2026-10-19T18:00:00+02:00", end: "2026-10-19T18:50:00+02:00", durationMin: 50, distanceM: undefined, kcal: undefined },
  ]);
  assert.deepEqual(dailySteps(f.steps), [
    { date: "2026-10-20", count: 7000 },
    { date: "2026-10-21", count: 1200 },
  ]);
  assert.equal(workoutLabel("HKWorkoutActivityTypeSwimming"), "Natation");
  assert.equal(workoutLabel("Workouts", "Natation en piscine, 20 min"), "Natation en piscine");
  assert.equal(workoutLabel("", ""), "Séance");
});

// ─── Raccourci : clé par personne, fenêtre de synchro ───
import { afterSync, ensureLink, installCode, linkForKey, markSynced, rotateLink, syncWindow } from "@/lib/health/link";

test("raccourci : 6 mois la première fois, le mois chaque semaine ou après un trou, 7 jours sinon", () => {
  const now = new Date("2026-10-21T07:00:00Z");
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  assert.equal(syncWindow({ lastSyncAt: null, lastMonthAt: null, lastHistoryAt: null }, now), 180);
  assert.equal(syncWindow({ lastSyncAt: day(1), lastMonthAt: day(3), lastHistoryAt: day(3) }, now), 7);
  assert.equal(syncWindow({ lastSyncAt: day(1), lastMonthAt: day(7), lastHistoryAt: day(20) }, now), 35);
  assert.equal(syncWindow({ lastSyncAt: day(8), lastMonthAt: day(2), lastHistoryAt: day(20) }, now), 35);
  const after = afterSync({ lastSyncAt: null, lastMonthAt: null, lastHistoryAt: null }, 180, now);
  assert.deepEqual(after, { lastSyncAt: now.toISOString(), lastMonthAt: now.toISOString(), lastHistoryAt: now.toISOString() });
  assert.equal(afterSync(after, 7, new Date("2026-10-22T07:00:00Z")).lastMonthAt, now.toISOString());
});

test("raccourci : la clé désigne la personne, une nouvelle clé remplace l'ancienne", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  const l = ensureLink(db, "sam");
  assert.equal(ensureLink(db, "sam").key, l.key);
  assert.equal(linkForKey(db, l.key)?.personId, "sam");
  markSynced(db, "sam", 180);
  assert.ok(linkForKey(db, l.key)?.lastHistoryAt);
  const r = rotateLink(db, "sam");
  assert.notEqual(r.key, l.key);
  assert.equal(linkForKey(db, l.key), null);
  assert.equal(linkForKey(db, ""), null);
  const code = JSON.parse(installCode({ url: "https://x/api/sante/import", key: r.key, clientId: "a.access", clientSecret: "s" }));
  assert.deepEqual(code, { "mijote-sante": 1, url: "https://x/api/sante/import", id: "a.access", secret: "s", key: r.key });
});

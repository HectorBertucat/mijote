// La vue d'ensemble de Santé, côté base : les séries regroupées en SQL (un paquet par jour, semaine ou
// mois, jamais des milliers de lignes vers la page), les séances réunies (carnet guidé et Apple Santé), les
// nuits, puis tout ce que la page affiche pour une personne et une période. Le calcul est dans ./series.
import { and, eq, gte, min, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { healthSamples, weighIns, workouts, type HealthKind } from "@/lib/db/schema";
import { programFor } from "@/lib/training/programs";
import { addDays } from "@/lib/week/propose";
import { dailyWeights, trendSeries, weeklyRate } from "./core";
import { sportOf } from "./goals";
import { planOf } from "./objectives";
import { nights, type Night, type Stage } from "./sleep";
import { listWeighIns, todayParis, type Person } from "./store";
import { bucketOf, daily, fillBuckets, lineGrainOf, minutesByType, periodOf, recent, sessionsSince, synthesis, weightView, type Activity, type Bucket, type BucketRow, type Grain, type Period, type PeriodKey } from "./series";

/** Totaux du jour (une ligne par jour civil du téléphone, `start` = AAAA-MM-JJ). */
export const DAILY_KINDS = ["steps", "active_kcal", "basal_energy", "exercise_min", "walk_run_m"] as const satisfies HealthKind[];
/** Mesures à un instant (plusieurs par jour possibles) : moyenne du jour. */
export const INSTANT_KINDS = ["resting_hr", "hrv_sdnn", "vo2max", "body_fat", "lean_mass"] as const satisfies HealthKind[];
export type SeriesKind = (typeof DAILY_KINDS)[number] | (typeof INSTANT_KINDS)[number];

const isDaily = (k: SeriesKind) => (DAILY_KINDS as readonly string[]).includes(k);

/** Le paquet d'un jour `d` (expression SQL) : mêmes bornes que `bucketOf` (lundi, premier du mois). */
function bucketSql(d: ReturnType<typeof sql>, grain: Grain) {
  if (grain === "day") return d;
  if (grain === "month") return sql`substr(${d}, 1, 7) || '-01'`;
  return sql`date(${d}, '-' || ((cast(strftime('%w', ${d}) as integer) + 6) % 7) || ' days')`;
}

/**
 * Une série regroupée en SQL : par paquet, la somme des valeurs du jour et le nombre de jours mesurés.
 * Le jour d'une mesure à un instant est pris en heure d'hiver de Paris (UTC+1) : une heure d'écart l'été
 * entre minuit et une heure, sans effet sur une moyenne.
 */
export function bucketRows(db: Db, personId: string, kind: SeriesKind, from: string, to: string, grain: Grain): BucketRow[] {
  const day = isDaily(kind) ? sql`substr(start, 1, 10)` : sql`date(start, '+1 hours')`;
  const perDay = isDaily(kind) ? sql`sum(value)` : sql`avg(value)`;
  // Les totaux du jour se comparent tels quels ; les instants, avec un jour de marge pour le fuseau.
  const lo = isDaily(kind) ? from : addDays(from, -1);
  const hi = isDaily(kind) ? `${to}~` : `${addDays(to, 1)}~`;
  return db.all<BucketRow>(sql`
    select ${bucketSql(sql`d`, grain)} as bucket, sum(v) as total, count(*) as n from (
      select ${day} as d, ${perDay} as v from health_samples
      where person_id = ${personId} and kind = ${kind} and start >= ${lo} and start <= ${hi}
      group by d
    ) where d >= ${from} and d <= ${to}
    group by bucket order by bucket`);
}

/** Valeurs par jour (de `from` à `to`), pour les comparaisons et les courbes fines. */
export function dayValues(db: Db, personId: string, kind: SeriesKind, from: string, to: string): { date: string; value: number }[] {
  return bucketRows(db, personId, kind, from, to, "day").map((r) => ({ date: r.bucket, value: r.total / r.n }));
}

/** Les types reçus pour la personne (on n'affiche que ce qui existe) et le premier instant de chacun : une requête, sur l'index. */
export function kindsFirst(db: Db, personId: string): Map<HealthKind, string> {
  const rows = db.all<{ kind: HealthKind; first: string }>(sql`select kind, min(start) as first from health_samples where person_id = ${personId} group by kind`);
  return new Map(rows.map((r) => [r.kind, r.first]));
}

/** Les types qui ne datent pas l'historique (journal des repas, eau, cycle). */
const UNDATED: HealthKind[] = ["diet_energy", "diet_protein", "water", "menstrual"];

/** Premier jour connu (pesée, mesure, séance) : le début de « Tout ». `kinds` : `kindsFirst`, s'il est déjà lu. */
export function firstDay(db: Db, personId: string, kinds = kindsFirst(db, personId)): string | null {
  const w = db.select({ d: min(weighIns.date) }).from(weighIns).where(eq(weighIns.personId, personId)).get()?.d ?? null;
  const s = [...kinds].filter(([k]) => !UNDATED.includes(k)).map(([, first]) => first.slice(0, 10));
  const k = db.select({ d: min(workouts.date) }).from(workouts).where(eq(workouts.personId, personId)).get()?.d ?? null;
  const all = [w, ...s, k].filter((x): x is string => !!x).sort();
  return all[0] ?? null;
}

/**
 * Les séances de la personne depuis `from` : le carnet guidé (nom court du programme) et Apple Santé, sans
 * doublon (même règle que `mergeSessions` : une séance de renforcement d'Apple le jour d'une séance du
 * carnet est la même). La plus récente d'abord.
 */
export function listActivities(db: Db, personId: string, from = "0000-00-00"): (Activity & { sub: string | null })[] {
  const short = programFor(db, personId)?.short ?? "Séance guidée";
  const carnet = db
    .select({ date: workouts.date, ts: workouts.ts, type: workouts.type, minutes: workouts.minutes })
    .from(workouts)
    .where(and(eq(workouts.personId, personId), gte(workouts.date, from)))
    .all()
    .map((w) => ({ date: w.date, at: new Date(w.ts - (w.minutes ?? 0) * 60_000).toISOString(), label: short, sub: `séance ${w.type}`, minutes: w.minutes, distanceM: null, kcal: null, source: "carnet" as const }));
  const carnetDays = new Set(carnet.map((c) => c.date));
  const apple = db
    .select({ start: healthSamples.start, value: healthSamples.value, meta: healthSamples.meta })
    .from(healthSamples)
    .where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout"), gte(healthSamples.start, addDays(from, -1))))
    .all()
    .map((s) => {
      const m = (s.meta ?? {}) as { type?: string; kcal?: number | null; distanceM?: number | null };
      const label = String(m.type ?? "Séance");
      return { date: todayParis(new Date(s.start)), at: s.start, label, sub: null, minutes: s.value ? Math.round(s.value) : null, distanceM: m.distanceM ?? null, kcal: m.kcal ?? null, source: "apple" as const };
    })
    .filter((a) => a.date >= from && !(["renfo", "kettlebell", "autre"].includes(sportOf(a.label)) && carnetDays.has(a.date)));
  return [...carnet, ...apple].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? "").localeCompare(a.at ?? ""));
}

/** Les nuits entre `from` et `to` (date du réveil), phases réunies (./sleep). */
export function sleepNights(db: Db, personId: string, from: string, to: string): Night[] {
  // Les instants en millisecondes, lus par SQLite : des dizaines de milliers de phases sur des années.
  const rows = db.all<{ start: number; end: number | null; stage: string | null }>(sql`
    select cast(round(unixepoch(start, 'subsec') * 1000) as integer) as start, cast(round(unixepoch("end", 'subsec') * 1000) as integer) as "end",
      json_extract(meta, '$.stage') as stage from health_samples
    where person_id = ${personId} and kind = 'sleep' and start >= ${addDays(from, -1)} and start <= ${`${to}~`}`);
  const segs = rows.filter((r) => r.end != null && r.start != null).map((r) => ({ stage: (r.stage ?? "asleep") as Stage, start: r.start, end: r.end! }));
  return nights(segs).filter((n) => n.date >= from && n.date <= to);
}

export interface SleepBucket extends Bucket {
  /** Minutes moyennes par nuit, par phase (null sans détail). */
  deep: number | null;
  core: number | null;
  rem: number | null;
}

/** Les nuits regroupées : sommeil moyen par nuit et ses phases. */
export function sleepBuckets(list: Night[], period: Pick<Period, "from" | "to" | "grain">): SleepBucket[] {
  const by = new Map<string, Night[]>();
  for (const n of list) {
    const b = bucketOf(n.date, period.grain);
    const xs = by.get(b);
    if (xs) xs.push(n);
    else by.set(b, [n]);
  }
  const rows: BucketRow[] = [...by.entries()].map(([bucket, xs]) => ({ bucket, total: xs.reduce((s, n) => s + n.asleepMin, 0), n: xs.length }));
  const avgOf = (xs: Night[], k: "deepMin" | "coreMin" | "remMin") => {
    const v = xs.flatMap((n) => (n[k] != null ? [n[k]!] : []));
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  return fillBuckets(rows, period, "mean").map((b) => {
    const xs = by.get(b.start) ?? [];
    return { ...b, deep: avgOf(xs, "deepMin"), core: avgOf(xs, "coreMin"), rem: avgOf(xs, "remMin") };
  });
}

/** Une série pour une tuile : la moyenne récente, la comparaison, et 30 jours pour la petite courbe. */
function tile(db: Db, personId: string, kind: SeriesKind, today: string, complete: boolean) {
  const pts = dayValues(db, personId, kind, addDays(today, -60), today);
  if (!pts.length) return null;
  const r = recent(pts, today, 7, complete);
  const end = complete ? addDays(today, -1) : today;
  return { ...r, last: pts[pts.length - 1], spark: daily(pts, addDays(end, -29), end).map((p) => p.value) };
}

/** Dernière mesure d'un type rare (VO2max, masse grasse) et celle d'il y a un mois au moins, avec l'année pour la courbe. */
function latest(db: Db, personId: string, kind: SeriesKind, today: string) {
  const pts = dayValues(db, personId, kind, addDays(today, -365), today);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const old = [...pts].reverse().find((p) => p.date <= addDays(last.date, -28));
  return { value: last.value, at: last.date, before: old?.value ?? null, spark: pts.map((p) => p.value) };
}

/** Tout ce que la vue d'ensemble affiche, pour une personne et une période. */
export function overview(db: Db, person: Person, key: PeriodKey, today = todayParis()) {
  const id = person.id;
  const kinds = kindsFirst(db, id);
  const period = periodOf(key, today, firstDay(db, id, kinds));
  const has = (k: HealthKind) => kinds.has(k);

  // Poids : toute l'histoire pour la tendance (une ligne par pesée, quelques milliers au plus).
  const weighs = listWeighIns(db, id);
  const dailyKg = dailyWeights(weighs);
  const series = trendSeries(dailyKg, today);
  const weight = series.length > 1 ? weightView(dailyKg, period, series) : [];

  const bars = (kind: SeriesKind, mode: "mean" | "sum" = "mean") => (has(kind) ? fillBuckets(bucketRows(db, id, kind, period.from, period.to, period.grain), period, mode) : null);
  // Les courbes du cœur : au jour jusqu'à un an, au mois sur plusieurs années.
  const lineGrain = lineGrainOf(period.grain);
  const line = (kind: SeriesKind) => (has(kind) ? fillBuckets(bucketRows(db, id, kind, period.from, period.to, lineGrain), { ...period, grain: lineGrain }, "mean") : null);

  const acts = listActivities(db, id, addDays(today, -400) < period.from ? addDays(today, -400) : period.from);
  const nightsAll = has("sleep") ? sleepNights(db, id, addDays(today, -30) < period.from ? addDays(today, -30) : period.from, today) : [];
  const lastNights = nightsAll.filter((n) => n.date > addDays(today, -8)).slice(-7);
  const sleepAvg = lastNights.length ? lastNights.reduce((s, n) => s + n.asleepMin, 0) / lastNights.length : null;

  const steps = has("steps") ? tile(db, id, "steps", today, true) : null;
  const activeKcal = has("active_kcal") ? tile(db, id, "active_kcal", today, true) : null;
  const exercise = has("exercise_min") ? tile(db, id, "exercise_min", today, true) : null;
  const restingHr = has("resting_hr") ? tile(db, id, "resting_hr", today, false) : null;
  const hrv = has("hrv_sdnn") ? tile(db, id, "hrv_sdnn", today, false) : null;
  const vo2max = has("vo2max") ? latest(db, id, "vo2max", today) : null;
  const bodyFat = has("body_fat") ? latest(db, id, "body_fat", today) : null;

  const plan = planOf(person);
  const perWeek = plan.reduce((s, p) => s + p.perWeek, 0);
  const week = sessionsSince(acts, today, 7);
  const last = series[series.length - 1];
  const rate = weeklyRate(series);

  return {
    period,
    today,
    weight,
    trend: last ? { kg: last.trend, rate } : null,
    sessions: { ...week, perWeek },
    tiles: {
      steps,
      activeKcal,
      exercise,
      sleep: sleepAvg != null ? { avgMin: sleepAvg, nights: lastNights, spark: nightsSpark(nightsAll, today) } : null,
      restingHr,
      hrv,
      vo2max,
      bodyFat,
    },
    bars: {
      steps: bars("steps"),
      activeKcal: bars("active_kcal"),
      // Les minutes d'activité d'Apple (anneau vert), sinon celles des séances.
      exercise: bars("exercise_min", "sum"),
    },
    lines: { restingHr: line("resting_hr"), hrv: line("hrv_sdnn") },
    sleep: nightsAll.length ? sleepBuckets(nightsAll.filter((n) => n.date >= period.from), period) : null,
    types: minutesByType(acts, period),
    activities: acts,
    synthesis: synthesis({
      steps: steps && { now: steps.now, before: steps.before, pct: steps.pct },
      activeKcal: activeKcal && { now: activeKcal.now, before: activeKcal.before, pct: activeKcal.pct },
      sessions: acts.length || perWeek ? { ...week, perWeek } : null,
      sleepMin: sleepAvg,
      restingHr: restingHr && { now: restingHr.now, before: restingHr.before, pct: restingHr.pct },
      trendKg: last?.trend ?? null,
      rateKg: rate,
    }),
  };
}

/** Sommeil des 30 dernières nuits, une valeur par nuit (null sans mesure). */
function nightsSpark(list: Night[], today: string) {
  const by = new Map(list.map((n) => [n.date, n.asleepMin]));
  return Array.from({ length: 30 }, (_, i) => by.get(addDays(today, i - 29)) ?? null);
}

export type Overview = ReturnType<typeof overview>;

// Ce qu'a envoyé Apple Santé : dernier envoi, ce qui a été reçu, pas et énergie récents, séances, et les
// signaux du corps (sommeil, cœur, VO2max, masse grasse) affichés dans Santé. Les apports (diet_*, eau) et le
// cycle sont gardés mais ne sortent pas d'ici : ni l'assistant ni le coach ne les lisent.
import { and, count, desc, eq, gte, inArray, max } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { healthSamples, weighIns, type HealthKind } from "@/lib/db/schema";
import { nights, type Night, type Stage } from "./sleep";
import { todayParis } from "./store";
import { addDays } from "@/lib/week/propose";

export function lastReceived(db: Db, personId: string) {
  const w = db.select({ at: max(weighIns.measuredAt) }).from(weighIns).where(and(eq(weighIns.personId, personId), eq(weighIns.source, "health"))).get()?.at ?? null;
  const s = db.select({ at: max(healthSamples.start) }).from(healthSamples).where(eq(healthSamples.personId, personId)).get()?.at ?? null;
  return { weight: w, sample: s };
}

/** Combien de lignes reçues d'Apple Santé, par type (les pesées sous « body_mass »). Seuls les types présents. */
export function receivedCounts(db: Db, personId: string): Partial<Record<HealthKind | "body_mass", number>> {
  const out: Partial<Record<HealthKind | "body_mass", number>> = {};
  const w = db.select({ n: count() }).from(weighIns).where(and(eq(weighIns.personId, personId), inArray(weighIns.source, ["health", "import"]))).get()?.n ?? 0;
  if (w) out.body_mass = w;
  for (const r of db.select({ kind: healthSamples.kind, n: count() }).from(healthSamples).where(eq(healthSamples.personId, personId)).groupBy(healthSamples.kind).all()) out[r.kind] = r.n;
  return out;
}

export function recentDaily(db: Db, personId: string, kind: "steps" | "active_kcal", since: string) {
  return db.select({ date: healthSamples.start, value: healthSamples.value }).from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, kind), gte(healthSamples.start, since))).orderBy(healthSamples.start).all();
}

export function recentWorkouts(db: Db, personId: string, limit = 10) {
  return db.select().from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout"))).orderBy(desc(healthSamples.start)).limit(limit).all();
}

export interface Signal {
  /** Moyenne des 7 derniers jours (cœur) ou dernière mesure (VO2max, masse grasse). */
  value: number;
  at: string;
  /** La même chose un mois plus tôt, pour la tendance. */
  before: number | null;
}

export interface BodySignals {
  sleep: { nights: Night[]; avgMin: number } | null;
  restingHr: Signal | null;
  hrv: Signal | null;
  vo2max: Signal | null;
  bodyFat: Signal | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Les signaux du corps envoyés par l'app, s'il y en a. */
export function bodySignals(db: Db, personId: string, today = todayParis()): BodySignals {
  const since = addDays(today, -60);
  const rows = (kind: HealthKind) =>
    db.select({ start: healthSamples.start, end: healthSamples.end, value: healthSamples.value, meta: healthSamples.meta }).from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, kind), gte(healthSamples.start, since))).orderBy(healthSamples.start).all();
  const weekAvg = (kind: HealthKind): Signal | null => {
    const xs = rows(kind);
    if (!xs.length) return null;
    const last = todayParis(new Date(xs[xs.length - 1].start));
    const inWeek = (end: string) => xs.filter((x) => todayParis(new Date(x.start)) > addDays(end, -7) && todayParis(new Date(x.start)) <= end).map((x) => x.value);
    return { value: avg(inWeek(last))!, at: last, before: avg(inWeek(addDays(last, -28))) };
  };
  const latest = (kind: HealthKind): Signal | null => {
    const xs = db.select({ start: healthSamples.start, value: healthSamples.value }).from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, kind))).orderBy(desc(healthSamples.start)).limit(60).all();
    if (!xs.length) return null;
    const at = todayParis(new Date(xs[0].start));
    const old = xs.find((x) => todayParis(new Date(x.start)) <= addDays(at, -28));
    return { value: xs[0].value, at, before: old?.value ?? null };
  };
  const segs = rows("sleep")
    .filter((r) => r.end)
    .map((r) => ({ stage: String((r.meta as { stage?: string } | null)?.stage ?? "asleep") as Stage, start: r.start, end: r.end! }));
  const recent = nights(segs).filter((n) => n.date > addDays(today, -8)).slice(-7);
  return {
    sleep: recent.length ? { nights: recent, avgMin: Math.round(avg(recent.map((n) => n.asleepMin))!) } : null,
    restingHr: weekAvg("resting_hr"),
    hrv: weekAvg("hrv_sdnn"),
    vo2max: latest("vo2max"),
    bodyFat: latest("body_fat"),
  };
}

// Import Apple Santé, format v2 : ce qu'envoie l'app Mijote Santé de l'iPhone (docs/sante.md, « Le
// contrat »). Deux temps : `parseV2` (pur, testé) vérifie l'enveloppe, puis chaque élément un par un — un
// élément illisible ou hors bornes est compté dans `skipped`, le reste du paquet passe ; `ingestV2` range.
// Dédoublonnage : par uuid de Santé pour les échantillons, séances et phases de sommeil (`hk:<uuid>`), par
// (type, date) pour les totaux du jour, qui remplacent le précédent. Renvoyer ne coûte donc rien.
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { healthSamples, weighIns, workoutDetails, type HealthKind } from "@/lib/db/schema";
import { emptyDetails, encodeHr, parseDetails, type Details } from "@/lib/running/details";
import { clean, peak30, resample } from "@/lib/running/series";
import { activityLabel } from "./ingest";
import { todayParis } from "./store";

/** Au plus par requête : 2 000 éléments toutes listes confondues, 1 Mo de corps (au-delà : 413). */
export const MAX_ITEMS = 2000;
export const MAX_BYTES = 1024 * 1024;

type Bounds = { unit: string; min: number; max: number; integer?: boolean };

/** Les échantillons : unité fixe (l'app convertit), bornes de vraisemblance. body_mass va dans les pesées. */
export const SAMPLE_TYPES: Record<string, Bounds & { kind: HealthKind | "weigh_in" }> = {
  body_mass: { kind: "weigh_in", unit: "kg", min: 25, max: 300 },
  body_fat: { kind: "body_fat", unit: "%", min: 2, max: 75 },
  lean_mass: { kind: "lean_mass", unit: "kg", min: 15, max: 200 },
  resting_hr: { kind: "resting_hr", unit: "bpm", min: 25, max: 200 },
  hrv_sdnn: { kind: "hrv_sdnn", unit: "ms", min: 1, max: 500 },
  vo2max: { kind: "vo2max", unit: "mL/kg/min", min: 5, max: 100 },
  // HKCategoryValueMenstrualFlow : 1 non précisé, 2 léger, 3 moyen, 4 abondant, 5 aucun.
  menstrual: { kind: "menstrual", unit: "catégorie", min: 1, max: 5, integer: true },
};

/** Les totaux du jour (jour civil du téléphone). Pas et énergie active gardent leurs noms du format v1. */
export const DAILY_TYPES: Record<string, Bounds & { kind: HealthKind }> = {
  steps: { kind: "steps", unit: "count", min: 0, max: 150_000 },
  active_energy: { kind: "active_kcal", unit: "kcal", min: 0, max: 10_000 },
  basal_energy: { kind: "basal_energy", unit: "kcal", min: 0, max: 6_000 },
  exercise_min: { kind: "exercise_min", unit: "min", min: 0, max: 1440 },
  walk_run_m: { kind: "walk_run_m", unit: "m", min: 0, max: 200_000 },
  diet_energy: { kind: "diet_energy", unit: "kcal", min: 0, max: 15_000 },
  diet_protein: { kind: "diet_protein", unit: "g", min: 0, max: 1_000 },
  water: { kind: "water", unit: "mL", min: 0, max: 15_000 },
};

export const SLEEP_STAGES = ["in_bed", "asleep", "core", "deep", "rem", "awake"] as const;
export type SleepStage = (typeof SLEEP_STAGES)[number];

const when = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "date illisible (ISO 8601 attendu)");
const n = z.number().finite();
const uuid = z.string().trim().min(1).max(200);
const meta = z.record(z.string(), z.unknown()).optional();
const source = z.string().max(200).optional();
const list = z.array(z.unknown()).default([]);

export const EnvelopeV2 = z.object({
  version: z.literal(2),
  source: z.string().optional(),
  app: z.object({ version: z.string().optional(), device: z.string().optional(), tz: z.string().optional() }).partial().optional(),
  // Sans `batch`, la requête est un paquet unique, donc le dernier.
  batch: z.object({ id: z.string().optional(), index: z.number().optional(), last: z.boolean().optional(), history: z.string().optional() }).optional(),
  samples: list,
  daily: list,
  workouts: list,
  sleep: list,
  deleted: list,
});

const Sample = z.object({ uuid, type: z.string(), start: when, end: when.optional(), value: n, unit: z.string().optional(), sourceName: source, meta });
const Daily = z.object({ type: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "date AAAA-MM-JJ attendue"), value: n, unit: z.string().optional() });
const opt = (min: number, max: number) => z.preprocess((v) => (v == null ? undefined : v), n.min(min).max(max).optional());
const Workout = z.object({
  uuid,
  activity: z.string().default(""),
  start: when,
  end: when.optional(),
  durationMin: opt(0, 1440),
  kcal: opt(0, 10_000),
  distanceM: opt(0, 500_000),
  hrAvg: opt(20, 250),
  hrMax: opt(20, 250),
  sourceName: source,
  meta,
  // v2.1 : le détail (série de FC, temps au kilomètre…), lu à part par src/lib/running/details.ts.
  details: z.unknown().optional(),
});
const Sleep = z.object({ uuid, stage: z.enum(SLEEP_STAGES), start: when, end: when, sourceName: source });
const Deleted = z.object({ uuid, type: z.string().optional() });

export interface V2Sample { uuid: string; type: string; start: string; end: string | null; value: number; meta: Record<string, unknown> | null }
export interface V2Daily { type: string; date: string; value: number }
export interface V2Workout { uuid: string; label: string; start: string; end: string | null; minutes: number; meta: Record<string, unknown>; details: Details | null }
export interface V2Sleep { uuid: string; stage: SleepStage; start: string; end: string; minutes: number; source: string | null }

export interface ParsedV2 {
  last: boolean;
  historyComplete: boolean;
  samples: V2Sample[];
  daily: V2Daily[];
  workouts: V2Workout[];
  sleep: V2Sleep[];
  deleted: string[];
  skipped: number;
}

/** `details` (v2.1) : séances dont le détail a été rangé (ajouté au contrat, les autres clés ne bougent pas). */
export type AcceptedV2 = { samples: number; daily: number; workouts: number; sleep: number; deleted: number; details: number };

const iso = (s: string) => new Date(s).toISOString();
const within = (v: number, b: Bounds) => v >= b.min && v <= b.max && (!b.integer || Number.isInteger(v));
/** Une même clé deux fois dans le paquet : la dernière gagne. */
const lastBy = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
const small = (m: Record<string, unknown> | undefined, sourceName?: string) => {
  const out = { ...(m && JSON.stringify(m).length <= 2000 ? m : {}), ...(sourceName ? { source: sourceName } : {}) };
  return Object.keys(out).length ? out : null;
};

/** Nombre d'éléments d'un corps v2 (pour la limite par requête), sans rien valider d'autre. */
export function countItems(body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const b = body as Record<string, unknown>;
  return ["samples", "daily", "workouts", "sleep", "deleted"].reduce((s, k) => s + (Array.isArray(b[k]) ? (b[k] as unknown[]).length : 0), 0);
}

/**
 * Vérifie un paquet v2. Enveloppe illisible → `{ error }` (400). Ensuite, élément par élément : illisible,
 * type inconnu, hors bornes, date dans le futur → compté dans `skipped`. Pur.
 */
export function parseV2(body: unknown, now = new Date()): ParsedV2 | { error: string } {
  const env = EnvelopeV2.safeParse(body);
  if (!env.success) return { error: env.error.issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ; ") };
  const e = env.data;
  const future = now.getTime() + 36 * 3_600_000; // un jour civil d'avance au plus (fuseaux)
  let skipped = 0;
  const each = <S extends z.ZodTypeAny, T>(xs: unknown[], schema: S, keep: (x: z.infer<S>) => T | null): T[] => {
    const out: T[] = [];
    for (const raw of xs) {
      const p = schema.safeParse(raw);
      const v = p.success ? keep(p.data) : null;
      if (v == null) skipped++;
      else out.push(v);
    }
    return out;
  };

  const samples = each(e.samples, Sample, (s) => {
    const t = SAMPLE_TYPES[s.type];
    if (!t || !within(s.value, t) || Date.parse(s.start) > future) return null;
    if (s.end && Date.parse(s.end) < Date.parse(s.start)) return null;
    return { uuid: s.uuid, type: s.type, start: iso(s.start), end: s.end ? iso(s.end) : null, value: s.value, meta: small(s.meta, s.sourceName) };
  });
  const daily = each(e.daily, Daily, (d) => {
    const t = DAILY_TYPES[d.type];
    const date = d.date.slice(0, 10);
    if (!t || !within(d.value, t) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || Date.parse(`${date}T00:00:00Z`) > future) return null;
    return { type: d.type, date, value: d.value };
  });
  const workouts = each(e.workouts, Workout, (w) => {
    const start = Date.parse(w.start);
    const end = w.end ? Date.parse(w.end) : null;
    if (start > future || (end != null && end < start)) return null;
    const minutes = w.durationMin ?? (end != null ? (end - start) / 60_000 : null);
    if (minutes == null || minutes > 1440) return null;
    const m = { ...(w.meta && JSON.stringify(w.meta).length <= 2000 ? w.meta : {}) };
    const details = parseDetails(w.details, Math.round(minutes * 60));
    return {
      uuid: w.uuid,
      label: activityLabel(w.activity),
      start: iso(w.start),
      end: w.end ? iso(w.end) : null,
      minutes: Math.round(minutes * 10) / 10,
      meta: { ...m, type: activityLabel(w.activity), activity: w.activity, kcal: w.kcal ?? null, distanceM: w.distanceM ?? null, hrAvg: w.hrAvg ?? null, hrMax: w.hrMax ?? null, ...(w.sourceName ? { source: w.sourceName } : {}) },
      details: details && !emptyDetails(details) ? details : null,
    };
  });
  const sleep = each(e.sleep, Sleep, (s) => {
    const start = Date.parse(s.start);
    const minutes = (Date.parse(s.end) - start) / 60_000;
    if (start > future || !(minutes > 0 && minutes <= 1440)) return null;
    return { uuid: s.uuid, stage: s.stage, start: iso(s.start), end: iso(s.end), minutes: Math.round(minutes * 10) / 10, source: s.sourceName ?? null };
  });
  const deleted = each(e.deleted, Deleted, (d) => d.uuid);

  const last = e.batch?.last ?? !e.batch;
  return {
    last,
    historyComplete: last && e.batch?.history === "complete",
    samples: lastBy(samples, (s) => s.uuid),
    daily: lastBy(daily, (d) => `${d.type}:${d.date}`),
    workouts: lastBy(workouts, (w) => w.uuid),
    sleep: lastBy(sleep, (s) => s.uuid),
    deleted: [...new Set(deleted)],
    skipped,
  };
}

const hk = (uuid: string) => `hk:${uuid}`;

/** La ligne de workout_details d'une séance : série en binaire, pic de 30 s et « FC douteuse » (sans les zones). */
function detailsRow(personId: string, sampleId: string, w: V2Workout) {
  const d = w.details!;
  const cleaned = d.hr ? clean(resample(d.hr, Math.round(w.minutes * 60)), d.cadenceAvg) : null;
  const { hr, effort, weather, indoor, plannedId, ...rest } = d;
  const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null));
  return {
    sampleId,
    personId,
    date: todayParis(new Date(w.start)),
    hr: hr ? encodeHr(hr) : null,
    hrPoints: hr?.length ?? 0,
    data,
    effort,
    tempC: weather?.tempC ?? null,
    humidityPct: weather?.humidityPct ?? null,
    indoor,
    plannedId,
    peak: cleaned && !cleaned.doubtful ? peak30(cleaned.hr) : null,
    doubtful: !!cleaned?.doubtful,
    analysis: null,
  };
}

/**
 * Range un paquet vérifié pour une personne. Une pesée ou une séance déjà reçue de l'ancien Raccourci ou de
 * l'export (même instant) est reprise sous son uuid plutôt que doublée. Les suppressions passent en dernier.
 */
export function ingestV2(db: Db, personId: string, p: ParsedV2): { accepted: AcceptedV2; skipped: number } {
  const accepted: AcceptedV2 = { samples: 0, daily: 0, workouts: 0, sleep: 0, deleted: 0, details: 0 };
  db.transaction((tx) => {
    for (const s of p.samples) {
      const t = SAMPLE_TYPES[s.type];
      if (t.kind === "weigh_in") {
        const kg = Math.round(s.value * 100) / 100;
        const at = s.start;
        const old = tx.select({ id: weighIns.id }).from(weighIns).where(and(eq(weighIns.personId, personId), eq(weighIns.externalId, `w:${at}`))).get();
        const mine = tx.select({ id: weighIns.id }).from(weighIns).where(and(eq(weighIns.personId, personId), eq(weighIns.externalId, hk(s.uuid)))).get();
        const values = { date: todayParis(new Date(at)), measuredAt: at, kg, externalId: hk(s.uuid) };
        if (mine) tx.update(weighIns).set(values).where(eq(weighIns.id, mine.id)).run();
        else if (old) tx.update(weighIns).set(values).where(eq(weighIns.id, old.id)).run();
        else tx.insert(weighIns).values({ id: randomUUID(), personId, source: "health", ...values }).run();
      } else {
        tx.insert(healthSamples)
          .values({ id: randomUUID(), personId, kind: t.kind, start: s.start, end: s.end, value: s.value, unit: t.unit, meta: s.meta, externalId: hk(s.uuid) })
          .onConflictDoUpdate({ target: [healthSamples.personId, healthSamples.kind, healthSamples.externalId], set: { start: s.start, end: s.end, value: s.value, meta: s.meta } })
          .run();
      }
      accepted.samples++;
    }
    for (const d of p.daily) {
      const t = DAILY_TYPES[d.type];
      tx.insert(healthSamples)
        .values({ id: randomUUID(), personId, kind: t.kind, start: d.date, value: d.value, unit: t.unit, externalId: `${t.kind}:${d.date}` })
        .onConflictDoUpdate({ target: [healthSamples.personId, healthSamples.kind, healthSamples.externalId], set: { value: d.value } })
        .run();
      accepted.daily++;
    }
    for (const w of p.workouts) {
      const values = { start: w.start, end: w.end, value: w.minutes, meta: w.meta, externalId: hk(w.uuid) };
      const mine = tx.select({ id: healthSamples.id }).from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout"), eq(healthSamples.externalId, hk(w.uuid)))).get();
      const old = mine ? null : tx.select({ id: healthSamples.id }).from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout"), eq(healthSamples.externalId, `workout:${w.start}`))).get();
      let id = mine?.id ?? old?.id;
      if (id) tx.update(healthSamples).set(values).where(eq(healthSamples.id, id)).run();
      else tx.insert(healthSamples).values({ id: (id = randomUUID()), personId, kind: "workout", unit: "min", ...values }).run();
      accepted.workouts++;
      // Complétion par uuid : un détail reçu remplace le précédent ; une séance renvoyée sans détail garde le sien.
      if (w.details) {
        const row = detailsRow(personId, id, w);
        tx.insert(workoutDetails).values(row).onConflictDoUpdate({ target: workoutDetails.sampleId, set: { ...row, analysis: null, updatedAt: new Date().toISOString() } }).run();
        accepted.details++;
      }
    }
    for (const s of p.sleep) {
      const meta = { stage: s.stage, ...(s.source ? { source: s.source } : {}) };
      tx.insert(healthSamples)
        .values({ id: randomUUID(), personId, kind: "sleep", start: s.start, end: s.end, value: s.minutes, unit: "min", meta, externalId: hk(s.uuid) })
        .onConflictDoUpdate({ target: [healthSamples.personId, healthSamples.kind, healthSamples.externalId], set: { start: s.start, end: s.end, value: s.minutes, meta } })
        .run();
      accepted.sleep++;
    }
    for (let i = 0; i < p.deleted.length; i += 500) {
      const ids = p.deleted.slice(i, i + 500).map(hk);
      tx.delete(healthSamples).where(and(eq(healthSamples.personId, personId), inArray(healthSamples.externalId, ids))).run();
      tx.delete(weighIns).where(and(eq(weighIns.personId, personId), inArray(weighIns.externalId, ids))).run();
    }
    accepted.deleted = p.deleted.length;
  });
  return { accepted, skipped: p.skipped };
}

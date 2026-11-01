// Module Course vu par la base : réglages par personne (run_profiles), courses reçues d'Apple Santé et leur
// détail (health_samples, workout_details), analyses gardées, plan recalculé à chaque lecture et rangé dans
// run_sessions (id stable, version qui monte quand le contenu change, statut prévue → programmée → faite,
// manquée ou annulée), ressenti (run_feedback). Le calcul est dans les modules purs de ce dossier.
import { createHash, randomUUID } from "crypto";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { healthSamples, people, runFeedback, runProfiles, runSessions, workoutDetails, workouts } from "@/lib/db/schema";
import { sportOf } from "@/lib/health/goals";
import { nights, type Stage } from "@/lib/health/sleep";
import { todayParis } from "@/lib/health/store";
import { applyEdit, HR_BOUNDS, PER_WEEK_BOUNDS, type RunContext, type SessionEdit } from "./actions";
import { analyzeRun, type RunAnalysis, type RunDetails } from "./analysis";
import { LONGEST_WINDOW_DAYS, RUNNING_VERSION, WATCH_DAYS } from "./constants";
import { addDays, daysBetween, isHm, isYmd, mondayOfDay, parisDay, weekday } from "./dates";
import { decodeHr } from "./details";
import { fitness, fitPace, sessionLoad, type LoadKind, type LoadRefs, type PaceFit } from "./load";
import { buildPlan, GOALS, type DoneRun, type Feedback, type FixedKind, type Pause, type PlanOutput, type PlanSettings, type RunGoal, type WeekOverride } from "./plan";
import { morning, type Morning } from "./signals";
import { intensityShare } from "./trends";
import { toWorkoutSpec, type RunSession, type SessionKind } from "./workout";
import { hrRefs, observedMax, restAt, zonesKey, zonesOf, type Zones } from "./zones";

export type RunProfile = typeof runProfiles.$inferSelect;
export type RunSessionRow = typeof runSessions.$inferSelect;

// ─── Réglages ───

export const getRunProfile = (db: Db, personId: string): RunProfile | null => db.select().from(runProfiles).where(eq(runProfiles.personId, personId)).get() ?? null;

const hr = (lo: number, hi: number) => z.number().int().min(lo).max(hi).nullable().default(null);
/** Les réglages saisis (page ou action confirmée), bornés. */
export const RunSettingsInput = z
  .object({
    enabled: z.boolean(),
    days: z.array(z.object({ weekday: z.number().int().min(0).max(6), time: z.string().nullable().optional() })).max(7),
    perWeek: z.number().int().min(PER_WEEK_BOUNDS[0]).max(PER_WEEK_BOUNDS[1]),
    goal: z.enum(GOALS),
    goalNote: z.string().trim().max(300).nullable().default(null),
    longRunDay: z.number().int().min(0).max(6).nullable().default(null),
    time: z.string().nullable().default(null),
    hrMax: hr(HR_BOUNDS.max[0], HR_BOUNDS.max[1]),
    hrRest: hr(HR_BOUNDS.rest[0], HR_BOUNDS.rest[1]),
    hrThreshold: hr(80, 220),
    thresholdSource: z.enum(["saisie", "test"]).nullable().default(null),
    fixed: z.array(z.object({ weekday: z.number().int().min(0).max(6), kind: z.enum(["natation", "kettlebell", "renfo"]) })).max(14).nullable().default(null),
  })
  .superRefine((x, ctx) => {
    if (x.time != null && !isHm(x.time)) ctx.addIssue({ code: "custom", message: "heure HH:MM attendue", path: ["time"] });
    for (const d of x.days) if (d.time != null && !isHm(d.time)) ctx.addIssue({ code: "custom", message: "heure HH:MM attendue", path: ["days"] });
    if (x.enabled && !x.days.length) ctx.addIssue({ code: "custom", message: "au moins un jour disponible", path: ["days"] });
    if (x.hrMax != null && x.hrRest != null && x.hrMax - x.hrRest < 40) ctx.addIssue({ code: "custom", message: "FC max et FC au repos trop proches", path: ["hrMax"] });
    if (x.hrThreshold != null) {
      const lo = (x.hrRest ?? 30) + 20;
      const hi = x.hrMax ?? 230;
      if (!(x.hrThreshold > lo && x.hrThreshold < hi)) ctx.addIssue({ code: "custom", message: "FC au seuil entre FC au repos + 20 et FC max", path: ["hrThreshold"] });
    }
  });
export type RunSettings = z.output<typeof RunSettingsInput>;

/** Enregistre les réglages ; la première activation fixe le jour de mise en route du plan. */
export function saveRunSettings(db: Db, personId: string, input: z.input<typeof RunSettingsInput>, today: string): RunProfile {
  const x = RunSettingsInput.parse(input);
  const days = [...new Map(x.days.map((d) => [d.weekday, { weekday: d.weekday, time: d.time ?? null }])).values()].sort((a, b) => a.weekday - b.weekday);
  const old = getRunProfile(db, personId);
  const values = {
    enabled: x.enabled,
    days,
    perWeek: x.perWeek,
    goal: x.goal,
    goalNote: x.goalNote || null,
    longRunDay: x.longRunDay,
    time: x.time,
    hrMax: x.hrMax,
    hrRest: x.hrRest,
    hrThreshold: x.hrThreshold,
    thresholdSource: x.hrThreshold != null ? (x.thresholdSource ?? "saisie") : null,
    fixed: x.fixed,
    startedOn: old?.startedOn ?? (x.enabled ? today : null),
    updatedAt: new Date().toISOString(),
  };
  if (old) db.update(runProfiles).set({ ...values, startedOn: old.startedOn ?? (x.enabled ? today : null) }).where(eq(runProfiles.personId, personId)).run();
  else db.insert(runProfiles).values({ personId, ...values, pauses: [], overrides: [] }).run();
  return getRunProfile(db, personId)!;
}

/** Les réglages actuels sous la forme d'entrée (pour changer un seul champ). */
export const settingsOf = (p: RunProfile): z.input<typeof RunSettingsInput> => ({
  enabled: p.enabled,
  days: p.days,
  perWeek: p.perWeek,
  goal: p.goal,
  goalNote: p.goalNote,
  longRunDay: p.longRunDay,
  time: p.time,
  hrMax: p.hrMax,
  hrRest: p.hrRest,
  hrThreshold: p.hrThreshold,
  thresholdSource: p.thresholdSource,
  fixed: p.fixed,
});

function patchProfile(db: Db, personId: string, patch: Partial<RunProfile>) {
  db.update(runProfiles).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(runProfiles.personId, personId)).run();
}

/** Met le plan en pause (maladie, à la demande). La suspension pour douleur est posée par le plan lui-même. */
export function pausePlan(db: Db, personId: string, reason: "malade" | "personne", today: string) {
  const p = getRunProfile(db, personId);
  if (!p || p.pauses.some((x) => x.to == null)) return;
  patchProfile(db, personId, { pauses: [...p.pauses, { from: today, to: null, reason }] });
}

/** Rouvre le plan (seule la personne le fait, même après une suspension pour douleur) : départ recalculé (§ 4.2). */
export function resumePlan(db: Db, personId: string, today: string) {
  const p = getRunProfile(db, personId);
  if (!p) return;
  patchProfile(db, personId, { pauses: p.pauses.map((x) => (x.to == null ? { ...x, to: today > x.from ? today : addDays(x.from, 1) } : x)) });
}

/** Une semaine réglée (décharge, volume) : remplace celle du même lundi. */
export function setWeekOverride(db: Db, personId: string, o: WeekOverride) {
  const p = getRunProfile(db, personId);
  if (!p) return;
  patchProfile(db, personId, { overrides: [...p.overrides.filter((x) => x.weekStart !== o.weekStart), o].sort((a, b) => a.weekStart.localeCompare(b.weekStart)) });
}

/** Change une séance prévue (jour, durée, type), rejoué à chaque calcul. */
export function editSession(db: Db, personId: string, sessionId: string, edit: SessionEdit) {
  const row = db.select().from(runSessions).where(and(eq(runSessions.id, sessionId), eq(runSessions.personId, personId))).get();
  if (!row) throw new Error("Séance introuvable.");
  db.update(runSessions).set({ edit: { ...row.edit, ...edit } }).where(eq(runSessions.id, sessionId)).run();
}

// ─── Ressenti ───

export const PAIN_PLACES = ["pied", "cheville", "tibia", "mollet / tendon d’Achille", "genou", "hanche", "autre"] as const;
export const FeedbackInput = z.object({
  date: z.string().refine(isYmd, "date AAAA-MM-JJ"),
  effort: z.number().int().min(1).max(10).nullable().default(null),
  pain: z.number().int().min(0).max(10).nullable().default(null),
  painWhere: z.enum(PAIN_PLACES).nullable().default(null),
  sick: z.boolean().default(false),
  note: z.string().trim().max(300).nullable().default(null),
});

export function noteFeedback(db: Db, personId: string, input: z.input<typeof FeedbackInput>) {
  const f = FeedbackInput.parse(input);
  const values = { effort: f.effort, pain: f.pain, painWhere: f.pain ? f.painWhere : null, sick: f.sick, note: f.note || null };
  db.insert(runFeedback)
    .values({ id: randomUUID(), personId, date: f.date, ...values })
    .onConflictDoUpdate({ target: [runFeedback.personId, runFeedback.date], set: values })
    .run();
}

const listFeedback = (db: Db, personId: string) => db.select().from(runFeedback).where(eq(runFeedback.personId, personId)).orderBy(asc(runFeedback.date)).all();

// ─── Séances reçues ───

/** Le type d'une séance d'Apple Santé pour la charge (`activity` de l'app, sinon le libellé traduit). */
export function loadKindOf(meta: Record<string, unknown> | null): LoadKind | "course" {
  const activity = String(meta?.activity ?? "").toLowerCase();
  if (activity === "running") return "course";
  if (activity === "walking" || activity === "hiking") return "marche";
  if (activity === "swimming") return "natation";
  const sport = sportOf(String(meta?.type ?? activity));
  return sport === "course" ? "course" : sport === "marche" ? "marche" : sport === "natation" ? "natation" : sport === "kettlebell" ? "kettlebell" : sport === "renfo" || sport === "pilates" ? "renfo" : sport === "velo" ? "velo" : "autre";
}

/** Le type de charge d'une course selon la séance prévue à laquelle elle répond. */
const PLANNED_LOAD: Record<SessionKind, LoadKind> = { marche_course: "marche_course", footing: "footing", footing_lignes: "footing", sortie_longue: "sortie_longue", test_aerobie: "footing", fartlek: "fartlek", cotes: "cotes", tempo: "tempo", test_friel: "tempo" };

interface Workout {
  id: string;
  date: string;
  start: string;
  minutes: number;
  kind: LoadKind | "course";
  distanceM: number | null;
  hrAvg: number | null;
  details: (typeof workoutDetails.$inferSelect) | null;
}

function listWorkoutsWithDetails(db: Db, personId: string): Workout[] {
  const rows = db.select().from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout"))).orderBy(asc(healthSamples.start)).all();
  const det = new Map(db.select().from(workoutDetails).where(eq(workoutDetails.personId, personId)).all().map((d) => [d.sampleId, d]));
  return rows.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const n = (k: string) => (typeof meta[k] === "number" ? (meta[k] as number) : null);
    return { id: r.id, date: parisDay(r.start), start: r.start, minutes: r.value, kind: loadKindOf(meta), distanceM: n("distanceM"), hrAvg: n("hrAvg"), details: det.get(r.id) ?? null };
  });
}

const detailsOf = (d: Workout["details"]): RunDetails | null => {
  if (!d) return null;
  const data = d.data as Partial<RunDetails> & { splits?: RunDetails["splits"]; events?: RunDetails["events"] };
  return {
    hr: d.hrPoints ? decodeHr(d.hr) : undefined,
    splits: data.splits ?? undefined,
    cadenceAvg: (data.cadenceAvg as number | undefined) ?? undefined,
    elevGainM: (data.elevGainM as number | undefined) ?? undefined,
    elevLossM: (data.elevLossM as number | undefined) ?? undefined,
    events: data.events ?? undefined,
    indoor: d.indoor ?? undefined,
    effort: d.effort ?? undefined,
    weather: d.tempC != null || d.humidityPct != null ? { tempC: d.tempC ?? undefined, humidityPct: d.humidityPct ?? undefined } : undefined,
  };
};

const ageAt = (birth: string | null, today: string) => {
  if (!birth || !isYmd(birth)) return null;
  const a = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  return today.slice(5) < birth.slice(5) ? a - 1 : a;
};
/** Sans date de naissance : un âge par défaut pour Tanaka (dit à la personne). */
export const DEFAULT_AGE = 35;

const sampleDays = (db: Db, personId: string, kind: "resting_hr" | "hrv_sdnn", since: string) =>
  db
    .select({ start: healthSamples.start, value: healthSamples.value })
    .from(healthSamples)
    .where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, kind), gte(healthSamples.start, since)))
    .all()
    .map((r) => ({ date: parisDay(r.start), value: r.value }));

/** Une course analysée, avec sa séance prévue (si rapprochée) et le ressenti du jour. */
export interface AnalyzedRun {
  sampleId: string;
  date: string;
  start: string;
  minutes: number;
  distanceKm: number | null;
  analysis: RunAnalysis;
  /** La séance prévue rapprochée, et l'id envoyé par la montre (lancée depuis un plan). */
  plannedId: string | null;
  watchPlannedId: string | null;
  feedback: { effort: number | null; pain: number | null } | null;
}

export interface RunningData {
  today: string;
  profile: RunProfile;
  personName: string;
  age: number;
  ageKnown: boolean;
  zones: Zones;
  observed: { max: number | null; maxPending: number | null; rest: number | null };
  runs: AnalyzedRun[];
  /** Charge de chaque jour (toutes séances) et de course. */
  daily: { date: string; load: number }[];
  dailyRun: { date: string; load: number }[];
  fitness: ReturnType<typeof fitness>;
  morning: Morning;
  feedback: Feedback[];
  fixed: PlanSettings["fixed"];
  rows: RunSessionRow[];
}

/** Rapproche les courses des séances prévues : `plannedId` de la montre, sinon le même jour (une séance par jour). */
function matchRuns(ws: { id: string; date: string; plannedId: string | null }[], rows: RunSessionRow[]): Map<string, RunSessionRow> {
  const out = new Map<string, RunSessionRow>();
  const used = new Set<string>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const w of ws) {
    const r = w.plannedId ? byId.get(w.plannedId) : null;
    if (r && !used.has(r.id)) {
      out.set(w.id, r);
      used.add(r.id);
    }
  }
  for (const w of ws) {
    if (out.has(w.id)) continue;
    const r = rows.find((x) => x.date === w.date && !used.has(x.id) && x.status !== "annulee");
    if (r) {
      out.set(w.id, r);
      used.add(r.id);
    }
  }
  return out;
}

/** Tout ce que le module sait d'une personne au jour `today`. null si le module n'est pas activé. */
export function runningData(db: Db, personId: string, today: string): RunningData | null {
  const profile = getRunProfile(db, personId);
  const person = db.select().from(people).where(eq(people.id, personId)).get();
  if (!profile?.enabled || !person) return null;
  const ageKnown = ageAt(person.birthDate, today) != null;
  const age = ageAt(person.birthDate, today) ?? DEFAULT_AGE;
  const sex = person.sex ?? null;

  const all = listWorkoutsWithDetails(db, personId).filter((w) => w.date <= today);
  const runsW = all.filter((w) => w.kind === "course");
  const rows = db.select().from(runSessions).where(eq(runSessions.personId, personId)).orderBy(asc(runSessions.date)).all();
  const matched = matchRuns(runsW.map((w) => ({ id: w.id, date: w.date, plannedId: w.details?.plannedId ?? null })), rows);
  const fb = listFeedback(db, personId);
  const fbBy = new Map(fb.map((f) => [f.date, f]));

  // Repères : pics de 30 s des séries (sans les zones), FC au repos des 13 derniers mois.
  const restSamples = sampleDays(db, personId, "resting_hr", addDays(today, -400)).map((r) => ({ date: r.date, bpm: r.value }));
  const peaks = runsW.filter((w) => w.details).map((w) => ({ date: w.date, peak: w.details!.peak, doubtful: w.details!.doubtful }));
  const refs = hrRefs({
    age,
    today,
    entered: { max: profile.hrMax, rest: profile.hrRest, threshold: profile.hrThreshold, thresholdSource: profile.thresholdSource },
    peaks,
    rest: restSamples,
  });
  const zones = zonesOf(refs);
  const loadRefs: LoadRefs = { ...refs, sex };
  const obs = observedMax(peaks, age, addDays(today, 1));

  // Analyses : gardées tant que la version, les zones et l'effort n'ont pas bougé.
  const key = zonesKey(zones);
  const analyze = (w: Workout, pace: PaceFit | null): RunAnalysis => {
    const planned = matched.get(w.id);
    const f = fbBy.get(w.date);
    const effort = f?.effort ?? null;
    const kind = planned ? PLANNED_LOAD[planned.kind as SessionKind] ?? "footing" : "footing";
    const cached = w.details?.analysis as (RunAnalysis & { kindKey?: string }) | null | undefined;
    if (cached && cached.version === RUNNING_VERSION && cached.zonesKey === key && (cached.effort ?? null) === (effort ?? w.details?.effort ?? null) && cached.kindKey === kind && !pace) return cached;
    const a = analyzeRun({ kind, minutes: w.minutes, distanceM: w.distanceM, hrAvg: w.hrAvg, effort, details: detailsOf(w.details) }, zones, loadRefs, pace);
    if (w.details && !pace) db.update(workoutDetails).set({ analysis: { ...a, kindKey: kind } as unknown as Record<string, unknown> }).where(eq(workoutDetails.sampleId, w.id)).run();
    return a;
  };
  let analyses = runsW.map((w) => analyze(w, null));
  // Sans FC ni effort : la droite personnelle FC = f(allure) des 90 jours, s'il y a assez de courses avec FC.
  const fit = fitPace(
    runsW
      .map((w, i) => ({ w, a: analyses[i] }))
      .filter(({ w, a }) => daysBetween(w.date, today) <= 90 && a.speed && (w.hrAvg || a.hrCoverage > 0.8))
      .map(({ w, a }) => ({ speed: a.speed!, hr: w.hrAvg ?? 0 }))
      .filter((x) => x.hr > 0)
  );
  if (fit) analyses = analyses.map((a, i) => (a.loadSource === "defaut" && a.speed ? analyze(runsW[i], fit) : a));

  const runs: AnalyzedRun[] = runsW.map((w, i) => {
    const f = fbBy.get(w.date);
    return {
      sampleId: w.id,
      date: w.date,
      start: w.start,
      minutes: w.minutes,
      distanceKm: analyses[i].distanceKm,
      analysis: analyses[i],
      plannedId: matched.get(w.id)?.id ?? null,
      watchPlannedId: w.details?.plannedId ?? null,
      feedback: f ? { effort: f.effort, pain: f.pain } : null,
    };
  });

  // Charge de toutes les séances : courses analysées, autres séances d'Apple, carnet guidé (sans doublon).
  const carnet = db.select().from(workouts).where(eq(workouts.personId, personId)).all();
  const kbDays = new Set(carnet.map((w) => w.date));
  const daily: { date: string; load: number }[] = runs.map((r) => ({ date: r.date, load: r.analysis.load }));
  for (const w of all) {
    if (w.kind === "course") continue;
    if ((w.kind === "renfo" || w.kind === "kettlebell" || w.kind === "autre") && kbDays.has(w.date)) continue;
    daily.push({ date: w.date, load: sessionLoad({ kind: w.kind, minutes: w.minutes, hrAvg: w.hrAvg, effort: w.details?.effort ?? null }, loadRefs).load });
  }
  for (const w of carnet) if (w.minutes) daily.push({ date: w.date, load: sessionLoad({ kind: "kettlebell", minutes: w.minutes }, loadRefs).load });
  const from = daily.length ? daily.map((d) => d.date).sort()[0] : today;
  const fit365 = fitness(daily, from < addDays(today, -365) ? addDays(today, -365) : from, today);
  const tsbPct = fit365[fit365.length - 1]?.tsbPct ?? null;

  // Signaux du matin.
  const hrv = sampleDays(db, personId, "hrv_sdnn", addDays(today, -61)).map((r) => ({ date: r.date, ms: r.value }));
  const sleepRows = db
    .select({ start: healthSamples.start, end: healthSamples.end, meta: healthSamples.meta })
    .from(healthSamples)
    .where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "sleep"), gte(healthSamples.start, addDays(today, -4))))
    .all();
  const sleep = nights(sleepRows.filter((r) => r.end).map((r) => ({ stage: String((r.meta as { stage?: string } | null)?.stage ?? "asleep") as Stage, start: r.start, end: r.end! }))).map((n) => ({ date: n.date, asleepMin: n.asleepMin }));
  const temps = runs.filter((r) => r.analysis.tempC != null).map((r) => ({ date: r.date, tempC: r.analysis.tempC! }));
  const m = morning({ today, hrv, rest: restSamples.filter((r) => r.date > addDays(today, -61)), sleep, tsbPct, temps });

  // Activités fixes : réglées, sinon les jours de natation ou de renforcement d'au moins 2 des 4 dernières semaines.
  const fixed: PlanSettings["fixed"] = profile.fixed ?? derivedFixed(all, carnet.map((w) => w.date), today);

  return {
    today,
    profile,
    personName: person.name,
    age,
    ageKnown,
    zones,
    observed: { max: obs.value, maxPending: obs.pending, rest: restAt(restSamples, addDays(today, 1)) },
    runs,
    daily,
    dailyRun: runs.map((r) => ({ date: r.date, load: r.analysis.load })),
    fitness: fit365,
    morning: m,
    feedback: fb.map((f) => ({ date: f.date, effort: f.effort, pain: f.pain, where: f.painWhere, sick: f.sick })),
    fixed,
    rows,
  };
}

/** Jours de la semaine où la personne nage ou fait du renforcement (au moins 2 fois sur les 4 dernières semaines). */
export function derivedFixed(all: { date: string; kind: LoadKind | "course" }[], carnetDays: string[], today: string): PlanSettings["fixed"] {
  const since = addDays(today, -28);
  const count = new Map<string, number>();
  const add = (date: string, kind: FixedKind) => {
    if (date <= since || date > today) return;
    const k = `${weekday(date)}:${kind}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  };
  for (const w of all) if (w.kind === "natation") add(w.date, "natation");
  for (const w of all) if ((w.kind === "renfo" || w.kind === "kettlebell") && !carnetDays.includes(w.date)) add(w.date, "renfo");
  for (const d of carnetDays) add(d, "kettlebell");
  return [...count.entries()]
    .filter(([, n]) => n >= 2)
    .map(([k]) => ({ weekday: Number(k.split(":")[0]), kind: k.split(":")[1] as FixedKind }))
    .sort((a, b) => a.weekday - b.weekday || a.kind.localeCompare(b.kind));
}

// ─── Le plan ───

/** L'id stable d'une séance : un UUID tiré de (personne, semaine, rôle), dont l'app dérive celui de la montre. */
export function sessionIdOf(personId: string, weekStart: string, role: string) {
  const h = createHash("sha1").update(`mijote-course|${personId}|${weekStart}|${role}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const hashOf = (date: string, time: string | null, s: RunSession) => createHash("sha1").update(JSON.stringify([date, time, s])).digest("hex").slice(0, 16);

/** Une course faite pour le générateur. */
export function doneRunOf(r: AnalyzedRun, rows: Map<string, RunSessionRow>): DoneRun {
  const a = r.analysis;
  const planned = r.plannedId ? rows.get(r.plannedId) : null;
  return {
    date: r.date,
    minutes: a.movingMin || r.minutes,
    km: a.distanceKm,
    continuousMin: a.continuousMin,
    effort: r.feedback?.effort ?? (a.effort != null ? Math.round(a.effort) : null),
    pain: r.feedback?.pain ?? null,
    completed: null,
    hrHighShare: a.hrHighShare,
    decoupling: a.decoupling.ok ? a.decoupling.value : null,
    heat: a.heat,
    planned: planned ? { kind: planned.kind as SessionKind, minutes: planned.minutes, level: ((planned.session as unknown as RunSession).level ?? null) as number | null } : null,
  };
}

export interface PlanState {
  data: RunningData;
  plan: PlanOutput;
  /** Séances rangées de la semaine en cours et de la suivante (après synchronisation). */
  sessions: RunSessionRow[];
}

/**
 * Recalcule le plan au jour `now` et le range : nouvelles séances, contenu changé (version + 1), séances
 * disparues ou annulées par l'adaptation (annulée), passées sans course (manquée), courses rapprochées (faite).
 * Une suspension pour douleur décidée par le plan est enregistrée. Idempotent.
 */
export function syncPlan(db: Db, personId: string, now = new Date()): PlanState | null {
  const today = todayParis(now);
  let data = runningData(db, personId, today);
  if (!data) return null;
  const p = data.profile;
  const rowsById = new Map(data.rows.map((r) => [r.id, r]));
  const input = {
    today,
    startedOn: p.startedOn ?? today,
    settings: { days: p.days, perWeek: p.perWeek, goal: p.goal as RunGoal, longRunDay: p.longRunDay, time: p.time, fixed: data.fixed },
    zones: data.zones,
    runs: data.runs.map((r) => doneRunOf(r, rowsById)),
    feedback: data.feedback,
    pauses: p.pauses as Pause[],
    overrides: p.overrides as WeekOverride[],
    morning: data.morning,
    intensityOk: intensityShare(data.runs.map((r) => ({ date: r.date, minutes: r.minutes, km: r.distanceKm, seiler: r.analysis.seiler })), today)?.ok ?? null,
  };
  const plan = buildPlan(input);
  const stamp = now.toISOString();

  db.transaction((tx) => {
    if (plan.suspend) tx.update(runProfiles).set({ pauses: [...p.pauses, { from: plan.suspend.date, to: null, reason: "douleur" as const }], updatedAt: stamp }).where(eq(runProfiles.personId, personId)).run();
    const seen = new Set<string>();
    for (const s of plan.sessions) {
      const id = sessionIdOf(personId, s.weekStart, s.role);
      seen.add(id);
      const old = rowsById.get(id);
      // Le passé ne bouge pas (ce qui était prévu reste écrit), ni une séance déjà faite.
      if (s.date < today || old?.status === "faite") continue;
      const edited = old?.edit ? applyEdit(s, old.edit as SessionEdit, data!.zones, plan.level) : s;
      const hash = hashOf(edited.date, edited.time, edited.session);
      const values = { weekStart: s.weekStart, role: s.role, date: edited.date, time: edited.time, kind: edited.kind, minutes: edited.minutes, session: edited.session as unknown as Record<string, unknown>, hash };
      if (!old) {
        tx.insert(runSessions).values({ id, personId, ...values, status: s.cancelled ? "annulee" : "prevue" }).run();
        continue;
      }
      const changed = old.hash !== hash;
      const status = s.cancelled ? "annulee" : old.status === "annulee" ? "prevue" : old.status === "programmee" && changed ? "prevue" : old.status;
      if (changed || status !== old.status) tx.update(runSessions).set({ ...values, version: changed ? old.version + 1 : old.version, status, updatedAt: stamp }).where(eq(runSessions.id, id)).run();
    }
    // Séances à venir que le plan ne contient plus (pause, une sortie de moins) : annulées.
    for (const r of data!.rows) if (!seen.has(r.id) && r.date >= today && (r.status === "prevue" || r.status === "programmee")) tx.update(runSessions).set({ status: "annulee", updatedAt: stamp }).where(eq(runSessions.id, r.id)).run();
  });

  // Faites et manquées, d'après les courses rapprochées.
  const rows = db.select().from(runSessions).where(eq(runSessions.personId, personId)).all();
  const matched = matchRuns(data.runs.map((r) => ({ id: r.sampleId, date: r.date, plannedId: r.watchPlannedId })), rows);
  const done = new Map([...matched.entries()].map(([sample, r]) => [r.id, sample]));
  db.transaction((tx) => {
    for (const r of rows) {
      const sample = done.get(r.id);
      if (sample && (r.status !== "faite" || r.sampleId !== sample)) tx.update(runSessions).set({ status: "faite", sampleId: sample, updatedAt: stamp }).where(eq(runSessions.id, r.id)).run();
      else if (!sample && r.date < today && (r.status === "prevue" || r.status === "programmee")) tx.update(runSessions).set({ status: "manquee", updatedAt: stamp }).where(eq(runSessions.id, r.id)).run();
      else if (!sample && r.status === "faite") tx.update(runSessions).set({ status: r.date < today ? "manquee" : "prevue", sampleId: null, updatedAt: stamp }).where(eq(runSessions.id, r.id)).run();
    }
  });

  if (plan.suspend) data = { ...data, profile: getRunProfile(db, personId)! };
  const week = mondayOfDay(today);
  const sessions = db
    .select()
    .from(runSessions)
    .where(and(eq(runSessions.personId, personId), gte(runSessions.date, week)))
    .orderBy(asc(runSessions.date))
    .all()
    .filter((r) => r.date < addDays(week, 14));
  return { data, plan, sessions };
}

// ─── Instantané pour l'assistant ───

export function runContextOf(state: PlanState): RunContext {
  const { data, plan, sessions } = state;
  const today = data.today;
  const live = data.runs.filter((r) => r.date <= today);
  const longest = live.filter((r) => r.date < today && daysBetween(r.date, today) <= LONGEST_WINDOW_DAYS).map((r) => r.analysis.movingMin || r.minutes);
  const heavy = data.fixed.filter((f) => f.kind !== "natation").map((f) => f.weekday);
  const pausedNow = data.profile.pauses.find((x) => x.to == null) ?? plan.paused;
  const f = data.fitness[data.fitness.length - 1];
  const lastRun = live[live.length - 1];
  const fbRecent = data.feedback.filter((x) => (x.pain ?? 0) >= 3 && x.date <= today && daysBetween(x.date, today) <= 7);
  return {
    today,
    personId: data.profile.personId,
    name: data.personName,
    phase: plan.phase,
    level: plan.level,
    weekInPhase: plan.weekInPhase,
    zones: data.zones,
    observed: { max: data.observed.max, rest: data.observed.rest },
    days: data.profile.days.map((d) => d.weekday),
    perWeek: data.profile.perWeek,
    heavyDays: [...new Set(heavy)],
    paused: pausedNow ? { reason: pausedNow.reason } : null,
    signals: [...data.morning.signals.map((s) => s.text), ...(lastRun && (lastRun.feedback?.effort ?? 0) >= 6 && daysBetween(lastRun.date, today) <= 7 ? ["effort trop haut sur la dernière sortie"] : [])],
    painRecent: fbRecent.length > 0,
    longest30: longest.length ? Math.max(...longest) : null,
    ranOn: live.filter((r) => daysBetween(r.date, today) <= 14).map((r) => r.date),
    longOn: live.filter((r) => daysBetween(r.date, today) <= 14 && r.plannedId && sessions.concat(state.data.rows).find((x) => x.id === r.plannedId)?.kind === "sortie_longue").map((r) => r.date),
    sessions: sessions.map((r) => ({ id: r.id, weekStart: r.weekStart, date: r.date, time: r.time, kind: r.kind as SessionKind, minutes: r.minutes, title: (r.session as unknown as RunSession).title, status: r.status, session: r.session as unknown as RunSession })),
    weeks: plan.weeks.slice(-2).map((w) => ({ weekStart: w.weekStart, volume: w.volume, long: w.long, deload: w.deload })),
    messages: plan.messages,
    load: f ? { ctl: f.ctl, atl: f.atl, tsbPct: f.tsbPct } : null,
    lastRuns: live.slice(-5).map((r) => ({
      date: r.date,
      minutes: r.analysis.movingMin || r.minutes,
      km: r.distanceKm,
      effort: r.feedback?.effort ?? r.analysis.effort,
      pain: r.feedback?.pain ?? null,
      zones: r.analysis.hrCoverage > 0 ? `${Math.round((100 * r.analysis.seiler.easy) / Math.max(1, r.analysis.seiler.easy + r.analysis.seiler.moderate + r.analysis.seiler.hard))} % en facile` : null,
      decoupling: r.analysis.decoupling.ok ? r.analysis.decoupling.value : null,
      heat: r.analysis.heat,
    })),
  };
}

/** L'instantané Course de la personne, ou null si le module n'est pas activé. */
export function runContext(db: Db, personId: string, now = new Date()): RunContext | null {
  const s = syncPlan(db, personId, now);
  return s ? runContextOf(s) : null;
}

// ─── La montre ───

export interface WatchPlan {
  id: string;
  version: number;
  date: string;
  time?: string;
  title: string;
  workout: ReturnType<typeof toWorkoutSpec>;
  notes: string;
}

/** Les séances à programmer (du jour J à J+7) et celles à retirer. Sans module activé : rien. */
export function watchPlans(db: Db, personId: string, now = new Date()): { plans: WatchPlan[]; removed: string[] } {
  const today = todayParis(now);
  const state = syncPlan(db, personId, now);
  const rows = db
    .select()
    .from(runSessions)
    .where(and(eq(runSessions.personId, personId), gte(runSessions.date, today)))
    .orderBy(asc(runSessions.date))
    .all()
    .filter((r) => r.date <= addDays(today, WATCH_DAYS));
  const live = state ? rows.filter((r) => r.status === "prevue" || r.status === "programmee") : [];
  return {
    plans: live.map((r) => {
      const s = r.session as unknown as RunSession;
      return { id: r.id, version: r.version, date: r.date, ...(r.time ? { time: r.time } : {}), title: s.title, workout: toWorkoutSpec(s), notes: s.notes };
    }),
    removed: rows.filter((r) => !live.includes(r) && r.status !== "faite").map((r) => r.id),
  };
}

const Ack = z.object({
  scheduled: z.array(z.unknown()).default([]),
  failed: z.array(z.unknown()).default([]),
  removed: z.array(z.unknown()).default([]),
  scheduler: z.object({ supported: z.boolean(), authorized: z.boolean() }).partial().optional(),
});
const AckScheduled = z.object({ id: z.string().max(200), version: z.number().int().min(1), at: z.string().max(40).optional() });
const AckFailed = z.object({ id: z.string().max(200), version: z.number().int().optional(), error: z.string().max(500).default("") });

/** L'accusé de l'app : programmées (statut « programmée » si c'est la version en cours), échecs, retraits. */
export function ackPlans(db: Db, personId: string, body: unknown, now = new Date()): { ok: true; counts: { scheduled: number; failed: number; removed: number } } | { ok: false; error: string } {
  const p = Ack.safeParse(body);
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join(".") || "corps"} : ${i.message}`).join(" ; ") };
  const ids = [...p.data.scheduled, ...p.data.failed].map((x) => (x && typeof x === "object" ? (x as { id?: unknown }).id : null)).concat(p.data.removed).filter((x): x is string => typeof x === "string");
  const rows = new Map((ids.length ? db.select().from(runSessions).where(and(eq(runSessions.personId, personId), inArray(runSessions.id, [...new Set(ids)].slice(0, 500)))).all() : []).map((r) => [r.id, r]));
  const counts = { scheduled: 0, failed: 0, removed: 0 };
  const stamp = now.toISOString();
  db.transaction((tx) => {
    for (const raw of p.data.scheduled) {
      const s = AckScheduled.safeParse(raw);
      const r = s.success ? rows.get(s.data.id) : null;
      if (!s.success || !r) continue;
      const current = s.data.version === r.version;
      tx.update(runSessions)
        .set({ watchVersion: s.data.version, watchAt: s.data.at ?? stamp, watchError: null, ...(current && r.status === "prevue" ? { status: "programmee" as const } : {}), updatedAt: stamp })
        .where(eq(runSessions.id, r.id))
        .run();
      counts.scheduled++;
    }
    for (const raw of p.data.failed) {
      const f = AckFailed.safeParse(raw);
      const r = f.success ? rows.get(f.data.id) : null;
      if (!f.success || !r) continue;
      tx.update(runSessions).set({ watchError: f.data.error.trim().slice(0, 200) || "échec sans message", ...(r.status === "programmee" ? { status: "prevue" as const } : {}), updatedAt: stamp }).where(eq(runSessions.id, r.id)).run();
      counts.failed++;
    }
    for (const id of p.data.removed) {
      const r = typeof id === "string" ? rows.get(id) : null;
      if (!r) continue;
      tx.update(runSessions).set({ watchVersion: null, watchAt: null, ...(r.status === "programmee" ? { status: "prevue" as const } : {}), updatedAt: stamp }).where(eq(runSessions.id, r.id)).run();
      counts.removed++;
    }
    const sch = p.data.scheduler;
    if (sch && typeof sch.supported === "boolean" && typeof sch.authorized === "boolean") tx.update(runProfiles).set({ watch: { supported: sch.supported, authorized: sch.authorized, at: stamp } }).where(eq(runProfiles.personId, personId)).run();
  });
  return { ok: true, counts };
}

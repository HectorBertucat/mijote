// Générateur du plan de reprise (docs/course.md § 4) : pur et déterministe. On rejoue les semaines depuis la
// mise en route — point de départ selon l'arrêt (§ 4.2), marche-course en 8 niveaux pilotée par le ressenti
// (§ 4.3), base puis endurance chiffrées (§ 4.4, 4.5), développement pour le semi (§ 4.6), décharge 1 semaine
// sur 4 (§ 4.9) — sur ce qui a été réellement fait ; puis on place les séances de la semaine en cours (ferme)
// et de la suivante (indicative) dans les jours disponibles, avec la natation et le renforcement (§ 4.11), et
// on applique les règles d'adaptation du jour (§ 4.8). Les volumes se comptent en minutes de course (le pas
// principal, sans les 5 + 5 min d'échauffement et de retour au calme).
import {
  BACKOFF_LONG,
  BACKOFF_VOLUME,
  CAPACITY_CONTINUOUS_MIN,
  CAPACITY_COUNT_WEEKS,
  CAPACITY_MIN_RUNS,
  CAPACITY_WEEKS,
  CUT_SHORT,
  DELOAD_EVERY,
  DELOAD_LONG,
  DELOAD_VOLUME,
  EASY_MAX,
  EASY_MIN,
  EFFORT_HIGH,
  EFFORT_OVER_PLAN,
  HR_HIGH_RUNS,
  HR_HIGH_SHARE,
  HOT_C,
  LONG_CAP,
  LONG_SHARE,
  LONGEST_RATIO,
  LONGEST_WINDOW_DAYS,
  NO_QUALITY_DAYS,
  P0_DOWN_EFFORT,
  P0_PAIN_OK,
  P0_SKIP_EFFORT,
  P0_UP_EFFORT,
  P1_LONG_STEP,
  P1_START_LONG,
  P1_START_PER_RUN,
  P2_DECOUPLING_MAX,
  P2_DONE_SHARE,
  P2_LONG_EFFORT,
  P2_LONG_MIN,
  P2_LONG_STEP,
  P2_MIN_WEEKS,
  P2_PAIN_DAYS,
  P2_QUALITY_FROM_WEEK,
  P3_DECOUPLING_MAX,
  P3_LONG_MIN,
  P3_MIN_WEEKS,
  P3_PAIN_DAYS,
  PAIN_AFTER_DAYS,
  PAIN_LASTS_DAYS,
  PAIN_REPEAT,
  PAIN_REPEAT_DAYS,
  PAIN_STOP,
  PAIN_WATCH,
  PROGRESS_MAX,
  PROGRESS_TARGET,
  SICK_REST_DAYS,
  STOP_BACKOFF_DAYS,
  STOP_CONTINUE_DAYS,
  STOP_PHASE1_DAYS,
  STRIDES_FROM_WEEK,
  AEROBIC_TEST_EVERY,
  WALK_RUN_LEVELS,
  WEEK_CAP_MIN,
} from "./constants";
import { addDays, clamp, daysBetween, median, mondayOfDay, round5 } from "./dates";
import type { Morning } from "./signals";
import { aerobicTest, fartlek, footing, frielTest, hills, longRun, PLANNED_EFFORT, QUALITY, sessionMinutes, shorten, tempo, walkRun, type RunSession, type SessionKind } from "./workout";
import type { Zones } from "./zones";

export type Phase = 0 | 1 | 2 | 3;
export const PHASE_LABEL: Record<Phase, string> = { 0: "Marche-course", 1: "Base continue", 2: "Endurance", 3: "Développement" };

export const GOALS = ["reprendre", "plus_longtemps", "sortie_longue", "semi"] as const;
export type RunGoal = (typeof GOALS)[number];
export const GOAL_LABEL: Record<RunGoal, string> = { reprendre: "Reprendre", plus_longtemps: "Courir plus longtemps", sortie_longue: "Une vraie sortie longue", semi: "Un semi-marathon un jour" };
/** Phase la plus haute et sortie longue la plus longue (minutes de course) selon l'objectif (choix de Mijote, § 4.5). */
export const GOAL_LIMIT: Record<RunGoal, { phase: Phase; long: number }> = {
  reprendre: { phase: 1, long: LONG_CAP.p1 },
  plus_longtemps: { phase: 2, long: LONG_CAP.p2 },
  sortie_longue: { phase: 2, long: LONG_CAP.p2Long },
  semi: { phase: 3, long: 120 },
};

export type FixedKind = "natation" | "kettlebell" | "renfo";
/** Les activités qui chargent les jambes : pas la veille d'une sortie longue ou d'une séance de qualité. */
const HEAVY = new Set<FixedKind>(["kettlebell", "renfo"]);

export interface Availability {
  weekday: number;
  /** HH:MM, sinon l'heure préférée. */
  time?: string | null;
}

export interface PlanSettings {
  days: Availability[];
  perWeek: number;
  goal: RunGoal;
  longRunDay?: number | null;
  /** Heure par défaut des séances (HH:MM). */
  time?: string | null;
  fixed: { weekday: number; kind: FixedKind }[];
}

/** Une course faite, résumée (store.ts la tire de l'analyse et du ressenti). */
export interface DoneRun {
  date: string;
  /** Temps en mouvement, minutes. */
  minutes: number;
  km: number | null;
  continuousMin: number;
  effort: number | null;
  pain: number | null;
  completed: boolean | null;
  hrHighShare: number | null;
  decoupling: number | null;
  heat: boolean;
  /** La séance prévue à laquelle elle a été rapprochée. */
  planned?: { kind: SessionKind; minutes: number; level?: number | null } | null;
}

export interface Feedback {
  date: string;
  effort?: number | null;
  pain?: number | null;
  where?: string | null;
  sick?: boolean;
}

export interface Pause {
  from: string;
  to: string | null;
  reason: "douleur" | "malade" | "personne";
}

export interface WeekOverride {
  weekStart: string;
  /** Volume visé (minutes de course), vérifié par checkRunningAction. */
  volume?: number | null;
  deload?: boolean;
}

export interface PlanInput {
  today: string;
  /** Jour de la mise en route du module. */
  startedOn: string;
  settings: PlanSettings;
  zones: Zones;
  runs: DoneRun[];
  feedback: Feedback[];
  pauses: Pause[];
  overrides: WeekOverride[];
  morning: Morning | null;
  /** Répartition des 4 dernières semaines conforme (≥ 80 % facile) ; null si inconnue. */
  intensityOk: boolean | null;
}

export interface PlannedSession {
  weekStart: string;
  date: string;
  time: string | null;
  /** Rôle stable dans la semaine (long, q1, e1…) : l'id de la séance en base en dépend. */
  role: string;
  session: RunSession;
  kind: SessionKind;
  /** Durée totale (min). */
  minutes: number;
  /** Semaine en cours (ferme) ou suivante (indicative). */
  firm: boolean;
  /** Annulée par l'adaptation du jour (gardée pour dire pourquoi, retirée de la montre). */
  cancelled?: boolean;
}

export interface WeekSummary {
  weekStart: string;
  phase: Phase;
  weekInPhase: number;
  level: number | null;
  runs: number;
  volume: number;
  long: number;
  deload: boolean;
  paused: boolean;
  notes: string[];
}

export interface PlanOutput {
  phase: Phase;
  level: number | null;
  weekInPhase: number;
  /** Semaine en cours et suivante, séances placées (passées comprises). */
  sessions: PlannedSession[];
  weeks: WeekSummary[];
  /** Pause en cours (douleur, maladie, à la demande). */
  paused: Pause | null;
  /** Nouvelle suspension pour douleur, à enregistrer. */
  suspend: { date: string; reason: "douleur" } | null;
  messages: string[];
  /** Critères de passage à la phase suivante (null si dernière phase de l'objectif). */
  next: { phase: Phase; criteria: { label: string; ok: boolean }[] } | null;
}

// ─── § 4.2 Point de départ ───

export interface Start {
  phase: Phase;
  level: number;
  /** Reculer (8 à 28 jours d'arrêt) : volume × 0,75, sortie longue × 0,80, pas de qualité. */
  backoff: boolean;
  stopDays: number | null;
  reason: string;
}

/** Le plus haut niveau de marche-course dont le bloc de course tient dans la capacité (min continues). */
export function levelForCapacity(minutes: number): number {
  let level = 1;
  for (const L of WALK_RUN_LEVELS) if (L.run / 60 <= minutes) level = L.level;
  return level;
}

/** Arrêt et capacité au jour `date` : jours depuis la dernière course, plus longue course continue des 8 semaines d'avant l'arrêt, sorties des 12 semaines. */
export function capacityAt(runs: DoneRun[], date: string) {
  const before = runs.filter((r) => r.date < date).sort((a, b) => a.date.localeCompare(b.date));
  const last = before[before.length - 1];
  if (!last) return { stopDays: null, capacity: 0, count: 0 };
  const stopDays = daysBetween(last.date, date);
  const capacity = Math.max(0, ...before.filter((r) => daysBetween(r.date, last.date) < 7 * CAPACITY_WEEKS).map((r) => r.continuousMin));
  const count = before.filter((r) => daysBetween(r.date, last.date) < 7 * CAPACITY_COUNT_WEEKS).length;
  return { stopDays, capacity, count };
}

export function startPoint(runs: DoneRun[], date: string): Start {
  const { stopDays, capacity, count } = capacityAt(runs, date);
  const cont = capacity >= CAPACITY_CONTINUOUS_MIN;
  if (stopDays == null) return { phase: 0, level: 1, backoff: false, stopDays, reason: "jamais couru : marche-course, niveau 1" };
  if (stopDays <= STOP_CONTINUE_DAYS)
    return cont ? { phase: 1, level: 8, backoff: false, stopDays, reason: "courses récentes : base continue" } : { phase: 0, level: levelForCapacity(capacity), backoff: false, stopDays, reason: "courses récentes, pas encore 30 min continues : marche-course" };
  if (stopDays <= STOP_BACKOFF_DAYS)
    return cont ? { phase: 1, level: 8, backoff: true, stopDays, reason: `${stopDays} jours d’arrêt : on recule un peu` } : { phase: 0, level: Math.max(1, levelForCapacity(capacity) - 1), backoff: false, stopDays, reason: `${stopDays} jours d’arrêt : un niveau plus bas` };
  if (stopDays <= STOP_PHASE1_DAYS)
    return cont ? { phase: 1, level: 8, backoff: false, stopDays, reason: `${stopDays} jours d’arrêt : base continue, semaine 1` } : { phase: 0, level: 5, backoff: false, stopDays, reason: `${stopDays} jours d’arrêt : marche-course, niveau 5` };
  const lvl = cont && count >= CAPACITY_MIN_RUNS ? 4 : 1;
  return { phase: 0, level: lvl, backoff: false, stopDays, reason: `${stopDays} jours d’arrêt : marche-course, niveau ${lvl}` };
}

// ─── § 4.3 Phase 0 : le niveau ───

/** Effort d'une course : noté, sinon la FC (plus de 30 % au-dessus de Z2 → 5), sinon 4. */
export const effortOf = (r: DoneRun) => r.effort ?? (r.hrHighShare != null && r.hrHighShare > HR_HIGH_SHARE ? 5 : 4);
/** Faite en entier : dit par la personne, sinon au moins 90 % de la durée prévue. */
export const completedOf = (r: DoneRun) => r.completed ?? (r.planned ? r.minutes >= 0.9 * r.planned.minutes : true);

export interface LevelResult {
  level: number;
  graduated: boolean;
  /** Date de la deuxième séance réussie au niveau 8. */
  graduatedOn: string | null;
  /** Une séance de niveau 8 déjà faite (la suivante passe à 30 min). */
  level8Done: boolean;
}

/** Le niveau après une suite de séances (§ 4.3). `perWeek` 2 : il faut 3 séances réussies pour monter. */
export function phase0Level(start: number, results: DoneRun[], perWeek: number, benchmark: boolean): LevelResult {
  const need = perWeek <= 2 ? 3 : 2;
  let level = start;
  let ok = 0;
  let low = 0;
  let high = 0;
  let skippedWeek: string | null = null;
  let level8Done = false;
  let first = benchmark;
  for (const r of [...results].sort((a, b) => a.date.localeCompare(b.date))) {
    const effort = effortOf(r);
    const pain = r.pain ?? 0;
    const done = completedOf(r);
    if (level === 8 && done) level8Done = true;
    high = r.hrHighShare != null && r.hrHighShare > HR_HIGH_SHARE ? high + 1 : 0;
    const wasFirst = first;
    first = false;
    if (pain >= PAIN_WATCH || effort >= P0_DOWN_EFFORT || !done || high >= HR_HIGH_RUNS) {
      level = Math.max(1, level - 1);
      ok = low = high = 0;
      continue;
    }
    if (effort > P0_UP_EFFORT || pain > P0_PAIN_OK) continue; // rester
    if (wasFirst && effort <= P0_SKIP_EFFORT && level < 8) {
      level = Math.min(8, level + 2); // la séance repère fait sauter jusqu'à 2 niveaux
      ok = low = 0;
      continue;
    }
    ok++;
    if (effort <= P0_SKIP_EFFORT) low++;
    if (ok >= need) {
      if (level === 8) return { level, graduated: true, graduatedOn: r.date, level8Done };
      const week = mondayOfDay(r.date);
      const skip = low >= need && skippedWeek !== week;
      if (skip) skippedWeek = week;
      level = Math.min(8, level + (skip ? 2 : 1));
      ok = low = 0;
    }
  }
  return { level, graduated: false, graduatedOn: null, level8Done };
}

// ─── § 4.8 Douleur ───

/** Le jour où la course doit être suspendue (douleur ≥ 5, ≥ 3 au même endroit 3 fois en 14 jours, ou qui dure plus de 7 jours). */
export function painStop(feedback: Feedback[], since: string, until: string): string | null {
  const xs = feedback.filter((f) => f.date >= since && f.date <= until && f.pain != null).sort((a, b) => a.date.localeCompare(b.date));
  for (const f of xs) {
    if (f.pain! >= PAIN_STOP) return f.date;
    if (f.pain! >= PAIN_WATCH) {
      const same = xs.filter((g) => g.pain! >= PAIN_WATCH && g.date <= f.date && daysBetween(g.date, f.date) < PAIN_REPEAT_DAYS && (g.where ?? "") === (f.where ?? ""));
      if (same.length >= PAIN_REPEAT) return f.date;
      // Qui dure : une douleur ≥ 3 au même endroit il y a plus de 7 jours, sans retour sous 3 depuis.
      const back = xs.filter((g) => g.date < f.date && (g.where ?? "") === (f.where ?? ""));
      const firstHigh = [...back].reverse().find((g, i, arr) => g.pain! >= PAIN_WATCH && arr.slice(0, i).every((h) => h.pain! >= PAIN_WATCH));
      if (firstHigh && back.filter((g) => g.date > firstHigh.date).every((g) => g.pain! >= PAIN_WATCH) && daysBetween(firstHigh.date, f.date) > PAIN_LASTS_DAYS) return f.date;
    }
  }
  return null;
}

// ─── Les semaines ───

const runsIn = (runs: DoneRun[], from: string, to: string) => runs.filter((r) => r.date >= from && r.date < to);
/** Minutes de course d'une sortie : temps en mouvement moins l'échauffement et le retour au calme (approché). */
export const runMinutesOf = (r: DoneRun) => Math.max(0, r.minutes - 10);

interface State {
  phase: Phase;
  phaseSince: string;
  weekInPhase: number;
  level: number;
  levelSince: string;
  benchmark: boolean;
  /** Semaines depuis la dernière décharge (la 4e est une décharge). */
  cycle: number;
  /** Dernière semaine hors décharge (volume, sortie longue prévus). */
  refV: number | null;
  refL: number | null;
  /** Dernière semaine prévue. */
  prevV: number | null;
  prevL: number | null;
  prevN: number;
  backoff: boolean;
  cut: boolean;
  repeat: boolean;
  noProgress: boolean;
  deloadNext: boolean;
}

function fresh(s: Start, week: string, date: string): State {
  return { phase: s.phase, phaseSince: week, weekInPhase: 1, level: s.level, levelSince: date, benchmark: s.phase === 0, cycle: 1, refV: null, refL: null, prevV: null, prevL: null, prevN: 0, backoff: s.backoff, cut: false, repeat: false, noProgress: false, deloadNext: false };
}

/** Nombre de sorties de la semaine (§ 4.7), au plus les jours disponibles et le réglage. */
export function runsPerWeek(phase: Phase, perWeek: number, days: number): number {
  const cap = phase <= 1 ? 3 : 4;
  return Math.max(1, Math.min(perWeek, days, cap));
}

/** La plus longue course des 30 jours avant `date`, en minutes et en km. */
function longest30(runs: DoneRun[], date: string) {
  const xs = runs.filter((r) => r.date < date && daysBetween(r.date, date) <= LONGEST_WINDOW_DAYS);
  if (!xs.length) return null;
  const kms = xs.map((r) => r.km).filter((k): k is number => k != null);
  return { minutes: Math.max(...xs.map((r) => r.minutes)), km: kms.length ? Math.max(...kms) : null };
}

/** Vitesse médiane (km/min) des sorties des 4 dernières semaines. */
function easySpeed(runs: DoneRun[], date: string): number | null {
  const xs = runs.filter((r) => r.date < date && daysBetween(r.date, date) <= 28 && r.km && r.minutes > 0).map((r) => r.km! / r.minutes);
  return median(xs);
}

/** Plafond de durée totale (min) d'une sortie selon la règle des 30 jours : × 1,10 pour la sortie record, × 1 pour les autres. */
function cap30(runs: DoneRun[], date: string, record: boolean): number | null {
  const L = longest30(runs, date);
  if (!L) return null;
  const k = record ? LONGEST_RATIO : 1;
  let cap = L.minutes * k;
  const v = easySpeed(runs, date);
  if (L.km != null && v) cap = Math.min(cap, (L.km * k) / v);
  return Math.floor(cap);
}

interface Targets {
  weekStart: string;
  phase: Phase;
  weekInPhase: number;
  level: number | null;
  n: number;
  volume: number;
  long: number;
  easy: number[];
  quality: SessionKind[];
  test: "aerobie" | "friel" | null;
  strides: boolean;
  deload: boolean;
  paused: boolean;
  notes: string[];
}

const pausedOn = (pauses: Pause[], date: string) => pauses.find((p) => p.from <= date && (p.to == null || p.to > date)) ?? null;

/** Le volume (minutes de course) et la sortie longue d'une semaine de phase 1 à 3. */
function weekTargets(st: State, w: string, x: PlanInput, runs: DoneRun[], n0: number, deloads: Set<string>): Targets {
  const limit = GOAL_LIMIT[x.settings.goal];
  const notes: string[] = [];
  const override = x.overrides.find((o) => o.weekStart === w);
  // Une décharge demandée (page, action confirmée) s'applique dès qu'il y a une semaine de référence.
  const deload = ((st.cycle === DELOAD_EVERY || st.deloadNext) && st.weekInPhase > 1) || (!!override?.deload && st.refV != null);
  let n = n0;
  const share = LONG_SHARE[n] ?? 0.35;
  let V: number;
  let L: number;
  if (st.refV == null || st.refL == null) {
    // Semaine 1 de la base continue.
    V = n * P1_START_PER_RUN;
    L = Math.min(P1_START_LONG, share * V);
    if (st.backoff) {
      V *= BACKOFF_VOLUME;
      L *= BACKOFF_LONG;
    }
  } else if (st.backoff) {
    // Reprise après 8 à 28 jours : on recule depuis la dernière semaine prévue.
    V = st.refV * BACKOFF_VOLUME;
    L = st.refL * BACKOFF_LONG;
  } else if (deload) {
    V = (st.prevV ?? st.refV) * DELOAD_VOLUME;
    L = (st.prevL ?? st.refL) * DELOAD_LONG;
    notes.push("Semaine de décharge : volume × 0,70, sortie longue × 0,80, pas de qualité.");
  } else {
    // Volume visé : + 10 % sur la moyenne des 2 dernières semaines réalisées (décharges exclues), + 20 % au plus.
    // Seules comptent les semaines de la phase en cours (choix de Mijote : avant, c'était un autre régime).
    // Une première semaine commencée en cours de route ne compte pas : elle sous-estimerait le réalisé.
    const partial = (ws: string) => ws === mondayOfDay(x.startedOn) && x.startedOn > ws;
    const done = [1, 2, 3, 4]
      .map((k) => addDays(w, -7 * k))
      .filter((ws) => !deloads.has(ws) && ws >= st.phaseSince && !partial(ws))
      .slice(0, 2)
      .map((ws) => runsIn(runs, ws, addDays(ws, 7)).reduce((s, r) => s + runMinutesOf(r), 0));
    const vref = done.length ? done.reduce((s, v) => s + v, 0) / done.length : st.refV;
    const after = st.prevV != null && st.refV != null && st.prevV < st.refV; // la semaine d'après une décharge
    if (after) V = st.refV;
    else if (st.repeat) {
      V = st.prevV ?? st.refV;
      notes.push("La semaine dernière a été trop courte : on refait la même.");
    } else V = clamp(round5(vref * PROGRESS_TARGET), vref, vref * PROGRESS_MAX);
    if (st.noProgress) {
      V = Math.min(V, st.prevV ?? V);
      notes.push("Semaine sans progression (FC trop haute pour l’effort).");
    }
    if (x.morning?.signals.some((s) => s.kind === "hrv_basse" || s.kind === "fc_repos_haute") && w === mondayOfDay(x.today)) V = Math.min(V, st.prevV ?? V);
    // Sortie longue : + 5 min par semaine (phase 1), + 10 min toutes les 2 semaines (phase 2–3) ; une sortie : + 5 toutes les 2.
    // La sortie longue repart de la plus longue réellement courue la semaine d'avant (comme le volume), sinon de la prévue.
    const lastWeek = addDays(w, -7);
    const ranLong = lastWeek >= st.phaseSince && !partial(lastWeek) && !deloads.has(lastWeek) ? Math.max(0, ...runsIn(runs, lastWeek, w).map(runMinutesOf)) : 0;
    const prevL = after ? st.refL : ranLong > 0 ? ranLong : (st.prevL ?? st.refL);
    const step = n === 1 ? (st.weekInPhase % 2 ? P1_LONG_STEP : 0) : st.phase === 1 ? P1_LONG_STEP : st.weekInPhase % 2 ? P2_LONG_STEP : 0;
    L = Math.min(st.repeat ? prevL : prevL + step, share * V);
  }
  if (override?.volume != null && !deload) V = override.volume;
  if (st.backoff) notes.push("Reprise après une pause : volume × 0,75, sortie longue × 0,80, pas de qualité cette semaine.");
  if (st.cut) {
    V *= CUT_SHORT;
    notes.push("Douleur la semaine dernière : volume − 30 %, sans qualité.");
  }
  V = Math.min(V, WEEK_CAP_MIN);
  const longCap = st.phase === 1 ? LONG_CAP.p1 : st.phase === 2 ? Math.min(limit.long, LONG_CAP.p2Long) : limit.long;
  L = Math.min(L, longCap, n === 1 ? V : L);
  // Règle des 30 jours : la sortie longue au plus × 1,10 de la plus longue (durée totale, échauffement compris).
  const c = cap30(runs, w, true);
  if (c != null) L = Math.min(L, Math.max(10, c - 10));
  L = Math.max(10, Math.round(L));
  // Footings : (V − L) / (n − 1), entre 20 et 50 min ; en dessous de 20, une sortie de moins.
  let easy: number[] = [];
  while (n > 1) {
    const e = (V - L) / (n - 1);
    if (e >= EASY_MIN || n === 2) {
      const each = clamp(round5(e), EASY_MIN, EASY_MAX);
      easy = Array.from({ length: n - 1 }, () => each);
      break;
    }
    n--;
    notes.push("Volume trop petit pour toutes les sorties : une de moins cette semaine.");
  }
  const capEasy = cap30(runs, w, false);
  if (capEasy != null) easy = easy.map((e) => Math.max(10, Math.min(e, capEasy - 10)));
  if (n === 1 && x.settings.days.length === 1) notes.push("Une sortie par semaine : c’est de l’entretien, on progresse peu.");

  // Qualité, tests, lignes droites.
  const quality: SessionKind[] = [];
  let test: Targets["test"] = null;
  const noQuality = deload || st.backoff || st.cut || x.intensityOk === false;
  if (!noQuality && st.phase === 2 && st.weekInPhase >= P2_QUALITY_FROM_WEEK && easy.length) quality.push((st.weekInPhase - P2_QUALITY_FROM_WEEK) % 2 === 0 ? "fartlek" : "cotes");
  if (!noQuality && st.phase === 3 && easy.length) {
    quality.push("tempo");
    if (n >= 3 && easy.length >= 2) quality.push(st.weekInPhase % 2 ? "cotes" : "fartlek");
  }
  if (x.intensityOk === false && st.phase >= 2) notes.push("Moins de 80 % du temps en facile sur 4 semaines : pas de qualité cette semaine.");
  if (!deload && st.phase === 2 && (st.weekInPhase - 2) % AEROBIC_TEST_EVERY === 0 && easy.length > quality.length) test = "aerobie";
  if (!deload && st.phase === 3 && (st.weekInPhase === 2 || (st.weekInPhase - 2) % 13 === 0) && x.zones.thresholdSource !== "saisie" && quality.length) {
    test = "friel";
    quality.pop();
  }
  const strides = st.phase >= 1 && (st.phase > 1 || st.weekInPhase >= STRIDES_FROM_WEEK) && easy.length > quality.length + (test ? 1 : 0);
  const volume = L + easy.reduce((s, e) => s + e, 0);
  return { weekStart: w, phase: st.phase, weekInPhase: st.weekInPhase, level: null, n, volume, long: L, easy, quality, test, strides, deload, paused: false, notes };
}

/** Critères de passage (§ 4.4, 4.5) au lundi `w`, sur les faits d'avant. */
function criteria(st: State, w: string, x: PlanInput, runs: DoneRun[], planned: Map<string, number>): { phase: Phase; criteria: { label: string; ok: boolean }[] } | null {
  const limit = GOAL_LIMIT[x.settings.goal];
  if (st.phase === 0 || st.phase >= limit.phase) return null;
  const pains = (days: number) => !x.feedback.some((f) => (f.pain ?? 0) >= PAIN_WATCH && f.date < w && daysBetween(f.date, w) <= days);
  const weekRuns = (k: number) => runsIn(runs, addDays(w, -7 * k), addDays(w, -7 * (k - 1)));
  if (st.phase === 1) {
    const last3 = [1, 2, 3].map((k) => ({ runs: weekRuns(k).length, planned: planned.get(addDays(w, -7 * k)) ?? 0 }));
    const longs = runs.filter((r) => r.date < w && daysBetween(r.date, w) <= 28 && runMinutesOf(r) >= P2_LONG_MIN && effortOf(r) <= P2_LONG_EFFORT && !r.heat);
    const lastLong = runs.filter((r) => r.date < w && r.planned?.kind === "sortie_longue" && !r.heat).sort((a, b) => b.date.localeCompare(a.date))[0];
    return {
      phase: 2,
      criteria: [
        { label: `${P2_MIN_WEEKS} semaines de base continue`, ok: st.weekInPhase >= P2_MIN_WEEKS },
        { label: "3 dernières semaines : 2 sorties au moins, 80 % des séances faites", ok: last3.every((s) => s.runs >= 2 && s.runs >= P2_DONE_SHARE * s.planned) },
        { label: `Une sortie longue de ${P2_LONG_MIN} min ou plus, facile`, ok: longs.length > 0 },
        { label: "Aucune douleur depuis 14 jours", ok: pains(P2_PAIN_DAYS) },
        { label: "Découplage de la dernière sortie longue sous 8 %", ok: lastLong?.decoupling == null || lastLong.decoupling < P2_DECOUPLING_MAX },
      ],
    };
  }
  const longs = runs.filter((r) => r.date < w && runMinutesOf(r) >= P3_LONG_MIN && r.decoupling != null && r.decoupling < P3_DECOUPLING_MAX && !r.heat);
  const six = [1, 2, 3, 4, 5, 6].map((k) => weekRuns(k).length);
  return {
    phase: 3,
    criteria: [
      { label: `${P3_MIN_WEEKS} semaines d’endurance`, ok: st.weekInPhase >= P3_MIN_WEEKS },
      { label: `Deux sorties de ${P3_LONG_MIN} min ou plus, découplage sous 5 %`, ok: longs.length >= 2 },
      { label: "3 sorties par semaine sur 6 semaines", ok: six.every((c) => c >= 3) },
      { label: "Aucune douleur depuis 21 jours", ok: pains(P3_PAIN_DAYS) },
    ],
  };
}

// ─── § 4.11 Placement ───

export interface Role {
  role: string;
  kind: SessionKind;
  minutes: number;
}

export interface Placement {
  days: Map<string, number>;
  notes: string[];
}

/**
 * Place les séances dans les jours disponibles (0 = lundi) : toutes les combinaisons sont essayées (au plus
 * quelques centaines), la moins pénalisée gagne ; à égalité, les jours les plus tôt. `prevRun` : dernier jour
 * de course de la semaine d'avant, relatif à ce lundi (−1 = dimanche).
 */
export function placeWeek(roles: Role[], available: number[], fixed: PlanSettings["fixed"], phase: Phase, longDay: number | null, prevRun: number | null): Placement {
  const notes: string[] = [];
  let rs = [...roles];
  const days = [...new Set(available)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  const heavyOn = (d: number) => fixed.some((f) => f.weekday === d && HEAVY.has(f.kind));
  const fixedOn = (d: number) => fixed.some((f) => f.weekday === d && f.kind !== "natation");
  const preferred = longDay != null && days.includes(longDay) ? longDay : days.includes(6) ? 6 : days.includes(5) ? 5 : days[days.length - 1];
  const hard = (k: SessionKind) => QUALITY.has(k) || k === "sortie_longue";

  const score = (assign: number[]): number => {
    let p = 0;
    const order = assign.map((d, i) => ({ d, r: rs[i] })).sort((a, b) => a.d - b.d);
    const runDays = order.map((o) => o.d);
    const all = prevRun != null ? [{ d: prevRun, r: null as Role | null }, ...order] : order;
    for (let i = 1; i < all.length; i++) {
      if (all[i].d - all[i - 1].d === 1) {
        const a = all[i - 1].r;
        const b = all[i].r;
        const shortEasy = (r: Role | null) => !!r && r.kind === "footing" && r.minutes <= 40;
        p += phase <= 1 ? 100 : shortEasy(a) || shortEasy(b) ? 5 : 100;
      }
    }
    for (const { d, r } of order) {
      if (QUALITY.has(r.kind)) {
        for (const o of order) if (o.r !== r && (o.r.kind === "sortie_longue" || QUALITY.has(o.r.kind)) && Math.abs(o.d - d) < 2) p += 1000;
      }
      if (hard(r.kind) && heavyOn(d - 1)) p += 60;
      if (hard(r.kind) && heavyOn(d)) p += 200;
      else if (heavyOn(d)) p += 15;
      if (r.kind === "sortie_longue" && d !== preferred) p += 30;
    }
    const busy = new Set([...runDays, ...[0, 1, 2, 3, 4, 5, 6].filter(fixedOn)]);
    if (busy.size >= 7) p += 300;
    // Écart entre deux courses : le plus grand possible.
    const gaps = runDays.slice(1).map((d, i) => d - runDays[i]);
    if (prevRun != null && runDays.length) gaps.push(runDays[0] - prevRun);
    p -= (gaps.length ? Math.min(...gaps) : 0) * 3;
    return p;
  };

  const best = (): { assign: number[]; p: number } | null => {
    let top: { assign: number[]; p: number } | null = null;
    const pick = (i: number, used: number[]) => {
      if (i === rs.length) {
        const p = score(used);
        const key = [...used].sort((a, b) => a - b);
        const topKey = top ? [...top.assign].sort((a, b) => a - b) : null;
        if (!top || p < top.p || (p === top.p && key.join() < topKey!.join())) top = { assign: [...used], p };
        return;
      }
      for (const d of days) if (!used.includes(d)) pick(i + 1, [...used, d]);
    };
    pick(0, []);
    return top;
  };

  for (let guard = 0; guard < 6; guard++) {
    if (rs.length > days.length) {
      const k = rs.findLastIndex((r) => r.kind === "footing" || r.kind === "footing_lignes");
      rs.splice(k >= 0 ? k : rs.length - 1, 1);
      notes.push("Pas assez de jours disponibles : une sortie de moins.");
      continue;
    }
    const b = best();
    if (!b) break;
    if (b.p >= 1000) {
      const q = rs.findIndex((r) => QUALITY.has(r.kind));
      if (q >= 0) {
        rs = rs.map((r, i) => (i === q ? { ...r, kind: "footing" as const } : r));
        notes.push("La séance de qualité ne trouve pas sa place à 48 h de la sortie longue : footing à la place.");
        continue;
      }
    }
    const busy = new Set([...b.assign, ...[0, 1, 2, 3, 4, 5, 6].filter(fixedOn)]);
    if (busy.size >= 7 && rs.length > 2) {
      const k = rs.findLastIndex((r) => r.kind === "footing" || r.kind === "footing_lignes");
      if (k >= 0) {
        rs.splice(k, 1);
        notes.push("Pour garder un jour sans rien dans la semaine, un footing en moins.");
        continue;
      }
    }
    const out = new Map(rs.map((r, i) => [r.role, b.assign[i]]));
    for (const r of rs) {
      const d = out.get(r.role)!;
      if (heavyOn(d)) notes.push(`${r.kind === "marche_course" ? "Marche-course" : "Footing"} le même jour qu’une séance de renforcement : la course d’abord, au moins 3 h d’écart.`);
    }
    return { days: out, notes };
  }
  return { days: new Map(), notes };
}

// ─── Le plan ───

/** Les séances d'une semaine : rôles, puis placement, puis séances écrites. */
function sessionsFor(t: Targets, x: PlanInput, prevRun: number | null, level: LevelResult | null, firm: boolean): { sessions: PlannedSession[]; notes: string[] } {
  const roles: Role[] = [];
  if (t.phase === 0) {
    for (let i = 0; i < t.n; i++) roles.push({ role: `wr${i + 1}`, kind: "marche_course", minutes: 35 });
  } else {
    roles.push({ role: "long", kind: "sortie_longue", minutes: t.long + 10 });
    const q = [...t.quality];
    t.easy.forEach((e, i) => {
      const kind = q.shift();
      if (kind) roles.push({ role: `q${i + 1}`, kind, minutes: e + 10 });
      else roles.push({ role: `e${i + 1}`, kind: "footing", minutes: e + 10 });
    });
  }
  const fixed = x.settings.fixed;
  const placed = placeWeek(roles, x.settings.days.map((d) => d.weekday), fixed, t.phase, x.settings.longRunDay ?? null, prevRun);
  const timeOf = (wd: number) => x.settings.days.find((d) => d.weekday === wd)?.time ?? x.settings.time ?? null;
  const out: PlannedSession[] = [];
  let testDone = false;
  let stridesDone = false;
  // Rôles dans l'ordre des jours : le test et les lignes droites vont au premier footing qui reste.
  const ordered = roles.filter((r) => placed.days.has(r.role)).sort((a, b) => placed.days.get(a.role)! - placed.days.get(b.role)!);
  for (const r of ordered) {
    const wd = placed.days.get(r.role)!;
    // Première semaine commencée en cours de route : rien avant le jour de mise en route (pas de « manquée » fictive).
    if (addDays(t.weekStart, wd) < x.startedOn) continue;
    let s: RunSession;
    if (r.kind === "marche_course") s = walkRun(level?.level ?? t.level ?? 1, x.zones, !!level?.level8Done);
    else if (r.kind === "sortie_longue") s = longRun(r.minutes, x.zones);
    else if (r.kind === "fartlek") s = fartlek(6, x.zones);
    else if (r.kind === "cotes") s = hills(6);
    else if (r.kind === "tempo") s = tempo(r.minutes >= 50 ? 3 : 2, x.zones);
    else if (t.test === "aerobie" && !testDone) {
      s = aerobicTest(x.zones);
      testDone = true;
    } else if (t.test === "friel" && !testDone) {
      s = frielTest();
      testDone = true;
    } else if (t.strides && !stridesDone && r.minutes >= 25) {
      s = footing(r.minutes, x.zones, 4);
      stridesDone = true;
    } else s = footing(r.minutes, x.zones);
    out.push({ weekStart: t.weekStart, date: addDays(t.weekStart, wd), time: timeOf(wd), role: r.role, session: s, kind: s.kind, minutes: sessionMinutes(s), firm });
  }
  return { sessions: out, notes: placed.notes };
}

/** Une course projetée (séance prévue supposée faite comme prévu) pour calculer la semaine suivante. */
const projected = (p: PlannedSession): DoneRun => ({
  date: p.date,
  minutes: p.minutes,
  km: null,
  continuousMin: p.kind === "marche_course" ? 0 : p.minutes - 10,
  effort: PLANNED_EFFORT[p.kind],
  pain: 0,
  completed: true,
  hrHighShare: null,
  decoupling: null,
  heat: false,
  planned: { kind: p.kind, minutes: p.minutes, level: p.session.level ?? null },
});

/** Le plan : rejoue les semaines depuis la mise en route, puis écrit la semaine en cours et la suivante. */
export function buildPlan(x: PlanInput): PlanOutput {
  const today = x.today;
  const thisWeek = mondayOfDay(today);
  const startWeek = mondayOfDay(x.startedOn);
  const runs = [...x.runs].sort((a, b) => a.date.localeCompare(b.date));
  const messages: string[] = [];
  const weeks: WeekSummary[] = [];
  const planned = new Map<string, number>();
  const deloads = new Set<string>();

  // Suspension pour douleur après la dernière reprise.
  const lastResume = x.pauses.filter((p) => p.to).map((p) => p.to!).sort().pop() ?? x.startedOn;
  const stopOn = painStop(x.feedback, lastResume > x.startedOn ? lastResume : x.startedOn, today);
  const open = pausedOn(x.pauses, addDays(today, 1)) ?? pausedOn(x.pauses, today);
  const suspend = stopOn && !open ? { date: stopOn, reason: "douleur" as const } : null;
  const paused: Pause | null = open ?? (suspend ? { from: suspend.date, to: null, reason: "douleur" } : null);
  const pauses = paused && !open ? [...x.pauses, paused] : x.pauses;

  let st = fresh(startPoint(runs, x.startedOn), startWeek, x.startedOn);
  const perWeek = clamp(Math.round(x.settings.perWeek), 1, 5);
  const nDays = x.settings.days.length;
  let levelNow: LevelResult | null = null;

  const evolve = (w: string, facts: DoneRun[]) => {
    // Une pause qui finit cette semaine-là : départ recalculé (§ 4.2) au jour de la reprise.
    const resumed = pauses.find((p) => p.to && p.to > addDays(w, -7) && p.to <= w);
    if (resumed) {
      st = fresh(startPoint(facts, resumed.to!), w, resumed.to!);
      return;
    }
    const prevWeek = addDays(w, -7);
    const lastRun = facts.filter((r) => r.date < w).pop();
    const stop = lastRun ? daysBetween(lastRun.date, w) : null;
    // Arrêt de 8 jours et plus alors que le plan existait déjà : règles de départ.
    if (stop != null && stop > STOP_CONTINUE_DAYS && daysBetween(x.startedOn, w) > STOP_CONTINUE_DAYS + 7 && !pausedOn(pauses, prevWeek)) {
      const s = startPoint(facts, w);
      if (stop <= STOP_BACKOFF_DAYS && st.phase >= 1) {
        st = { ...st, backoff: true, weekInPhase: st.weekInPhase + 1, cut: false, repeat: false };
        return;
      }
      if (stop <= STOP_BACKOFF_DAYS && st.phase === 0) {
        const lv = phase0Level(st.level, facts.filter((r) => r.date >= st.levelSince && r.date < w), perWeek, st.benchmark);
        st = { ...st, level: Math.max(1, lv.level - 1), levelSince: w, benchmark: false, weekInPhase: st.weekInPhase + 1 };
        return;
      }
      st = fresh(s, w, w);
      return;
    }
    const wasBackoff = st.backoff;
    st.backoff = false;
    const lastFacts = runsIn(facts, prevWeek, w);
    const pain = x.feedback.filter((f) => f.date >= prevWeek && f.date < w && (f.pain ?? 0) >= PAIN_WATCH).length > 0;
    st.cut = pain;
    st.repeat = st.prevN > 0 && lastFacts.length < st.prevN / 2 && !wasBackoff;
    const easyRuns = facts.filter((r) => r.date < w && (!r.planned || r.planned.kind === "footing" || r.planned.kind === "sortie_longue")).slice(-HR_HIGH_RUNS);
    st.noProgress = easyRuns.length === HR_HIGH_RUNS && easyRuns.every((r) => (r.hrHighShare ?? 0) > HR_HIGH_SHARE);
    if (st.phase === 0) {
      const lv = phase0Level(st.level, facts.filter((r) => r.date >= st.levelSince && r.date < w), perWeek, st.benchmark);
      if (lv.graduated) {
        st = { ...st, phase: 1, phaseSince: w, weekInPhase: 1, cycle: 1, refV: null, refL: null, prevV: null, prevL: null };
        return;
      }
      st.weekInPhase++;
      return;
    }
    const c = criteria({ ...st, weekInPhase: st.weekInPhase }, w, x, facts, planned);
    if (c && c.criteria.every((k) => k.ok)) {
      st = { ...st, phase: c.phase, phaseSince: w, weekInPhase: 1, cycle: st.cycle % DELOAD_EVERY + 1 };
      return;
    }
    st.weekInPhase++;
    st.cycle = st.cycle % DELOAD_EVERY + 1;
  };

  const run = (w: string, facts: DoneRun[], firm: boolean): { sessions: PlannedSession[]; summary: WeekSummary } => {
    const paused = pausedOn(pauses, w) && pausedOn(pauses, addDays(w, 6));
    const n0 = runsPerWeek(st.phase, perWeek, nDays);
    let t: Targets;
    if (st.phase === 0) {
      levelNow = phase0Level(st.level, facts.filter((r) => r.date >= st.levelSince && r.date < (firm && w === thisWeek ? today : w)), perWeek, st.benchmark);
      t = { weekStart: w, phase: 0, weekInPhase: st.weekInPhase, level: levelNow.level, n: Math.min(n0, 3), volume: 0, long: 0, easy: [], quality: [], test: null, strides: false, deload: false, paused: !!paused, notes: [] };
    } else {
      levelNow = null;
      t = weekTargets(st, w, x, facts, n0, deloads);
      // Deux signaux d'adaptation dans la semaine : la décharge est avancée à la suivante (§ 4.9).
      if (w === thisWeek && (x.morning?.signals.length ?? 0) >= 2) st.deloadNext = true;
      if (t.deload) {
        deloads.add(w);
        st.cycle = DELOAD_EVERY;
        st.deloadNext = false;
      } else {
        st.refV = t.volume;
        st.refL = t.long;
      }
      st.prevV = t.volume;
      st.prevL = t.long;
    }
    const prev = facts.filter((r) => r.date < w).pop();
    const prevRun = prev && daysBetween(prev.date, w) <= 3 ? -daysBetween(prev.date, w) : null;
    const { sessions, notes } = paused ? { sessions: [], notes: [] } : sessionsFor(t, x, prevRun, levelNow, firm);
    st.prevN = sessions.length;
    planned.set(w, sessions.length);
    return {
      sessions,
      summary: { weekStart: w, phase: t.phase, weekInPhase: t.weekInPhase, level: t.level, runs: sessions.length, volume: Math.round(t.volume), long: Math.round(t.long), deload: t.deload, paused: !!paused, notes: [...t.notes, ...notes] },
    };
  };

  let current: PlannedSession[] = [];
  for (let w = startWeek; w <= thisWeek; w = addDays(w, 7)) {
    if (w > startWeek) evolve(w, runs);
    const r = run(w, runs, w === thisWeek);
    weeks.push(r.summary);
    if (w === thisWeek) current = r.sessions;
  }
  const stNow = { ...st };
  const levelThisWeek = levelNow as LevelResult | null;
  const nextCriteria = criteria(stNow, addDays(thisWeek, 7), x, runs, planned);

  // Adaptation du jour (§ 4.8) sur les séances à venir de la semaine en cours.
  const adapted = adapt(current, x, runs, messages);

  // Semaine suivante, indicative : la semaine en cours supposée faite comme prévue.
  const ranToday = runs.some((r) => r.date === today);
  const ahead = adapted.filter((s) => !s.cancelled && (s.date > today || (s.date === today && !ranToday)));
  const facts = [...runs.filter((r) => r.date <= today), ...ahead.map(projected)].sort((a, b) => a.date.localeCompare(b.date));
  const nextWeek = addDays(thisWeek, 7);
  evolve(nextWeek, facts);
  const nx = run(nextWeek, facts, false);
  weeks.push(nx.summary);

  if (paused) {
    messages.unshift(
      paused.reason === "douleur"
        ? "Course suspendue : une douleur qui compte. Demande l’avis d’un professionnel de santé (médecin, kinésithérapeute) ; c’est toi qui rouvres le plan quand c’est le moment."
        : paused.reason === "malade"
          ? "Course en pause le temps d’aller mieux : la reprise se fera par un footing court."
          : "Plan en pause."
    );
  }
  for (const n of weeks[weeks.length - 2]?.notes ?? []) if (!messages.includes(n)) messages.push(n);
  const all = paused ? [] : [...adapted, ...nx.sessions];
  return {
    phase: stNow.phase,
    level: stNow.phase === 0 ? (levelThisWeek?.level ?? stNow.level) : null,
    weekInPhase: stNow.weekInPhase,
    sessions: all,
    weeks,
    paused,
    suspend,
    messages,
    next: nextCriteria,
  };
}

// ─── § 4.8 Adaptation du jour ───

/** Les règles d'adaptation sur les séances à venir de la semaine en cours (les passées ne bougent pas). */
function adapt(sessions: PlannedSession[], x: PlanInput, runs: DoneRun[], messages: string[]): PlannedSession[] {
  const today = x.today;
  const m = x.morning;
  const past = runs.filter((r) => r.date <= today);
  const last = past[past.length - 1] ?? null;
  const prev = past[past.length - 2] ?? null;
  const within = (d: string, days: number) => d <= today && daysBetween(d, today) <= days;
  const easyKind = (r: DoneRun) => !r.planned || r.planned.kind === "footing" || r.planned.kind === "marche_course";
  const overPlan = (r: DoneRun | null) => !!r && r.effort != null && r.planned != null && r.effort >= PLANNED_EFFORT[r.planned.kind] + EFFORT_OVER_PLAN;

  // Effort trop haut : footing à effort ≥ 6, ou deux séances de suite 2 points au-dessus du prévu.
  const effortHigh = !!last && within(last.date, NO_QUALITY_DAYS) && (((last.effort ?? 0) >= EFFORT_HIGH && easyKind(last)) || (overPlan(last) && overPlan(prev)));
  // Douleur 3 à 4 dans les 7 jours (≥ 5 : suspension, traitée avant).
  const pain = x.feedback.filter((f) => (f.pain ?? 0) >= PAIN_WATCH && (f.pain ?? 0) < PAIN_STOP && within(f.date, PAIN_AFTER_DAYS)).pop() ?? null;
  const painCancels = !!pain && !runs.some((r) => r.date > pain.date);
  // Malade : pas de course pendant 2 jours, puis un footing court.
  const sick = x.feedback.filter((f) => f.sick && within(f.date, SICK_REST_DAYS + 7)).pop() ?? null;
  const both = !!m?.hrv?.low && !!m?.rest?.high;
  const heart = !!m?.hrv?.low || !!m?.rest?.high;
  const hot = !!m?.heat;
  const hrHigh = !!last && within(last.date, 7) && (last.hrHighShare ?? 0) > HR_HIGH_SHARE && (easyKind(last) || last.planned?.kind === "sortie_longue");

  if (effortHigh) messages.push("Effort trop haut sur la dernière sortie : la prochaine séance est raccourcie de 30 %, pas de qualité pendant 7 jours.");
  if (hrHigh) messages.push("La FC est montée au-dessus de l’endurance pendant plus de 30 % de la dernière sortie : ralentis, marche si besoin.");
  if (pain) messages.push("Douleur notée : la prochaine course est remplacée par du repos ou de la natation, la semaine suivante allège de 30 % ; redis comment ça va demain matin.");
  for (const s of m?.signals ?? []) messages.push(s.text);
  if (both) messages.push("Variabilité basse et FC au repos haute : un à deux jours de repos, puis un footing court.");
  if (hot && runs.some((r) => r.heat && within(r.date, 1))) messages.push(`Au-delà de ${HOT_C} °C, la natation est une bonne idée à la place.`);

  let first = true;
  let shorten30 = effortHigh || !!m?.fatigue || (!!sick && !both);
  let cancelOne = painCancels;
  const cancel = (p: PlannedSession, why: string): PlannedSession => ({ ...p, cancelled: true, session: { ...p.session, notes: why } });
  return sessions.map((p) => {
    if (p.date < today) return p;
    const days = daysBetween(today, p.date);
    if (sick && daysBetween(sick.date, p.date) <= SICK_REST_DAYS) return cancel(p, "Annulée : repos tant que les symptômes sont là.");
    if (both && days <= 1) return cancel(p, "Annulée : repos (variabilité basse et FC au repos haute).");
    if (cancelOne) {
      cancelOne = false;
      return cancel(p, "Remplacée par du repos ou de la natation (douleur notée).");
    }
    let s = p.session;
    const notes: string[] = [];
    const noQuality =
      (effortHigh && daysBetween(last!.date, p.date) <= NO_QUALITY_DAYS) || (!!pain && daysBetween(pain.date, p.date) <= PAIN_AFTER_DAYS) || heart || (!!m?.shortSleep && days === 0) || (hot && days <= 1);
    if (noQuality && (QUALITY.has(s.kind) || s.kind === "test_aerobie")) {
      s = footing(clamp(sessionMinutes(s), 30, 45), x.zones);
      notes.push("Séance de qualité remplacée par un footing (signal d’adaptation).");
    }
    if (first && shorten30 && s.kind !== "marche_course") {
      const target = Math.max(20, Math.round(sessionMinutes(s) * CUT_SHORT));
      if (target < sessionMinutes(s)) {
        s = shorten(s.kind === "sortie_longue" ? footing(sessionMinutes(s), x.zones) : s, target, x.zones);
        notes.push("Raccourcie de 30 % (fatigue, effort trop haut ou reprise après une maladie).");
      }
      shorten30 = false;
    }
    first = false;
    if (hot && days <= 1) notes.push("Chaleur : cours tôt, fie-toi à la FC plutôt qu’à l’allure.");
    if (notes.length) s = { ...s, notes: [s.notes, ...notes].join(" ") };
    return { ...p, session: s, kind: s.kind, minutes: sessionMinutes(s) };
  });
}

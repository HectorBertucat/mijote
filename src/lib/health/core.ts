// Santé : tendance du poids, dépense et cibles. Module pur, sans accès à la base.
// Recherche et choix : docs/sante.md.
//
// - Tendance : moyenne mobile exponentielle à 10 % par jour (The Hacker's Diet), qui tient
//   compte des jours sans pesée (la tendance ne bouge pas ces jours-là) et repart de la pesée après
//   plus de 21 jours sans pesée. Une pesée par jour : la première.
// - Dépense de départ : Mifflin-St Jeor × facteur d'activité.
// - Dépense adaptative : apports moyens des journées complètes − variation de la tendance
//   × 7 700 kcal/kg, sur 21 jours. Il faut au moins 4 journées complètes par tranche de 7 jours
//   et une pesée par semaine, sinon on garde la dernière valeur fiable (« en attente »).
// - Cible : dépense + rythme visé (% du poids par semaine), qui bouge d'au plus 150 kcal
//   par semaine. Pas de rattrapage : une semaine trop riche n'est pas « remboursée ».
import { addDays } from "@/lib/week/propose";

export const KCAL_PER_KG = 7700;
export const TREND_ALPHA = 0.1;
export const TREND_RESET_DAYS = 21;
export const WINDOW_DAYS = 21;
export const MIN_COMPLETE_PER_WEEK = 4;
export const MAX_TARGET_STEP = 150;
export const FAT_MIN_G_PER_KG = 0.6;
export const DEFAULT_PROTEIN_G_PER_KG = 1.6;

export type Sex = "m" | "f";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "lose" | "maintain" | "gain" | "recomp";

export const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  sedentary: "Sédentaire",
  light: "Léger (1-2 séances/sem.)",
  moderate: "Modéré (3-5 séances/sem.)",
  active: "Actif (6-7 séances/sem.)",
  very_active: "Très actif (sport + métier physique)",
};

export const GOAL_LABEL: Record<Goal, string> = {
  lose: "Perdre du gras",
  maintain: "Maintenir",
  gain: "Prendre du muscle",
  recomp: "Recomposition",
};

/** Rythme conseillé par objectif, en % du poids par semaine. */
export const DEFAULT_RATE: Record<Goal, number> = { lose: -0.5, maintain: 0, gain: 0.25, recomp: -0.4 };

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const round1 = (x: number) => Math.round(x * 10) / 10;

// ─── Tendance ───

export interface WeighIn {
  date: string; // AAAA-MM-JJ
  measuredAt: string; // ISO
  kg: number;
}

/** Une valeur par jour : la première pesée du jour (le matin, à jeun). */
export function dailyWeights(list: WeighIn[]): { date: string; kg: number }[] {
  const byDay = new Map<string, WeighIn>();
  for (const w of list) {
    const cur = byDay.get(w.date);
    if (!cur || w.measuredAt < cur.measuredAt) byDay.set(w.date, w);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((w) => ({ date: w.date, kg: w.kg }));
}

export interface TrendPoint {
  date: string;
  kg: number | null; // pesée du jour, s'il y en a une
  trend: number;
}

/** Tendance jour par jour, du premier jour pesé à `until` (inclus), jours sans pesée compris. */
export function trendSeries(daily: { date: string; kg: number }[], until?: string, alpha = TREND_ALPHA): TrendPoint[] {
  if (!daily.length) return [];
  const byDate = new Map(daily.map((d) => [d.date, d.kg]));
  const last = until && until > daily[daily.length - 1].date ? until : daily[daily.length - 1].date;
  const out: TrendPoint[] = [];
  let trend = daily[0].kg;
  let lastWeigh = daily[0].date;
  for (let date = daily[0].date; date <= last; date = addDays(date, 1)) {
    const kg = byDate.get(date) ?? null;
    if (kg != null) {
      // Après une longue pause (historique importé, vacances), on repart de la pesée.
      trend = dayDiff(lastWeigh, date) > TREND_RESET_DAYS ? kg : trend + alpha * (kg - trend);
      lastWeigh = date;
    }
    out.push({ date, kg, trend });
  }
  return out;
}

/** Rythme de la tendance en kg par semaine, sur les `days` derniers jours de la série. */
export function weeklyRate(series: TrendPoint[], days = 14): number | null {
  if (series.length < 8) return null;
  const end = series[series.length - 1];
  const start = series[Math.max(0, series.length - 1 - days)];
  const span = dayDiff(start.date, end.date);
  return span > 0 ? ((end.trend - start.trend) / span) * 7 : null;
}

// ─── Dépense ───

export interface Profile {
  sex: Sex | null;
  birthDate: string | null; // AAAA-MM-JJ
  heightCm: number | null;
  activity: Activity | null;
  goal: Goal | null;
  ratePct: number | null;
  proteinGPerKg: number | null;
  proteinG: number | null;
}

export const missingForEstimate = (p: Profile): string[] =>
  [!p.sex && "sexe", !p.birthDate && "date de naissance", !p.heightCm && "taille", !p.activity && "activité"].filter((x): x is string => !!x);

export function ageOn(birthDate: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today.slice(5) < birthDate.slice(5) ? years - 1 : years;
}

/** Métabolisme de base, Mifflin-St Jeor (kcal/j). */
export function mifflin(sex: Sex, kg: number, cm: number, age: number): number {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === "m" ? 5 : -161);
}

/** Dépense de départ (formule), ou null s'il manque une donnée du profil. */
export function estimatedTdee(p: Profile, kg: number, today: string): number | null {
  if (missingForEstimate(p).length) return null;
  const age = ageOn(p.birthDate!, today);
  return mifflin(p.sex!, kg, p.heightCm!, age) * ACTIVITY_FACTOR[p.activity!];
}

export interface IntakeDay {
  date: string;
  kcal: number;
  complete: boolean;
}

export interface AdaptiveResult {
  tdee: number | null; // null = pas assez de données
  completeDays: number;
  weighDays: number;
  avgIntake: number | null;
  trendChangeKg: number | null;
  window: { start: string; end: string };
  reason: string;
}

/** Dépense mesurée sur la fenêtre qui finit la veille de `weekStart`. */
export function adaptiveTdee(intake: IntakeDay[], series: TrendPoint[], weekStart: string, windowDays = WINDOW_DAYS): AdaptiveResult {
  const end = addDays(weekStart, -1);
  const start = addDays(weekStart, -windowDays);
  const window = { start, end };
  const inWin = (d: string) => d >= start && d <= end;
  const complete = intake.filter((d) => d.complete && inWin(d.date));
  const weighDays = series.filter((p) => p.kg != null && inWin(p.date)).length;
  const need = Math.ceil((MIN_COMPLETE_PER_WEEK * windowDays) / 7);
  const needWeigh = Math.ceil(windowDays / 7);
  const tStart = series.find((p) => p.date === addDays(start, -1)) ?? series.find((p) => p.date === start);
  const tEnd = series.find((p) => p.date === end);
  const avgIntake = complete.length ? complete.reduce((s, d) => s + d.kcal, 0) / complete.length : null;
  const trendChangeKg = tStart && tEnd ? tEnd.trend - tStart.trend : null;
  const base = { completeDays: complete.length, weighDays, avgIntake, trendChangeKg, window };
  if (complete.length < need) return { ...base, tdee: null, reason: `${complete.length} journées complètes sur ${windowDays} jours (il en faut ${need})` };
  if (weighDays < needWeigh || trendChangeKg == null) return { ...base, tdee: null, reason: `${weighDays} pesées sur ${windowDays} jours (il en faut ${needWeigh}, réparties)` };
  const span = dayDiff(tStart!.date, tEnd!.date);
  const tdee = avgIntake! - (trendChangeKg * KCAL_PER_KG) / span;
  return { ...base, tdee, reason: `${complete.length} journées complètes et ${weighDays} pesées sur ${windowDays} jours` };
}

// ─── Cibles ───

export interface Targets {
  kcal: number;
  proteinG: number;
  fatMinG: number;
  dailyDeltaKcal: number; // écart visé à la dépense (négatif = déficit)
}

export function proteinTarget(p: Profile, kg: number): number {
  if (p.proteinG) return Math.round(p.proteinG);
  return Math.round((p.proteinGPerKg ?? DEFAULT_PROTEIN_G_PER_KG) * kg);
}

export function rateOf(p: Profile): number {
  return p.ratePct ?? DEFAULT_RATE[p.goal ?? "maintain"];
}

export function targetsFor(p: Profile, tdee: number, kg: number): Targets {
  const dailyDeltaKcal = ((rateOf(p) / 100) * kg * KCAL_PER_KG) / 7;
  return {
    kcal: Math.round((tdee + dailyDeltaKcal) / 10) * 10,
    proteinG: proteinTarget(p, kg),
    fatMinG: Math.round(FAT_MIN_G_PER_KG * kg),
    dailyDeltaKcal: Math.round(dailyDeltaKcal),
  };
}

export type Confidence = "estimate" | "holding" | "adaptive";

export interface WeeklyReview {
  weekStart: string;
  tdee: number;
  confidence: Confidence;
  targets: Targets;
  trendKg: number;
  adaptive: AdaptiveResult;
  stepLimited: boolean;
  explanation: string;
}

export interface PreviousTarget {
  tdeeKcal: number;
  kcalTarget: number;
  confidence: Confidence;
}

/**
 * Bilan du lundi. Ordre de préférence pour la dépense : mesurée (adaptative) ; sinon la dernière
 * valeur fiable (en attente) ; sinon la formule (estimation). La cible bouge d'au plus 150 kcal
 * par rapport à la semaine précédente.
 */
export function weeklyReview(input: {
  profile: Profile;
  weekStart: string;
  weighIns: WeighIn[];
  intake: IntakeDay[];
  previous: PreviousTarget | null;
}): WeeklyReview | null {
  const series = trendSeries(dailyWeights(input.weighIns), addDays(input.weekStart, -1));
  const known = series.filter((p) => p.date < input.weekStart);
  if (!known.length) return null;
  const trendKg = known[known.length - 1].trend;
  const adaptive = adaptiveTdee(input.intake, series, input.weekStart);
  let tdee: number;
  let confidence: Confidence;
  let explanation: string;
  if (adaptive.tdee != null) {
    tdee = adaptive.tdee;
    confidence = "adaptive";
    explanation = `Dépense mesurée : ${adaptive.reason}. Apports moyens ${Math.round(adaptive.avgIntake!)} kcal, tendance ${adaptive.trendChangeKg! >= 0 ? "+" : ""}${round1(adaptive.trendChangeKg!)} kg.`;
  } else if (input.previous && input.previous.confidence !== "estimate") {
    tdee = input.previous.tdeeKcal;
    confidence = "holding";
    explanation = `En attente : ${adaptive.reason}. On garde la dernière dépense mesurée.`;
  } else {
    const est = estimatedTdee(input.profile, trendKg, input.weekStart);
    if (est == null) return null;
    tdee = est;
    confidence = "estimate";
    explanation = `Estimation par formule (Mifflin-St Jeor × activité) : ${adaptive.reason}.`;
  }
  const targets = targetsFor(input.profile, tdee, trendKg);
  let stepLimited = false;
  if (input.previous) {
    const diff = targets.kcal - input.previous.kcalTarget;
    if (Math.abs(diff) > MAX_TARGET_STEP) {
      targets.kcal = input.previous.kcalTarget + Math.sign(diff) * MAX_TARGET_STEP;
      stepLimited = true;
      explanation += ` La cible bouge de ${MAX_TARGET_STEP} kcal au plus par semaine.`;
    }
  }
  return { weekStart: input.weekStart, tdee: Math.round(tdee), confidence, targets, trendKg: round1(trendKg), adaptive, stepLimited, explanation };
}

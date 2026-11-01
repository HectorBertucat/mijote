// Charge et forme (docs/course.md § 2) : TRIMP de Banister normalisé façon hrTSS (100 = 1 h à la FCseuil),
// avec un repli sans série de FC (FC moyenne > effort perçu > allure > défaut par type) ; condition, fatigue et
// fraîcheur (42 et 7 jours) ; rapport aigu/chronique indicatif ; règle de la sortie la plus longue des 30
// jours ; monotonie. Pur.
import {
  ACWR_BAND,
  ATL_DAYS,
  CTL_DAYS,
  DEFAULT_X,
  EFFORT_X,
  LOAD_PER_THRESHOLD_HOUR,
  LONGEST_RATIO,
  LONGEST_RATIO_BIG,
  LONGEST_RATIO_MID,
  LONGEST_WINDOW_DAYS,
  MONOTONY_MAX,
  PACE_FIT_MIN_RUNS,
  SERIES_MIN_COVERAGE,
  THRESHOLD_RESERVE,
  TRIMP_COEF,
  TSB_BANDS,
  TSB_PCT_MIN_CTL,
} from "./constants";
import { addDays, clamp, daysBetween, mean, sd } from "./dates";
import type { Hz } from "./series";
import type { HrRefs } from "./zones";

export type Sex = "m" | "f" | null | undefined;
export type LoadRefs = Pick<HrRefs, "max" | "rest" | "threshold" | "thresholdSource"> & { sex: Sex };

const coef = (sex: Sex) => TRIMP_COEF[sex === "m" || sex === "f" ? sex : "x"];

/** Part de la réserve cardiaque, bornée entre 0 et 1. */
export const reserveX = (bpm: number, r: Pick<LoadRefs, "max" | "rest">) => clamp((bpm - r.rest) / (r.max - r.rest), 0, 1);

/** Poids d'une minute à x : x × a × e^(b × x). */
export const trimpRate = (x: number, sex: Sex) => {
  const { a, b } = coef(sex);
  return x * a * Math.exp(b * x);
};

/** x au seuil : 0,80 tout juste si le seuil est estimé (défini ainsi), sinon mesuré. */
export const thresholdX = (r: LoadRefs) => (r.thresholdSource === "estimee" ? THRESHOLD_RESERVE : reserveX(r.threshold, r));

/** TRIMP d'une heure à la FCseuil. */
export const thresholdHour = (r: LoadRefs) => 60 * trimpRate(thresholdX(r), r.sex);

/** TRIMP d'une série à 1 Hz (série nettoyée), et les secondes mesurées. */
export function trimpOf(hr: Hz, r: LoadRefs): { trimp: number; seconds: number } {
  let trimp = 0;
  let seconds = 0;
  for (const v of hr) {
    if (v == null) continue;
    trimp += trimpRate(reserveX(v, r), r.sex) / 60;
    seconds++;
  }
  return { trimp, seconds };
}

/** Charge (points) d'un TRIMP. */
export const loadOfTrimp = (trimp: number, r: LoadRefs) => (LOAD_PER_THRESHOLD_HOUR * trimp) / thresholdHour(r);

/** Charge de `minutes` à x constant. */
export const loadOfX = (x: number, minutes: number, r: LoadRefs) => loadOfTrimp(minutes * trimpRate(x, r.sex), r);

/** x d'un effort perçu 1–10 (arrondi à l'entier, borné). */
export const effortX = (effort: number) => EFFORT_X[clamp(Math.round(effort), 1, 10) - 1];

/** Type de séance pour la charge : course (et ses variantes), marche, natation, renforcement… */
export type LoadKind = keyof typeof DEFAULT_X;

/** Natation et renforcement : l'effort perçu passe avant la FC (FC optique peu fiable, effort musculaire). */
const EFFORT_FIRST = new Set<LoadKind>(["natation", "kettlebell", "renfo"]);
const RUNNING = new Set<LoadKind>(["marche_course", "footing", "sortie_longue", "fartlek", "cotes", "tempo"]);
export const isRunKind = (k: LoadKind) => RUNNING.has(k);

export interface PaceFit {
  /** FC = a + b × vitesse (m/s). */
  a: number;
  b: number;
}

/** Droite personnelle FC = f(vitesse ajustée) par moindres carrés, s'il y a assez de courses (sinon null). */
export function fitPace(runs: { speed: number; hr: number }[]): PaceFit | null {
  const xs = runs.filter((r) => r.speed > 0 && r.hr > 0);
  if (xs.length < PACE_FIT_MIN_RUNS) return null;
  const mx = mean(xs.map((r) => r.speed))!;
  const my = mean(xs.map((r) => r.hr))!;
  const sxx = xs.reduce((s, r) => s + (r.speed - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const b = xs.reduce((s, r) => s + (r.speed - mx) * (r.hr - my), 0) / sxx;
  return b > 0 ? { a: my - b * mx, b } : null;
}

export interface LoadInput {
  kind: LoadKind;
  minutes: number;
  /** Série nettoyée à 1 Hz, si l'app l'a envoyée. */
  hr?: Hz | null;
  hrAvg?: number | null;
  effort?: number | null;
  /** Vitesse ajustée moyenne (m/s), pour l'estimation par l'allure. */
  speed?: number | null;
}

export type LoadSource = "serie" | "fc_moyenne" | "effort" | "allure" | "defaut";
export const LOAD_SOURCE_LABEL: Record<LoadSource, string> = { serie: "série de FC", fc_moyenne: "FC moyenne", effort: "effort perçu", allure: "allure", defaut: "durée et type" };

/** La charge d'une séance et d'où elle vient (§ 2.2 : la première source possible gagne). */
export function sessionLoad(s: LoadInput, r: LoadRefs, pace: PaceFit | null = null): { load: number; source: LoadSource } {
  if (!(s.minutes > 0)) return { load: 0, source: "defaut" };
  const byEffort = s.effort != null && s.effort >= 1 ? { load: loadOfX(effortX(s.effort), s.minutes, r), source: "effort" as const } : null;
  if (EFFORT_FIRST.has(s.kind) && byEffort) return byEffort;
  if (s.hr) {
    const t = trimpOf(s.hr, r);
    if (t.seconds >= SERIES_MIN_COVERAGE * s.minutes * 60) return { load: loadOfTrimp((t.trimp * (s.minutes * 60)) / t.seconds, r), source: "serie" };
  }
  if (s.hrAvg) return { load: loadOfX(reserveX(s.hrAvg, r), s.minutes, r), source: "fc_moyenne" };
  if (byEffort) return byEffort;
  if (pace && s.speed && isRunKind(s.kind)) return { load: loadOfX(reserveX(pace.a + pace.b * s.speed, r), s.minutes, r), source: "allure" };
  return { load: loadOfX(DEFAULT_X[s.kind] ?? DEFAULT_X.autre, s.minutes, r), source: "defaut" };
}

// ─── § 2.4 Condition, fatigue, fraîcheur ───

export interface FitnessDay {
  date: string;
  load: number;
  ctl: number;
  atl: number;
  /** Fraîcheur du matin, avant les séances du jour. */
  tsb: number;
  tsbPct: number | null;
}

/** CTL, ATL et TSB jour par jour, de `from` (départ à 0) à `to`. */
export function fitness(daily: { date: string; load: number }[], from: string, to: string): FitnessDay[] {
  const by = new Map<string, number>();
  for (const d of daily) by.set(d.date, (by.get(d.date) ?? 0) + d.load);
  const kc = 1 - Math.exp(-1 / CTL_DAYS);
  const ka = 1 - Math.exp(-1 / ATL_DAYS);
  const out: FitnessDay[] = [];
  let ctl = 0;
  let atl = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = by.get(d) ?? 0;
    const tsb = ctl - atl;
    const tsbPct = ctl >= TSB_PCT_MIN_CTL ? (100 * tsb) / ctl : null;
    ctl += (c - ctl) * kc;
    atl += (c - atl) * ka;
    out.push({ date: d, load: c, ctl, atl, tsb, tsbPct });
  }
  return out;
}

export type FormBand = "transition" | "frais" | "neutre" | "productif" | "risque";
export const FORM_LABEL: Record<FormBand, string> = { transition: "En transition", frais: "Frais", neutre: "Neutre", productif: "Productif", risque: "Fatigue trop haute" };

export function formBand(tsbPct: number): FormBand {
  if (tsbPct >= TSB_BANDS.transition) return "transition";
  if (tsbPct >= TSB_BANDS.fresh) return "frais";
  if (tsbPct >= TSB_BANDS.neutral) return "neutre";
  if (tsbPct >= TSB_BANDS.risk) return "productif";
  return "risque";
}

// ─── § 2.5 ACWR, indicatif ───

/** Charge de course des 7 derniers jours ÷ moyenne hebdomadaire des jours 8 à 35 (null sans historique). */
export function acwr(daily: { date: string; load: number }[], today: string): { value: number; inBand: boolean } | null {
  const sum = (a: number, b: number) => daily.filter((d) => daysBetween(d.date, today) >= a && daysBetween(d.date, today) <= b).reduce((s, d) => s + d.load, 0);
  const acute = sum(0, 6);
  const chronic = sum(7, 34) / 4;
  if (chronic <= 0) return null;
  const value = acute / chronic;
  return { value, inBand: value >= ACWR_BAND[0] && value <= ACWR_BAND[1] };
}

// ─── § 2.6 La sortie la plus longue des 30 jours ───

export type LongestCategory = "dans_la_regle" | "petit_pic" | "pic_moyen" | "grand_pic" | "reprise";
export const LONGEST_LABEL: Record<LongestCategory, string> = { dans_la_regle: "dans la règle", petit_pic: "petit pic", pic_moyen: "pic moyen", grand_pic: "grand pic", reprise: "reprise" };

/** La plus longue des courses des 30 jours avant `date` (même unité que `value`). */
export function longestBefore(runs: { date: string; value: number }[], date: string): number | null {
  const xs = runs.filter((r) => r.date < date && daysBetween(r.date, date) <= LONGEST_WINDOW_DAYS).map((r) => r.value);
  return xs.length ? Math.max(...xs) : null;
}

/** R = cette sortie ÷ la plus longue des 30 jours d'avant, et sa catégorie (Frandsen 2025). */
export function longestRatio(value: number, longest: number | null): { ratio: number | null; category: LongestCategory } {
  if (!longest) return { ratio: null, category: "reprise" };
  const ratio = value / longest;
  return { ratio, category: ratio <= LONGEST_RATIO ? "dans_la_regle" : ratio <= LONGEST_RATIO_MID ? "petit_pic" : ratio <= LONGEST_RATIO_BIG ? "pic_moyen" : "grand_pic" };
}

// ─── § 2.7 Monotonie ───

/** Moyenne ÷ écart-type de la charge quotidienne des 7 jours (null si l'écart-type est nul). */
export function monotony(daily: { date: string; load: number }[], today: string): { value: number; high: boolean } | null {
  const by = new Map<string, number>();
  for (const d of daily) by.set(d.date, (by.get(d.date) ?? 0) + d.load);
  const xs = Array.from({ length: 7 }, (_, i) => by.get(addDays(today, -i)) ?? 0);
  const m = mean(xs)!;
  const s = sd(xs);
  if (!s || !m) return null;
  return { value: m / s, high: m / s > MONOTONY_MAX };
}

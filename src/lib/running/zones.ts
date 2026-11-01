// Zones cardiaques (docs/course.md § 1) : FCmax (saisie > observée et confirmée > Tanaka), FC au repos
// (médiane des 30 jours), FC au seuil (saisie ou test > défaut), puis cinq zones par la réserve cardiaque, ou
// de Friel si le seuil est mesuré. Repères mis à jour le 1er du mois, et seulement s'ils bougent de 2 bpm. Pur.
import {
  ALERT_EASY_LOW_OFFSET,
  ALERT_MIN_WIDTH,
  FRIEL_ZONES,
  HR_CHANGE_MIN,
  HRMAX_ABS,
  HRMAX_CONFIRM_BPM,
  HRMAX_OBS_ABOVE_TANAKA,
  HRMAX_OBS_BELOW_TANAKA,
  HRMAX_WINDOW_DAYS,
  RESERVE_ZONES,
  REST_DEFAULT,
  REST_FALLBACK_DAYS,
  REST_MIN_SAMPLES,
  REST_WINDOW_DAYS,
  TANAKA,
  THRESHOLD_RESERVE,
} from "./constants";
import { addDays, daysBetween, median } from "./dates";

export type ZoneIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface HrRefs {
  max: number;
  maxSource: "saisie" | "observee" | "age";
  rest: number;
  restSource: "saisie" | "mesuree" | "defaut";
  threshold: number;
  thresholdSource: "saisie" | "test" | "estimee";
}

export interface Zones extends HrRefs {
  method: "reserve" | "friel";
  /** Bornes basses de Z1 à Z5, en bpm. */
  lows: [number, number, number, number, number];
}

export const ZONE_NAMES = ["sous les zones", "Récupération", "Endurance", "Tempo", "Seuil", "VO2max"] as const;
/** Repères sans cardio : effort perçu et test de la parole (§ 1.2). */
export const ZONE_FEEL = ["marche, arrêt", "effort 2 à 4, on parle en phrases", "effort 2 à 4, on parle en phrases", "effort 5 à 6, phrases courtes", "effort 7 à 8, quelques mots", "effort 9 à 10, pas un mot"] as const;
export const METHOD_LABEL = { age: "d’après l’âge", observee: "d’après vos courses", saisie: "saisie", test: "d’après votre test" } as const;

/** FCmax estimée par l'âge (Tanaka 2001). */
export const tanaka = (age: number) => Math.round(TANAKA.a - TANAKA.b * age);

export interface Peak {
  date: string;
  /** Pic de 30 s de la sortie (series.peak30), null si pas de série. */
  peak: number | null;
  doubtful?: boolean;
}

/** Le 1er du mois du jour, et le 1er du mois précédent. */
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const prevMonth = (first: string) => monthStart(addDays(first, -1));

/**
 * FCmax observée au jour `asOf` : le plus haut pic des 365 jours d'avant confirmé par une autre sortie à 5 bpm
 * ou moins, dans les bornes autour de Tanaka. `pending` : un pic plus haut, isolé, « à confirmer ».
 */
export function observedMax(peaks: Peak[], age: number, asOf: string): { value: number | null; pending: number | null } {
  const t = tanaka(age);
  const lo = t - HRMAX_OBS_BELOW_TANAKA;
  const hi = Math.min(HRMAX_ABS, t + HRMAX_OBS_ABOVE_TANAKA);
  const xs = peaks
    .filter((p) => p.peak != null && !p.doubtful && p.date < asOf && daysBetween(p.date, asOf) <= HRMAX_WINDOW_DAYS && p.peak >= lo && p.peak <= hi)
    .map((p) => p.peak!)
    .sort((a, b) => b - a);
  let pending: number | null = null;
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i + 1] >= xs[i] - HRMAX_CONFIRM_BPM) return { value: xs[i], pending };
    pending ??= xs[i];
  }
  return { value: null, pending: pending ?? xs[xs.length - 1] ?? null };
}

/**
 * Un repère mis à jour le 1er de chaque mois : on rejoue les 13 derniers mois, un changement n'est retenu
 * que s'il fait au moins 2 bpm (et, pour la FCmax, seulement vers le haut). Sans valeur d'un mois passé,
 * celle du jour sert (première mise en route).
 */
function monthly(today: string, at: (asOf: string) => number | null, upOnly: boolean): number | null {
  const months: string[] = [];
  for (let m = monthStart(today), i = 0; i < 13; i++, m = prevMonth(m)) months.unshift(m);
  let kept: number | null = null;
  for (const m of months) {
    const v = at(m);
    if (v == null) continue;
    if (kept == null || (upOnly ? v - kept >= HR_CHANGE_MIN : Math.abs(v - kept) >= HR_CHANGE_MIN)) kept = v;
  }
  return kept ?? at(addDays(today, 1));
}

/** FC au repos au jour `asOf` : médiane des 30 jours (7 mesures au moins), sinon la dernière médiane de moins de 90 jours. */
export function restAt(samples: { date: string; bpm: number }[], asOf: string): number | null {
  for (let back = 0; back <= REST_FALLBACK_DAYS - REST_WINDOW_DAYS; back += 1) {
    const end = addDays(asOf, -back);
    const xs = samples.filter((s) => s.date < end && daysBetween(s.date, end) <= REST_WINDOW_DAYS).map((s) => s.bpm);
    if (xs.length >= REST_MIN_SAMPLES) return Math.round(median(xs)!);
  }
  return null;
}

export interface RefsInput {
  age: number;
  today: string;
  entered: { max?: number | null; rest?: number | null; threshold?: number | null; thresholdSource?: "saisie" | "test" | null };
  peaks: Peak[];
  rest: { date: string; bpm: number }[];
}

/** Les trois repères retenus, avec leur source. */
export function hrRefs(x: RefsInput): HrRefs {
  const t = tanaka(x.age);
  let max: number = t;
  let maxSource: HrRefs["maxSource"] = "age";
  if (x.entered.max) {
    max = x.entered.max;
    maxSource = "saisie";
  } else {
    const obs = monthly(x.today, (asOf) => observedMax(x.peaks, x.age, asOf).value, true);
    if (obs != null && obs > t) {
      max = obs;
      maxSource = "observee";
    }
  }
  let rest: number = REST_DEFAULT;
  let restSource: HrRefs["restSource"] = "defaut";
  if (x.entered.rest) {
    rest = x.entered.rest;
    restSource = "saisie";
  } else {
    const r = monthly(x.today, (asOf) => restAt(x.rest, asOf), false);
    if (r != null) {
      rest = r;
      restSource = "mesuree";
    }
  }
  const measured = x.entered.threshold && x.entered.threshold > rest && x.entered.threshold < max;
  return {
    max,
    maxSource,
    rest,
    restSource,
    threshold: measured ? x.entered.threshold! : Math.round(rest + THRESHOLD_RESERVE * (max - rest)),
    thresholdSource: measured ? (x.entered.thresholdSource ?? "saisie") : "estimee",
  };
}

/** Les cinq zones : réserve cardiaque (Karvonen) ; Friel si la FCseuil est mesurée. */
export function zonesOf(r: HrRefs): Zones {
  const reserve = r.max - r.rest;
  const byReserve = RESERVE_ZONES.map((p) => Math.round(r.rest + p * reserve)) as Zones["lows"];
  if (r.thresholdSource === "estimee") return { ...r, method: "reserve", lows: byReserve };
  const friel = FRIEL_ZONES.map((p) => Math.round(p * r.threshold));
  // Z1 commence toujours à 50 % de la réserve ; une borne de Friel ne peut pas passer sous la précédente.
  const lows = [byReserve[0], ...friel] as Zones["lows"];
  for (let i = 1; i < lows.length; i++) lows[i] = Math.max(lows[i], lows[i - 1] + 1);
  return { ...r, method: "friel", lows };
}

/** Zone d'une FC : 0 sous les zones, 1 à 5 (borne basse incluse). */
export function zoneOf(bpm: number, z: Pick<Zones, "lows">): ZoneIndex {
  let k = 0;
  for (let i = 0; i < 5; i++) if (bpm >= z.lows[i]) k = i + 1;
  return k as ZoneIndex;
}

/** Bornes affichées d'une zone : [basse, haute] (la haute = basse de la suivante − 1 ; Z5 jusqu'à la FCmax). */
export function zoneRange(z: Pick<Zones, "lows" | "max">, k: 1 | 2 | 3 | 4 | 5): [number, number] {
  return [z.lows[k - 1], k === 5 ? z.max : z.lows[k] - 1];
}

/** Trois zones de Seiler : facile (sous les zones, Z1, Z2), modéré (Z3), difficile (Z4, Z5). */
export const seilerOf = (k: ZoneIndex): "easy" | "moderate" | "hard" => (k <= 2 ? "easy" : k === 3 ? "moderate" : "hard");

/** Une plage d'alerte d'au moins 8 bpm, élargie autour de son milieu si besoin. */
export function widen([lo, hi]: [number, number]): [number, number] {
  if (hi - lo >= ALERT_MIN_WIDTH) return [lo, hi];
  const mid = (lo + hi) / 2;
  return [Math.floor(mid - ALERT_MIN_WIDTH / 2), Math.ceil(mid + ALERT_MIN_WIDTH / 2)];
}

/** Plages des alertes de montre (§ 4.10) : footing, soutenu, tempo, milieu de Z2 (test aérobie). */
export function alertRanges(z: Zones) {
  const z2 = zoneRange(z, 2);
  const mid = Math.round((z2[0] + z2[1]) / 2);
  return {
    easy: widen([z.lows[0] + ALERT_EASY_LOW_OFFSET, z2[1]]),
    steady: widen([z.lows[2], zoneRange(z, 4)[1]]),
    tempo: widen([Math.round(0.9 * z.threshold), Math.round(0.95 * z.threshold)]),
    // « milieu de Z2 ± 3 bpm » ferait 6 bpm : élargi à 8 (jamais moins de 8, § 4.10).
    z2mid: widen([mid - 3, mid + 3]),
    z2: z2,
  };
}

/** Clé des zones en cours : une analyse gardée avec une autre clé est refaite. */
export const zonesKey = (z: Zones) => `${z.method}:${z.max}:${z.rest}:${z.threshold}`;

// Signaux du matin (docs/course.md § 4.8) : variabilité (ln SDNN, 7 jours contre la bande des 60 jours), FC au
// repos haute, sommeil court, fatigue de charge, chaleur. Un signal d'un seul jour ne bloque jamais seul (sauf
// la douleur, traitée par le plan). Pur.
import {
  BAND_DAYS,
  BAND_MIN_SAMPLES,
  HEAT_C,
  REST_HIGH_MEAN,
  REST_HIGH_TWO_DAYS,
  SHORT_SLEEP_MIN,
  SIGNAL_DAYS,
  SIGNAL_MIN_SAMPLES,
  SWC_SD,
  TSB_BANDS,
} from "./constants";
import { addDays, daysBetween, mean, round, sd } from "./dates";

export interface MorningInput {
  today: string;
  /** SDNN en ms, par jour de mesure. */
  hrv: { date: string; ms: number }[];
  rest: { date: string; bpm: number }[];
  /** Nuits datées du réveil (src/lib/health/sleep.ts). */
  sleep: { date: string; asleepMin: number }[];
  tsbPct: number | null;
  /** Température des sorties récentes, si la montre la donne. */
  temps?: { date: string; tempC: number }[];
}

export type SignalKind = "hrv_basse" | "fc_repos_haute" | "sommeil_court" | "fatigue" | "chaleur";

export interface Signal {
  kind: SignalKind;
  text: string;
}

export interface Morning {
  hrv: { mean7: number; mean60: number; sd60: number; low: boolean } | null;
  rest: { mean7: number; ref: number; high: boolean } | null;
  shortSleep: boolean;
  fatigue: boolean;
  heat: boolean;
  signals: Signal[];
}

const inWindow = (date: string, today: string, days: number) => date <= today && daysBetween(date, today) < days;

export function morning(x: MorningInput): Morning {
  const signals: Signal[] = [];

  let hrv: Morning["hrv"] = null;
  const ln = x.hrv.filter((h) => h.ms > 0).map((h) => ({ date: h.date, v: Math.log(h.ms) }));
  const band = ln.filter((h) => inWindow(h.date, x.today, BAND_DAYS)).map((h) => h.v);
  const week = ln.filter((h) => inWindow(h.date, x.today, SIGNAL_DAYS)).map((h) => h.v);
  if (band.length >= BAND_MIN_SAMPLES && week.length >= SIGNAL_MIN_SAMPLES) {
    const m60 = mean(band)!;
    const s60 = sd(band)!;
    const m7 = mean(week)!;
    const low = m7 < m60 - SWC_SD * s60;
    hrv = { mean7: round(m7, 3), mean60: round(m60, 3), sd60: round(s60, 3), low };
    if (low) signals.push({ kind: "hrv_basse", text: "Variabilité cardiaque basse cette semaine : pas de séance de qualité, volume non augmenté." });
  }

  let rest: Morning["rest"] = null;
  const restBand = x.rest.filter((r) => inWindow(r.date, x.today, BAND_DAYS)).map((r) => r.bpm);
  const restWeek = x.rest.filter((r) => inWindow(r.date, x.today, SIGNAL_DAYS)).map((r) => r.bpm);
  if (restBand.length >= BAND_MIN_SAMPLES && restWeek.length >= SIGNAL_MIN_SAMPLES) {
    const ref = mean(restBand)!;
    const m7 = mean(restWeek)!;
    const byDay = new Map(x.rest.map((r) => [r.date, r.bpm]));
    const d0 = byDay.get(x.today);
    const d1 = byDay.get(addDays(x.today, -1));
    const twoHigh = d0 != null && d1 != null && d0 >= ref + REST_HIGH_TWO_DAYS && d1 >= ref + REST_HIGH_TWO_DAYS;
    const high = m7 >= ref + REST_HIGH_MEAN || twoHigh;
    rest = { mean7: round(m7, 1), ref: round(ref, 1), high };
    if (high) signals.push({ kind: "fc_repos_haute", text: "FC au repos au-dessus de l’habitude : pas de séance de qualité, volume non augmenté." });
  }

  const night = (d: string) => x.sleep.find((n) => n.date === d)?.asleepMin;
  const n0 = night(x.today);
  const n1 = night(addDays(x.today, -1));
  const shortSleep = n0 != null && n1 != null && n0 < SHORT_SLEEP_MIN && n1 < SHORT_SLEEP_MIN;
  if (shortSleep) signals.push({ kind: "sommeil_court", text: "Moins de 6 h de sommeil deux nuits de suite : pas de qualité aujourd’hui." });

  const fatigue = x.tsbPct != null && x.tsbPct < TSB_BANDS.risk;
  if (fatigue) signals.push({ kind: "fatigue", text: "Fatigue de charge trop haute : la prochaine séance devient un footing court ou du repos." });

  const heat = (x.temps ?? []).some((t) => t.tempC >= HEAT_C && daysBetween(t.date, x.today) <= 1 && t.date <= x.today);
  if (heat) signals.push({ kind: "chaleur", text: "Chaleur : courir tôt, se fier à la FC plutôt qu’à l’allure, raccourcir ; pas de qualité." });

  return { hrv, rest, shortSleep, fatigue, heat, signals };
}

/** Variabilité basse et FC au repos haute à la fois : 1 à 2 jours de repos, puis un footing court. */
export const bothHeartSignals = (m: Morning) => !!m.hrv?.low && !!m.rest?.high;

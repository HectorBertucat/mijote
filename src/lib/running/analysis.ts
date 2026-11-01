// Analyse d'une sortie (docs/course.md § 3) : séries préparées, temps par zone et répartition de Seiler,
// temps au kilomètre avec l'allure ajustée à la pente (Minetti bornée), charge, facteur d'efficacité,
// découplage aérobie et dérive (avec leurs conditions), VO2max effective, allure en Z2, chaleur. Pur.
import {
  DECOUPLING_BANDS,
  DECOUPLING_EASY_SHARE,
  DECOUPLING_HR_COVERAGE,
  DECOUPLING_MIN_S,
  DECOUPLING_RUN_SHARE,
  DECOUPLING_SPEED_CV,
  GRADE_FACTOR_MIN,
  GRADE_MAX,
  GRADE_MIN_ELEV_PER_KM,
  HEAT_C,
  HR_SKIP_FIRST_S,
  MINETTI,
  RUN_SPEED_MS,
  RUNNING_VERSION,
  STABLE_SKIP_S,
  STOP_SPEED_MS,
  VO2_MIN_S,
  VO2_MIN_X,
  Z2_PACE_BPM,
  Z2_PACE_MIN_S,
} from "./constants";
import { clamp, mean, median, round, sd } from "./dates";
import { reserveX, sessionLoad, type LoadKind, type LoadRefs, type LoadSource, type PaceFit } from "./load";
import { clean, motionOf, peak30, resample, type HrPoint, type Hz, type PauseEvent, type Split } from "./series";
import { seilerOf, zoneOf, zoneRange, zonesKey, type ZoneIndex, type Zones } from "./zones";

// ─── § 3.3 Allure ajustée à la pente ───

/** Coût de la course en pente (J/kg/m), Minetti 2002. */
export const minettiCost = (g: number) => MINETTI.reduce((s, c, i) => s + c * g ** (5 - i), 0);

/** Facteur d'ajustement : Cr(g) / 3,6, g borné à ±0,20, jamais sous 0,80 en descente (choix de Mijote). */
export const gradeFactor = (g: number) => Math.max(GRADE_FACTOR_MIN, minettiCost(clamp(g, -GRADE_MAX, GRADE_MAX)) / MINETTI[5]);

/** Facteur sans le plancher de 0,80 (la courbe de laboratoire, pour la table du § 3.3). */
export const rawGradeFactor = (g: number) => minettiCost(clamp(g, -GRADE_MAX, GRADE_MAX)) / MINETTI[5];

// ─── Entrée ───

export interface RunDetails {
  hr?: HrPoint[];
  splits?: Split[];
  cadenceAvg?: number;
  elevGainM?: number;
  elevLossM?: number;
  events?: PauseEvent[];
  indoor?: boolean;
  effort?: number;
  weather?: { tempC?: number; humidityPct?: number };
}

export interface RunInput {
  kind: LoadKind;
  minutes: number;
  distanceM?: number | null;
  hrAvg?: number | null;
  /** Effort noté après coup dans Mijote (prime sur celui de la montre). */
  effort?: number | null;
  details?: RunDetails | null;
}

export interface SplitRow {
  km: number;
  sec: number;
  /** Allure (s/km) et allure ajustée à la pente. */
  pace: number;
  gap: number;
  hrAvg: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
}

export type Decoupling =
  | { ok: true; value: number; drift: number; ef: [number, number]; speedChangePct: number; reading: "artefact" | "bon" | "correct" | "marque" }
  | { ok: false; reason: string };

export interface RunAnalysis {
  version: number;
  zonesKey: string;
  movingMin: number;
  runMin: number;
  walkMin: number;
  distanceKm: number | null;
  /** s/km */
  pace: number | null;
  gap: number | null;
  /** Secondes de course par zone (0 = sous les zones … 5), et la marche à part. */
  zoneSec: number[];
  walkSec: number;
  seiler: { easy: number; moderate: number; hard: number };
  splits: SplitRow[];
  load: number;
  loadSource: LoadSource;
  /** Pic de 30 s (FCmax observée), null si FC douteuse. */
  peak: number | null;
  doubtful: boolean;
  hrCoverage: number;
  ef: number | null;
  decoupling: Decoupling;
  vo2: number | null;
  /** Vitesse ajustée médiane en Z2 (m/s), pour la tendance. */
  z2Speed: number | null;
  /** Part du temps de course au-dessus de Z2. */
  hrHighShare: number | null;
  /** Plus longue course continue (min), pour la capacité du § 4.2. */
  continuousMin: number;
  /** Vitesse ajustée moyenne (m/s) : l'allure → FC des séances sans cardio. */
  speed: number | null;
  heat: boolean;
  tempC: number | null;
  effort: number | null;
}

type Class = "run" | "walk" | "stop";

/** Analyse complète d'une sortie. */
export function analyzeRun(run: RunInput, zones: Zones, refs: LoadRefs, pace: PaceFit | null = null): RunAnalysis {
  const d = run.details ?? {};
  const durationS = Math.round(run.minutes * 60);
  const splits = d.splits?.length ? d.splits : null;
  const motion = splits ? motionOf(splits, d.events, durationS) : null;
  const n = Math.max(durationS, motion?.speed.length ?? 0);
  const avgSpeed = run.distanceM && run.minutes > 0 ? run.distanceM / (run.minutes * 60) : null;

  // § 3.1 4 : course, marche, arrêt, seconde par seconde (vitesse par kilomètre faute de trace ; sans temps au
  // kilomètre, la vitesse moyenne de la sortie ou la cadence).
  const fallback: Class = run.kind === "marche" ? "walk" : avgSpeed != null ? (avgSpeed >= RUN_SPEED_MS ? "run" : "walk") : (d.cadenceAvg ?? 160) >= 140 ? "run" : "walk";
  const cls: Class[] = new Array(n);
  for (let s = 0; s < n; s++) {
    const v = motion?.speed[s];
    cls[s] = v == null ? (motion ? "stop" : fallback) : v < STOP_SPEED_MS ? "stop" : v >= RUN_SPEED_MS ? "run" : "walk";
  }

  // Vitesse ajustée par seconde : facteur de pente si le dénivelé est fiable (≥ 10 m/km en tout).
  const km = splits ? splits[splits.length - 1].km : run.distanceM ? run.distanceM / 1000 : null;
  const elevTotal = (d.elevGainM ?? 0) + (d.elevLossM ?? 0);
  const gradeOk = !d.indoor && km != null && km > 0 && elevTotal / km >= GRADE_MIN_ELEV_PER_KM && !!splits?.every((x) => x.elevGainM != null && x.elevLossM != null);
  const gapAt = (s: number): number | null => {
    const v = motion?.speed[s] ?? null;
    if (v == null) return cls[s] === "stop" ? null : avgSpeed;
    const g = gradeOk ? motion!.grade[s] : null;
    return v * (g != null ? gradeFactor(g) : 1);
  };

  // FC : 1 Hz, nettoyée ; la première minute est exclue des analyses.
  const cleaned = d.hr?.length ? clean(resample(d.hr, durationS), d.cadenceAvg) : null;
  const hr: Hz = cleaned ? cleaned.hr : [];
  const hrAt = (s: number) => (s >= HR_SKIP_FIRST_S && s < hr.length ? hr[s] : null);

  const zoneSec = [0, 0, 0, 0, 0, 0];
  let walkSec = 0;
  let runSec = 0;
  let moving = 0;
  let longest = 0;
  let streak = 0;
  for (let s = 0; s < n; s++) {
    const c = cls[s];
    if (c !== "stop") moving++;
    if (c === "walk") walkSec++;
    if (c === "run") {
      runSec++;
      streak++;
      longest = Math.max(longest, streak);
      const v = hrAt(s);
      if (v != null) zoneSec[zoneOf(v, zones)]++;
    } else streak = 0;
  }
  const seiler = { easy: 0, moderate: 0, hard: 0 };
  zoneSec.forEach((sec, k) => (seiler[seilerOf(k as ZoneIndex)] += sec));
  const hrRun = zoneSec.reduce((a, b) => a + b, 0);

  // Temps au kilomètre.
  const splitRows: SplitRow[] = (splits ?? []).map((x, i) => {
    const dist = x.km - (i ? splits![i - 1].km : 0);
    const g = gradeOk && dist * 1000 >= 100 ? (x.elevGainM! - x.elevLossM!) / (dist * 1000) : null;
    const p = x.sec / dist;
    const secs = motion ? motion.split.map((k, s) => (k === i ? hrAt(s) : null)).filter((v): v is number => v != null) : [];
    return {
      km: x.km,
      sec: x.sec,
      pace: Math.round(p),
      gap: Math.round(g != null ? p / gradeFactor(g) : p),
      hrAvg: x.hrAvg ?? (secs.length ? Math.round(mean(secs)!) : null),
      elevGainM: x.elevGainM ?? null,
      elevLossM: x.elevLossM ?? null,
    };
  });

  const distKm = km;
  const movingMin = moving / 60;
  const paceSec = distKm ? (moving || durationS) / distKm : null;
  const speeds = Array.from({ length: n }, (_, s) => (cls[s] === "stop" ? null : gapAt(s))).filter((v): v is number => v != null);
  const gapSpeed = speeds.length ? mean(speeds)! : null;

  const effort = run.effort ?? d.effort ?? null;
  const tempC = d.weather?.tempC ?? null;
  const heat = tempC != null && tempC >= HEAT_C;
  const { load, source } = sessionLoad({ kind: run.kind, minutes: run.minutes, hr: cleaned?.hr ?? null, hrAvg: run.hrAvg, effort, speed: gapSpeed }, refs, pace);

  // § 3.4 Section stable : sans les 10 premières minutes ni la marche de retour au calme.
  let end = n;
  while (end > 0 && cls[end - 1] !== "run") end--;
  const stable = (minS: number) => {
    const from = STABLE_SKIP_S;
    if (end - from < minS) return null;
    return { from, to: end };
  };
  const decoupling = decouple(stable(DECOUPLING_MIN_S), cls, hrAt, gapAt, zones);
  const ef = efOf(0, end, cls, hrAt, gapAt);

  // § 3.6 VO2max effective.
  let vo2: number | null = null;
  const sec20 = stable(VO2_MIN_S);
  if (sec20 && !heat) {
    const s = sectionStats(sec20.from, sec20.to, cls, hrAt, gapAt);
    if (s && s.runShare >= DECOUPLING_RUN_SHARE && s.hrCoverage >= DECOUPLING_HR_COVERAGE) {
      const x = reserveX(s.hr, refs);
      if (x >= VO2_MIN_X) vo2 = round(vo2Effective(s.speed * 60, x), 1);
    }
  }

  // § 3.8 Allure en Z2 : secondes de course à ±3 bpm du milieu de Z2, après 10 min, au moins 5 min.
  const z2 = zoneRange(zones, 2);
  const mid = (z2[0] + z2[1]) / 2;
  const z2Speeds: number[] = [];
  for (let s = STABLE_SKIP_S; s < n; s++) {
    const v = hrAt(s);
    const sp = gapAt(s);
    if (cls[s] === "run" && v != null && sp != null && motion && Math.abs(v - mid) <= Z2_PACE_BPM) z2Speeds.push(sp);
  }
  const z2Speed = z2Speeds.length >= Z2_PACE_MIN_S && !cleaned?.doubtful ? median(z2Speeds) : null;

  return {
    version: RUNNING_VERSION,
    zonesKey: zonesKey(zones),
    movingMin: round(movingMin, 1),
    runMin: round(runSec / 60, 1),
    walkMin: round(walkSec / 60, 1),
    distanceKm: distKm != null ? round(distKm, 2) : null,
    pace: paceSec != null ? Math.round(paceSec) : null,
    gap: gapSpeed ? Math.round(1000 / gapSpeed) : null,
    zoneSec,
    walkSec,
    seiler,
    splits: splitRows,
    load: round(load, 1),
    loadSource: source,
    peak: cleaned && !cleaned.doubtful ? peak30(cleaned.hr) : null,
    doubtful: !!cleaned?.doubtful,
    hrCoverage: cleaned && n ? round(hr.filter((v) => v != null).length / n, 3) : 0,
    ef: ef != null ? round(ef, 3) : null,
    decoupling,
    vo2,
    z2Speed: z2Speed != null ? round(z2Speed, 3) : null,
    hrHighShare: hrRun ? round((seiler.moderate + seiler.hard) / hrRun, 3) : null,
    continuousMin: round(longest / 60, 1),
    speed: gapSpeed != null ? round(gapSpeed, 3) : null,
    heat,
    tempC,
    effort,
  };
}

/** Moyennes d'un tronçon : vitesse ajustée (m/s), FC, parts de course et de FC mesurée. */
function sectionStats(from: number, to: number, cls: Class[], hrAt: (s: number) => number | null, gapAt: (s: number) => number | null) {
  let run = 0;
  let withHr = 0;
  let sp = 0;
  let spN = 0;
  let h = 0;
  for (let s = from; s < to; s++) {
    if (cls[s] === "run") run++;
    const v = hrAt(s);
    if (v != null) {
      withHr++;
      h += v;
    }
    const g = gapAt(s);
    if (g != null && cls[s] !== "stop") {
      sp += g;
      spN++;
    }
  }
  const len = to - from;
  if (!withHr || !spN || len <= 0) return null;
  return { speed: sp / spN, hr: h / withHr, runShare: run / len, hrCoverage: withHr / len };
}

/** EF = vitesse ajustée moyenne (m/min) ÷ FC moyenne. */
function efOf(from: number, to: number, cls: Class[], hrAt: (s: number) => number | null, gapAt: (s: number) => number | null): number | null {
  const s = sectionStats(from, to, cls, hrAt, gapAt);
  return s ? (s.speed * 60) / s.hr : null;
}

/** Découplage Pa:HR sur la section stable coupée en deux moitiés de même durée, avec ses conditions. */
function decouple(sec: { from: number; to: number } | null, cls: Class[], hrAt: (s: number) => number | null, gapAt: (s: number) => number | null, zones: Zones): Decoupling {
  if (!sec) return { ok: false, reason: "moins de 30 min de course après l’échauffement" };
  const all = sectionStats(sec.from, sec.to, cls, hrAt, gapAt);
  if (!all) return { ok: false, reason: "pas de FC ni d’allure sur la section" };
  if (all.runShare < DECOUPLING_RUN_SHARE) return { ok: false, reason: "trop de marche (marche-course)" };
  if (all.hrCoverage < DECOUPLING_HR_COVERAGE) return { ok: false, reason: "FC trop incomplète" };
  let easy = 0;
  let measured = 0;
  for (let s = sec.from; s < sec.to; s++) {
    const v = hrAt(s);
    if (v == null) continue;
    measured++;
    if (zoneOf(v, zones) <= 2) easy++;
  }
  if (easy / measured < DECOUPLING_EASY_SHARE) return { ok: false, reason: "pas assez de temps en endurance (Z1–Z2)" };
  const minutes: number[] = [];
  for (let m = sec.from; m + 60 <= sec.to; m += 60) {
    const xs = Array.from({ length: 60 }, (_, i) => gapAt(m + i)).filter((v): v is number => v != null);
    if (xs.length) minutes.push(mean(xs)!);
  }
  const cv = minutes.length > 1 ? sd(minutes)! / mean(minutes)! : 0;
  if (cv >= DECOUPLING_SPEED_CV) return { ok: false, reason: "allure trop irrégulière" };
  const half = Math.floor((sec.from + sec.to) / 2);
  const a = sectionStats(sec.from, half, cls, hrAt, gapAt);
  const b = sectionStats(half, sec.to, cls, hrAt, gapAt);
  if (!a || !b) return { ok: false, reason: "pas de FC ni d’allure sur une moitié" };
  const ef1 = (a.speed * 60) / a.hr;
  const ef2 = (b.speed * 60) / b.hr;
  const value = ((ef1 - ef2) / ef1) * 100;
  return {
    ok: true,
    value: round(value, 1),
    drift: Math.round(b.hr - a.hr),
    ef: [round(ef1, 3), round(ef2, 3)],
    speedChangePct: round(((b.speed - a.speed) / a.speed) * 100, 1),
    reading: decouplingReading(value),
  };
}

export function decouplingReading(v: number): "artefact" | "bon" | "correct" | "marque" {
  if (v < DECOUPLING_BANDS.artefact) return "artefact";
  if (v <= DECOUPLING_BANDS.good) return "bon";
  if (v <= DECOUPLING_BANDS.fair) return "correct";
  return "marque";
}

// ─── § 3.6 – 3.7 Daniels et Gilbert ───

/** Coût en oxygène de la course à v (m/min), mL/kg/min. */
export const vo2Cost = (v: number) => -4.6 + 0.182258 * v + 0.000104 * v * v;

/** VO2max effective : 3,5 + (VO2(v) − 3,5) / x̄ (réserve cardiaque ≈ réserve de VO2). */
export const vo2Effective = (v: number, x: number) => 3.5 + (vo2Cost(v) - 3.5) / x;

/** Part de la VO2max tenable pendant t minutes (course ou test à fond seulement). */
export const vo2Fraction = (t: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

/** VDOT d'une course à fond de `meters` en `seconds`. */
export const vdot = (meters: number, seconds: number) => vo2Cost(meters / (seconds / 60)) / vo2Fraction(seconds / 60);

/** Réduction du VDOT après un arrêt (table de VDOT O2 ; 0,944 retenu à 42 j avec autre sport). */
const DETRAIN_DAYS = [5, 7, 14, 28, 42, 56, 72];
const DETRAIN = { seul: [1, 0.994, 0.973, 0.931, 0.889, 0.847, 0.8], autre: [1, 0.997, 0.986, 0.965, 0.944, 0.923, 0.9] };
export function detraining(days: number, otherSport: boolean): number {
  const t = DETRAIN[otherSport ? "autre" : "seul"];
  if (days <= DETRAIN_DAYS[0]) return 1;
  for (let i = 1; i < DETRAIN_DAYS.length; i++) {
    if (days <= DETRAIN_DAYS[i]) {
      const k = (days - DETRAIN_DAYS[i - 1]) / (DETRAIN_DAYS[i] - DETRAIN_DAYS[i - 1]);
      return round(t[i - 1] + (t[i] - t[i - 1]) * k, 3);
    }
  }
  return t[t.length - 1];
}

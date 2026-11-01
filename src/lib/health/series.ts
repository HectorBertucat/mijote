// Séries de la vue d'ensemble de Santé : périodes, regroupement par jour, semaine ou mois, moyennes
// glissantes, comparaisons et la phrase de synthèse. Pur et testé (tests/sante-series.test.ts) ; la base
// ne fait que regrouper en SQL (./overview.ts), avec les mêmes bornes de semaine et de mois qu'ici.
import { trendSeries, type TrendPoint } from "./core";
import { addDays } from "@/lib/week/propose";

export type Grain = "day" | "week" | "month";
export type PeriodKey = "7j" | "30j" | "3m" | "1an" | "tout";

/** Les périodes de la vue d'ensemble ; `grain` regroupe les barres (les courbes restent au jour jusqu'à un an : `lineGrainOf`). */
export const PERIODS: { key: PeriodKey; label: string; long: string; days: number | null; grain: Grain }[] = [
  { key: "7j", label: "7 j", long: "les 7 derniers jours", days: 7, grain: "day" },
  { key: "30j", label: "30 j", long: "les 30 derniers jours", days: 30, grain: "day" },
  { key: "3m", label: "3 mois", long: "les 3 derniers mois", days: 91, grain: "week" },
  { key: "1an", label: "1 an", long: "la dernière année", days: 364, grain: "week" },
  { key: "tout", label: "Tout", long: "tout l’historique", days: null, grain: "month" },
];
export const DEFAULT_PERIOD: PeriodKey = "30j";

export const isPeriod = (v: unknown): v is PeriodKey => PERIODS.some((p) => p.key === v);

export interface Period {
  key: PeriodKey;
  label: string;
  long: string;
  /** Premier et dernier jour (inclus). */
  from: string;
  to: string;
  grain: Grain;
}

/**
 * Le pas des courbes (cœur) : au jour tant que les barres sont au jour ou à la semaine (un an au plus de
 * points), au mois avec elles sur plusieurs années (des centaines de semaines ne se lisent pas, et pèsent).
 */
export const lineGrainOf = (grain: Grain): Grain => (grain === "month" ? "month" : "day");

/** La fenêtre de la moyenne glissante d'une courbe : 7 jours, 4 semaines ou 3 mois. */
export const ROLLING: Record<Grain, number> = { day: 7, week: 4, month: 3 };

export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * La période choisie, jusqu'à aujourd'hui. « Tout » part de la première donnée (`first`) ; sous deux ans
 * d'historique, ses barres restent à la semaine plutôt qu'au mois.
 */
export function periodOf(key: PeriodKey, today: string, first?: string | null): Period {
  const p = PERIODS.find((x) => x.key === key) ?? PERIODS[1];
  if (p.days != null) {
    // Les semaines et les mois commencent un lundi : la première barre est entière.
    const raw = addDays(today, -(p.days - 1));
    return { key: p.key, label: p.label, long: p.long, from: p.grain === "week" ? bucketOf(raw, "week") : raw, to: today, grain: p.grain };
  }
  const from = first && first < today ? first : addDays(today, -29);
  const span = dayDiff(from, today);
  const grain: Grain = span > 730 ? "month" : span > 90 ? "week" : "day";
  return { key: p.key, label: p.label, long: p.long, from: bucketOf(from, grain), to: today, grain };
}

/** Le début du paquet d'un jour : le jour même, le lundi de sa semaine, le premier du mois. */
export function bucketOf(date: string, grain: Grain): string {
  if (grain === "day") return date;
  if (grain === "month") return `${date.slice(0, 7)}-01`;
  const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -wd);
}

/** Le paquet suivant. */
export function nextBucket(start: string, grain: Grain): string {
  if (grain === "day") return addDays(start, 1);
  if (grain === "week") return addDays(start, 7);
  const [y, m] = start.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Les débuts de paquet de `from` à `to` inclus. */
export function bucketsBetween(from: string, to: string, grain: Grain): string[] {
  const out: string[] = [];
  for (let b = bucketOf(from, grain); b <= to; b = nextBucket(b, grain)) out.push(b);
  return out;
}

export interface Bucket {
  start: string;
  /** Dernier jour du paquet, borné à la période. */
  end: string;
  /** Moyenne par jour mesuré (`mean`) ou total (`sum`) ; null sans donnée. */
  value: number | null;
  /** Jours avec une donnée. */
  n: number;
  /** Le paquet n'est pas fini : c'est celui d'aujourd'hui, le dernier de la période. */
  partial: boolean;
}

/** Ce que renvoie le regroupement SQL : un paquet, la somme et le nombre de jours mesurés. */
export interface BucketRow {
  bucket: string;
  total: number;
  n: number;
}

/**
 * Paquets de la période, trous compris (value null). `mean` : moyenne par jour mesuré (pas, énergie,
 * sommeil) ; `sum` : total du paquet (minutes d'activité).
 */
export function fillBuckets(rows: BucketRow[], period: Pick<Period, "from" | "to" | "grain">, mode: "mean" | "sum"): Bucket[] {
  const by = new Map(rows.map((r) => [r.bucket, r]));
  return bucketsBetween(period.from, period.to, period.grain).map((start) => {
    const r = by.get(start);
    const next = nextBucket(start, period.grain);
    const end = addDays(next, -1) < period.to ? addDays(next, -1) : period.to;
    const value = r && r.n > 0 ? (mode === "mean" ? r.total / r.n : r.total) : null;
    return { start, end, value, n: r?.n ?? 0, partial: end === period.to };
  });
}

/** Le même regroupement que le SQL de ./overview.ts, sur des valeurs datées (tests, séances). */
export function groupRows(points: { date: string; value: number }[], grain: Grain): BucketRow[] {
  const by = new Map<string, { total: number; days: Set<string> }>();
  for (const p of points) {
    const b = bucketOf(p.date, grain);
    const cur = by.get(b) ?? { total: 0, days: new Set<string>() };
    cur.total += p.value;
    cur.days.add(p.date);
    by.set(b, cur);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, x]) => ({ bucket, total: x.total, n: x.days.size }));
}

/** Moyenne glissante (fenêtre de `window` points, qui finit au point), des valeurs présentes seulement. */
export function rollingMean(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - window + 1); k <= i; k++) {
      const v = values[k];
      if (v != null) {
        s += v;
        n++;
      }
    }
    return n ? s / n : null;
  });
}

/** Valeurs datées → une valeur par jour de `from` à `to` (null les jours sans donnée ; moyenne si plusieurs). */
export function daily(points: { date: string; value: number }[], from: string, to: string): { date: string; value: number | null }[] {
  const rows = groupRows(points.filter((p) => p.date >= from && p.date <= to), "day");
  const by = new Map(rows.map((r) => [r.bucket, r.total / r.n]));
  const out: { date: string; value: number | null }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, value: by.get(d) ?? null });
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Moyenne des jours mesurés entre `from` et `to` inclus. */
export function meanBetween(points: { date: string; value: number }[], from: string, to: string): number | null {
  return mean(groupRows(points.filter((p) => p.date >= from && p.date <= to), "day").map((r) => r.total / r.n));
}

export interface Recent {
  /** Moyenne des `days` derniers jours (complets : la veille et avant, aujourd'hui n'est pas fini). */
  now: number | null;
  /** Moyenne des 28 jours d'avant. */
  before: number | null;
  /** Écart relatif, en %, si les deux existent. */
  pct: number | null;
}

/**
 * Les `days` derniers jours face aux quatre semaines d'avant. `complete` : la journée en cours ne compte
 * pas (pas, énergie : elle n'est pas finie) ; sinon elle compte (FC au repos, mesurée le matin).
 */
export function recent(points: { date: string; value: number }[], today: string, days = 7, complete = true): Recent {
  const end = complete ? addDays(today, -1) : today;
  const start = addDays(end, -(days - 1));
  const now = meanBetween(points, start, end);
  const before = meanBetween(points, addDays(start, -28), addDays(start, -1));
  return { now, before, pct: now != null && before ? ((now - before) / before) * 100 : null };
}

// ─── Poids : la tendance, la fourchette des pesées, regroupées au besoin ───

export interface WeightPoint {
  date: string;
  /** Pesée du jour (moyenne des pesées du paquet en semaines). */
  kg: number | null;
  trend: number;
  /** Fourchette des pesées : 7 derniers jours (au jour) ou le paquet (semaine, mois). */
  lo: number | null;
  hi: number | null;
}

/** Le pas de la courbe du poids : au jour jusqu'à un peu plus d'un an, puis à la semaine, au mois avec les barres sur plusieurs années. */
export function weightGrain(period: Pick<Period, "from" | "to"> & { grain?: Grain }): Grain {
  if (dayDiff(period.from, period.to) <= 400) return "day";
  return period.grain === "month" ? "month" : "week";
}

/**
 * La courbe du poids sur la période : la tendance (moyenne exponentielle de l'appli) calculée sur tout
 * l'historique pour être juste dès le premier jour, puis coupée. Au-delà d'un an, un point par semaine (par
 * mois sur plusieurs années : `weightGrain`). `series` : la même tendance si elle est déjà calculée (jusqu'à `period.to`).
 */
export function weightView(dailyKg: { date: string; kg: number }[], period: Pick<Period, "from" | "to"> & { grain?: Grain }, series: TrendPoint[] = trendSeries(dailyKg, period.to)): WeightPoint[] {
  const first = series.findIndex((p) => p.date >= period.from);
  const inRange = first < 0 ? [] : series.slice(first).filter((p) => p.date <= period.to);
  const grain = weightGrain(period);
  if (grain === "day") {
    return inRange.map((p, k) => {
      const i = first + k;
      const win = series.slice(Math.max(0, i - 6), i + 1).flatMap((x) => (x.kg != null ? [x.kg] : []));
      return { date: p.date, kg: p.kg, trend: p.trend, lo: win.length ? Math.min(...win) : null, hi: win.length ? Math.max(...win) : null };
    });
  }
  const by = new Map<string, TrendPoint[]>();
  for (const p of inRange) {
    const b = bucketOf(p.date, grain);
    const xs = by.get(b);
    if (xs) xs.push(p);
    else by.set(b, [p]);
  }
  return [...by.entries()].map(([start, pts]) => {
    const kgs = pts.flatMap((x) => (x.kg != null ? [x.kg] : []));
    return { date: start, kg: mean(kgs), trend: pts[pts.length - 1].trend, lo: kgs.length ? Math.min(...kgs) : null, hi: kgs.length ? Math.max(...kgs) : null };
  });
}

// ─── Séances ───

export interface Activity {
  date: string;
  /** Instant de début (ISO) si connu, pour l'ordre dans la journée. */
  at: string | null;
  label: string;
  minutes: number | null;
  distanceM: number | null;
  kcal: number | null;
  source: "carnet" | "apple";
}

/** Minutes d'activité par jour (séances), pour le calendrier de régularité. */
export function minutesByDay(acts: Activity[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of acts) out.set(a.date, (out.get(a.date) ?? 0) + (a.minutes ?? 30));
  return out;
}

export interface TypeStack {
  /** Les types gardés, du plus pratiqué au moins pratiqué ; le reste est réuni sous « Autre ». L'ordre donne la couleur. */
  types: string[];
  /** Minutes de chaque type sur la période (les types absents de la période n'y sont pas). */
  totals: Record<string, number>;
  buckets: (Bucket & { parts: Record<string, number> })[];
}

export const OTHER = "Autre";

/**
 * Temps par type de séance et par paquet : les `top` types les plus longs, le reste en « Autre ». Le
 * classement se fait sur toutes les séances reçues, pas sur la période : un type garde sa couleur quand
 * on change de période.
 */
export function minutesByType(acts: Activity[], period: Pick<Period, "from" | "to" | "grain">, top = 4): TypeStack {
  const inRange = acts.filter((a) => a.date >= period.from && a.date <= period.to);
  const totals = new Map<string, number>();
  for (const a of acts) totals.set(a.label, (totals.get(a.label) ?? 0) + (a.minutes ?? 0));
  const ranked = [...totals.entries()].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  // Un seul type de trop ne fait pas un « Autre » : on le garde.
  const types = ranked.length <= top + 1 ? ranked : [...ranked.slice(0, top), OTHER];
  const keyOf = (label: string) => (types.includes(label) ? label : OTHER);
  const empty = fillBuckets([], period, "sum");
  const buckets = empty.map((b) => ({ ...b, parts: {} as Record<string, number> }));
  for (const a of inRange) {
    const b = buckets.find((x) => a.date >= x.start && a.date <= x.end);
    if (!b || !a.minutes) continue;
    const k = keyOf(a.label);
    b.parts[k] = (b.parts[k] ?? 0) + a.minutes;
    b.value = (b.value ?? 0) + a.minutes;
    b.n++;
  }
  const sums: Record<string, number> = {};
  for (const b of buckets) for (const [k, m] of Object.entries(b.parts)) sums[k] = (sums[k] ?? 0) + m;
  return { types, totals: sums, buckets };
}

/** Séances des `days` derniers jours (aujourd'hui compris) : nombre et minutes. */
export function sessionsSince(acts: Activity[], today: string, days = 7) {
  const from = addDays(today, -(days - 1));
  const xs = acts.filter((a) => a.date >= from && a.date <= today);
  return { count: xs.length, minutes: Math.round(xs.reduce((s, a) => s + (a.minutes ?? 0), 0)) };
}

// ─── La phrase de synthèse ───

const NB = "\u00a0";
const NNB = "\u202f";
const int = (v: number) => Math.round(v).toLocaleString("fr-FR");
const hmin = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}${NB}h${m ? `${NB}${String(m).padStart(2, "0")}` : ""}` : `${m}${NB}min`;
};
/** « 12 % de plus », « 8 % de moins », « autant » sous 5 % d'écart. */
function versus(pct: number | null): string | null {
  if (pct == null) return null;
  if (Math.abs(pct) < 5) return "autant que le mois d’avant";
  return `${Math.round(Math.abs(pct))}${NB}% de ${pct > 0 ? "plus" : "moins"} que le mois d’avant`;
}

export interface SynthesisInput {
  steps?: Recent | null;
  activeKcal?: Recent | null;
  sessions?: { count: number; minutes: number; perWeek: number } | null;
  sleepMin?: number | null;
  restingHr?: Recent | null;
  trendKg?: number | null;
  rateKg?: number | null;
}

/**
 * Deux à quatre phrases courtes qui disent « comment je vais » à partir des chiffres seuls : l'activité
 * de la semaine, les séances face au plan, le sommeil, le cœur s'il a bougé. Rien quand rien n'est mesuré.
 */
export function synthesis(x: SynthesisInput): string[] {
  const out: string[] = [];
  if (x.steps?.now != null) {
    const vs = versus(x.steps.pct);
    out.push(`En moyenne ${int(x.steps.now)}${NB}pas par jour sur 7 jours${vs ? `, ${vs}` : ""}.`);
  } else if (x.activeKcal?.now != null) {
    const vs = versus(x.activeKcal.pct);
    out.push(`En moyenne ${int(x.activeKcal.now)}${NB}kcal d’activité par jour sur 7 jours${vs ? `, ${vs}` : ""}.`);
  }
  if (x.sessions) {
    const { count, minutes, perWeek } = x.sessions;
    if (count === 0) out.push(perWeek ? `Aucune séance ces 7 derniers jours, ${perWeek} prévue${perWeek > 1 ? "s" : ""} par semaine.` : "Aucune séance ces 7 derniers jours.");
    else {
      const plan = perWeek ? (count >= perWeek ? ", le plan est tenu" : `, ${perWeek} prévue${perWeek > 1 ? "s" : ""}`) : "";
      out.push(`${count} séance${count > 1 ? "s" : ""} en 7 jours (${hmin(minutes)})${plan}.`);
    }
  }
  if (x.sleepMin != null) out.push(`${hmin(x.sleepMin)} de sommeil par nuit${x.sleepMin < 7 * 60 ? ", un peu court" : ""}.`);
  if (x.restingHr?.now != null && x.restingHr.before != null && Math.abs(x.restingHr.now - x.restingHr.before) >= 3) {
    const d = Math.round(x.restingHr.now - x.restingHr.before);
    out.push(
      d > 0
        ? `Cœur au repos plus haut que le mois d’avant (+${d}${NB}bpm)${NB}: fatigue, rhume ou manque de sommeil${NNB}?`
        : `Cœur au repos plus bas que le mois d’avant (−${-d}${NB}bpm).`
    );
  }
  if (x.trendKg != null && x.rateKg != null) {
    const r = Math.abs(x.rateKg) < 0.05 ? "stable" : `${x.rateKg > 0 ? "+" : "−"}${Math.abs(x.rateKg).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${NB}kg par semaine`;
    out.push(`Poids ${x.trendKg.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${NB}kg en tendance, ${r}.`);
  }
  return out;
}

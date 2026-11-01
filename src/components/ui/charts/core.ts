// Le calcul commun des graphiques (échelles, graduations, dates, nombres). Pur, sans React : utilisable
// côté serveur et dans l'île client. Testé dans tests/charts.test.ts.
import { dayString, weekdayOf } from "@/lib/days";

export const NB = " ";
export const NNB = " ";

/** Une couleur de série : une variable du thème (cuisine-tokens.css), jamais une couleur en dur. */
export type VizColor = `var(--c-${string})`;

/** Les teintes des types de séance, dans l'ordre (validées clair et sombre) ; « Autre » en gris. */
export const VIZ_CAT: VizColor[] = ["var(--c-viz-cat-1)", "var(--c-viz-cat-2)", "var(--c-viz-cat-3)", "var(--c-viz-cat-4)", "var(--c-viz-cat-5)"];
export const VIZ_OTHER: VizColor = "var(--c-viz-other)";
/** Rampe de régularité (peu → beaucoup), le niveau 0 est le creux du papier. */
export const VIZ_HEAT: VizColor[] = ["var(--c-surface-2)", "var(--c-viz-heat-1)", "var(--c-viz-heat-2)", "var(--c-viz-heat-3)", "var(--c-viz-heat-4)", "var(--c-viz-heat-5)"];
/** Phases du sommeil, du plus profond au plus léger. */
export const VIZ_SLEEP = { deep: "var(--c-viz-sleep-deep)", core: "var(--c-viz-sleep-core)", rem: "var(--c-viz-sleep-rem)", awake: "var(--c-viz-sleep-awake)" } as const satisfies Record<string, VizColor>;
/** Zones cardiaques 1 à 5 (rampe ordinale). */
export const VIZ_ZONE: VizColor[] = ["var(--c-viz-zone-1)", "var(--c-viz-zone-2)", "var(--c-viz-zone-3)", "var(--c-viz-zone-4)", "var(--c-viz-zone-5)"];

// Un formateur par réglage, gardé : `toLocaleString` avec des options en crée un à chaque appel (~30 µs),
// et un graphique de plusieurs années formate des milliers de valeurs et de dates.
const numFmts = new Map<number, Intl.NumberFormat>();
const dayFmts = new Map<string, Intl.DateTimeFormat>();

/** « 8 400 », « 81,2 » : chiffres à la française (espace fine insécable pour les milliers). */
export function fmt(v: number, digits = 0) {
  let f = numFmts.get(digits);
  if (!f) numFmts.set(digits, (f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })));
  return f.format(v);
}
/**
 * Gros chiffre (Archivo serrée, `.num-tight`) : l'espace fine des milliers s'y réduit à presque rien (« 9472 »),
 * elle devient une insécable (« 9 472 »). Un nombre est d'abord formaté ; un autre contenu passe tel quel.
 */
export function bigNum<T>(v: T): T | string {
  if (typeof v === "number") return bigNum(fmt(v, Number.isInteger(v) ? 0 : 1));
  return typeof v === "string" ? v.replace(/(\d)\u202f(?=\d{3}(?!\d))/g, `$1${NB}`) : v;
}
/** Graduation courte : « 12 k » au-delà de 10 000 ; les décimales (`digits` au plus) seulement si le repère en a. */
export const tickText = (v: number, digits = 0) => (Math.abs(v) >= 10_000 ? `${fmt(v / 1000, v % 1000 ? 1 : 0)}${NNB}k` : fmt(v, Number.isInteger(v) ? 0 : digits));
/** « 7 h 05 » à partir de minutes. */
export const hmin = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}${NB}h${NB}${String(m).padStart(2, "0")}` : `${m}${NB}min`;
};

/** Pas « rond » (1, 2, 2,5, 5 × 10ⁿ) pour environ `count` intervalles. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const r = raw / pow;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * pow;
}

/**
 * Domaine et graduations d'un axe vertical : les bornes arrondies au pas, avec 0 en bas si `zero` (barres :
 * une barre part toujours de zéro). Un seul point ou une série plate s'ouvrent autour de leur valeur.
 */
export function niceDomain(values: (number | null | undefined)[], { zero = false, count = 4, minSpan = 0 }: { zero?: boolean; count?: number; minSpan?: number } = {}) {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  let lo = xs.length ? Math.min(...xs) : 0;
  let hi = xs.length ? Math.max(...xs) : 1;
  if (zero) lo = Math.min(0, lo);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = zero ? lo : mid - minSpan / 2;
    hi = zero ? lo + minSpan : mid + minSpan / 2;
  }
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo, count);
  const dlo = zero && lo >= 0 ? 0 : Math.floor(lo / step) * step;
  const dhi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = dlo; v <= dhi + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo: dlo, hi: dhi === dlo ? dlo + step : dhi, ticks, step };
}

/** Position relative (0 en bas, 1 en haut) d'une valeur dans un domaine. */
export const frac = (v: number, lo: number, hi: number) => (hi === lo ? 0.5 : (v - lo) / (hi - lo));

/** Jour → nombre de jours depuis 1970 (abscisse d'une courbe datée). */
export const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const fromNum = dayString;
/** Le jour `n` jours plus tard (ou plus tôt). */
export const shiftDay = (d: string, n: number) => fromNum(dayNum(d) + n);

/** « 3 nov. », « nov. », « 2025 », « lun. 3 nov. ». */
export function fmtDay(d: string, style: "day" | "month" | "year" | "weekday" | "full" = "day") {
  const opts: Intl.DateTimeFormatOptions =
    style === "month" ? { month: "short" } : style === "year" ? { year: "numeric" } : style === "weekday" ? { weekday: "short", day: "numeric", month: "short" } : style === "full" ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" };
  return dateFmt(style, opts).format(Date.parse(`${d}T12:00:00Z`));
}

/** Le formateur de dates (fr-FR, UTC) d'un style, créé une fois. */
export function dateFmt(style: string, opts: Intl.DateTimeFormatOptions) {
  let f = dayFmts.get(style);
  if (!f) dayFmts.set(style, (f = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", ...opts })));
  return f;
}

/**
 * Repères d'un axe de dates : des jours (une semaine), des lundis (un à trois mois), des débuts de mois (un
 * an), des débuts d'année (plus long). Au plus `max` repères (sauf les jours d'une semaine), les plus proches de
 * la fin gardés.
 */
export function dateTicks(from: string, to: string, max = 6): { date: string; label: string }[] {
  const span = dayNum(to) - dayNum(from);
  const all: { date: string; label: string }[] = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) {
    const d = fromNum(n);
    const wd = weekdayOf(n);
    if (span <= 10) all.push({ date: d, label: fmtDay(d, "weekday").split(" ")[0] });
    else if (span <= 120) {
      if (wd === 1) all.push({ date: d, label: fmtDay(d) });
    } else if (span <= 800) {
      if (d.endsWith("-01")) all.push({ date: d, label: d.slice(5, 7) === "01" ? d.slice(0, 4) : fmtDay(d, "month") });
    } else if (d.endsWith("-01-01")) all.push({ date: d, label: d.slice(0, 4) });
  }
  // Une semaine : chaque jour a son repère (sept lettres courtes tiennent partout).
  if (all.length <= max || span <= 10) return all;
  const every = Math.ceil(all.length / max);
  // On compte depuis la fin : le repère le plus récent reste.
  return all.filter((_, i) => (all.length - 1 - i) % every === 0);
}

/** Chemin SVG d'une ligne, coupé aux trous (null). `x` et `y` sont déjà dans le repère du dessin. */
export function linePath(pts: { x: number; y: number | null }[]): string {
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (p.y == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${r2(p.x)} ${r2(p.y)}`;
    pen = true;
  }
  return d;
}

/** Chemin d'une bande (entre `lo` et `hi`), en morceaux aux trous. */
export function bandPath(pts: { x: number; lo: number | null; hi: number | null }[]): string {
  const runs: { x: number; lo: number; hi: number }[][] = [];
  let cur: { x: number; lo: number; hi: number }[] = [];
  for (const p of pts) {
    if (p.lo == null || p.hi == null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push({ x: p.x, lo: p.lo, hi: p.hi });
  }
  if (cur.length) runs.push(cur);
  return runs
    .filter((r) => r.length > 1)
    .map((r) => `M${r.map((p) => `${r2(p.x)} ${r2(p.hi)}`).join("L")}L${[...r].reverse().map((p) => `${r2(p.x)} ${r2(p.lo)}`).join("L")}Z`)
    .join("");
}

/** Points isolés : un segment de longueur nulle à bouts ronds par point (le trait garde sa taille à l'écran). */
export function dotsPath(pts: { x: number; y: number | null }[]): string {
  return pts.map((p) => (p.y == null ? "" : `M${r2(p.x)} ${r2(p.y)}h0`)).join("");
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Le point le plus proche d'une abscisse relative (0–1) dans une liste triée. */
export function nearest(xs: number[], f: number): number {
  if (!xs.length) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < f) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - f) <= Math.abs(xs[hi] - f) ? lo : hi;
}

/** Niveau d'une valeur : le nombre de seuils (croissants) qu'elle atteint, 0 sous le premier. */
export const levelOf = (v: number | null | undefined, levels: number[]) => (v == null ? 0 : levels.filter((t) => v >= t).length);

/** Une ligne d'infobulle : la valeur d'abord, le nom ensuite, la marque de la série à côté. */
export interface TipRow {
  value: string;
  label?: string;
  color?: string;
  shape?: "line" | "rect" | "dot";
}
export interface Tip {
  title: string;
  rows: TipRow[];
}
/** La ligne d'une barre sans mesure. */
export const NO_DATA = "pas de mesure";
const empty = (t: Tip) => t.rows.length === 0 || (t.rows.length === 1 && t.rows[0].value === NO_DATA && !t.rows[0].label);

/**
 * Les lignes du tableau pour les lecteurs d'écran : une par point, mais une suite de points sans mesure en
 * une seule ligne (« février 2019 – avril 2021 ») ; un historique de plusieurs années en a des centaines.
 */
export function tableRows(tips: Tip[]): Tip[] {
  const out: Tip[] = [];
  for (let i = 0; i < tips.length; i++) {
    let j = i;
    if (empty(tips[i])) while (j + 1 < tips.length && empty(tips[j + 1])) j++;
    out.push(j > i ? { title: `${tips[i].title} – ${tips[j].title}`, rows: tips[i].rows } : tips[i]);
    i = j;
  }
  return out;
}

/** Texte d'une infobulle pour les lecteurs d'écran. */
export const tipText = (t: Tip) => `${t.title}${NB}: ${t.rows.map((r) => (r.label ? `${r.label} ${r.value}` : r.value)).join(", ")}`;

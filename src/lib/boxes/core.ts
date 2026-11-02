// Les boîtes et ce que partage la réserve (src/lib/reserve/core.ts) : le rapport féculent / plat d'une
// portion, la marge qui grossit chaque part jusqu'à son plafond, une base commune pesée en une fois, les
// dates limites et le rangement. Module pur (tests/boxes.test.ts).
//
// Règles :
// - le rapport féculent / plat d'une portion est celui de la marmite tant que les protéines atteignent le
//   bas du repère ; s'il en manque, moins de féculent et plus de plat (jusqu'à la moitié du rapport de la
//   marmite). Jamais plus de féculent que la marmite : un surplus de protéines ne se compense pas par du
//   féculent (sideRatio) ;
// - ce qui reste une fois chacun à sa part grossit chaque part d'autant, jusqu'au haut de son repère (fillUp) ;
// - une boîte au frigo se garde les jours de conservation de la recette, au congélateur trois mois,
//   décongelée jusqu'au lendemain.

export type SplitMode = "simple" | "cible" | "borne";

/** Garniture / plat d'une personne : entre la moitié du rapport de la marmite et ce rapport. */
export const SIDE_RATIO_MIN = 0.5;
/** Une portion de marge n'est faite que s'il reste au moins 3/4 d'une part. */
export const MARGIN_MIN_SHARE = 0.75;
/** Au-delà de 3 % au-dessus des repères, le surplus reste « pour qui veut ». */
export const KCAL_OVER_MAX = 0.03;
/** Grammes arrondis à 5 g : la balance de cuisine ne fait pas mieux. */
export const GRAM_STEP = 5;
export const DEFAULT_FRIDGE_DAYS = 3;
/** Au congélateur : trois mois. Décongelée au frigo : à manger sous 24 h. */
export const FREEZER_DAYS = 90;
export const THAWED_DAYS = 1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Une base cuite pour plusieurs recettes (le riz de deux recettes dans le même faitout), pesée en une
 * fois : la part de chacune au prorata de ce qu'elle a mis cru (`share`), à 5 g près, la somme juste.
 */
export function splitShared<K extends string>(totalG: number, shares: { key: K; share: number }[]): Record<K, number> {
  const sum = shares.reduce((x, s) => x + Math.max(0, s.share), 0) || 1;
  const steps = Math.round(Math.max(0, totalG) / GRAM_STEP);
  const raw = shares.map((s) => (steps * Math.max(0, s.share)) / sum);
  const out = raw.map(Math.floor);
  // Le reste aux plus grandes parts décimales (la somme retombe sur le total pesé).
  const order = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f);
  const left = steps - out.reduce((x, y) => x + y, 0);
  for (let k = 0; k < left; k++) out[order[k % order.length].i]++;
  return Object.fromEntries(shares.map((s, i) => [s.key, out[i] * GRAM_STEP])) as Record<K, number>;
}

/**
 * Rapport garniture / plat (en grammes) d'une boîte qui vise `target.kcal` : celui de la marmite si les
 * protéines atteignent `proteinMin`, sinon moins de garniture pour viser `protein` (le milieu), borné.
 */
export function sideRatio(
  target: { kcal: number; protein: number; proteinMin: number },
  dish: { kcalG: number; proteinG: number },
  side: { kcalG: number; proteinG: number },
  potRatio: number
): { ratio: number; mode: SplitMode } {
  const lo = potRatio * SIDE_RATIO_MIN;
  // Densités en protéines par kcal : celle du mélange glisse de la garniture au plat quand le rapport baisse.
  const q = target.protein / target.kcal;
  const qd = dish.proteinG / dish.kcalG;
  const qs = side.proteinG / side.kcalG;
  if (!Number.isFinite(q) || !Number.isFinite(qd) || !Number.isFinite(qs) || !(potRatio > 0)) return { ratio: potRatio, mode: "simple" };
  const proteinAt = (t: number) => (target.kcal * (dish.proteinG + t * side.proteinG)) / (dish.kcalG + t * side.kcalG);
  // Assez de protéines avec la proportion de la marmite, ou un plat pas plus protéiné que la garniture : on n'y touche pas.
  if (proteinAt(potRatio) >= target.proteinMin || qd <= qs + 1e-6) return { ratio: potRatio, mode: "simple" };
  // q = (pd + t·ps) / (kd + t·ks)  ⇔  t = (pd − q·kd) / (q·ks − ps)
  const t = (dish.proteinG - q * dish.kcalG) / (q * side.kcalG - side.proteinG);
  // Plus de protéines que le plat seul n'en donne : le moins de garniture permis.
  if (!Number.isFinite(t) || t < 0) return { ratio: lo, mode: "borne" };
  const bounded = clamp(t, lo, potRatio);
  return { ratio: bounded, mode: Math.abs(bounded - t) > 1e-9 ? "borne" : "cible" };
}

/**
 * Ce qui reste une fois les boîtes à leur part visée (`left` unités) : chacune grossit d'autant (même
 * facteur), sans dépasser son plafond ; une boîte au plafond laisse le reste aux autres. Renvoie les
 * unités de chaque boîte et ce qui ne tient nulle part.
 */
export function fillUp(parts: { units: number; cap: number }[], left: number): { units: number[]; over: number } {
  const units = parts.map((p) => p.units);
  const full = parts.map((p) => p.units >= p.cap);
  for (let guard = 0; guard <= parts.length; guard++) {
    const free = parts.reduce((s, p, i) => s + (full[i] ? 0 : p.units), 0);
    const room = parts.reduce((s, p, i) => s + (full[i] ? Math.max(p.cap, p.units) : 0), 0);
    const total = parts.reduce((s, p) => s + p.units, 0) + left;
    if (free <= 0) return { units: parts.map((p) => Math.max(p.cap, p.units)), over: Math.max(0, total - room) };
    const f = (total - room) / free;
    const capped = parts.map((p, i) => !full[i] && p.units * f > p.cap);
    if (!capped.some(Boolean)) return { units: parts.map((p, i) => (full[i] ? Math.max(p.cap, p.units) : p.units * f)), over: 0 };
    capped.forEach((c, i) => c && (full[i] = true));
  }
  return { units, over: left };
}

// ─── Rangement et dates limites ───

export type Place = "fridge" | "freezer";

const addDays = (date: string, n: number) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export interface StoredBox {
  place: Place;
  cookedOn: string;
  fridgeDays: number;
  frozenOn: string | null;
  thawedOn: string | null;
}

/** Date limite d'une boîte : cuisson + jours au frigo ; congelée : trois mois ; décongelée : le lendemain. */
export function limitOf(b: StoredBox): string {
  if (b.place === "freezer") return addDays(b.frozenOn ?? b.cookedOn, FREEZER_DAYS);
  const fridge = addDays(b.cookedOn, b.fridgeDays);
  if (b.thawedOn) return addDays(b.thawedOn, THAWED_DAYS);
  return fridge;
}

/** « ok », « bientôt » (aujourd'hui ou demain), « passée ». */
export function freshness(limit: string, today: string): "ok" | "soon" | "past" {
  const d = daysBetween(today, limit);
  return d < 0 ? "past" : d <= 1 ? "soon" : "ok";
}

/** Le repas du journal où ranger une boîte mangée maintenant (heure de Paris). */
export function mealAt(hour: number): "lunch" | "dinner" | "snack" {
  if (hour >= 10 && hour < 16) return "lunch";
  if (hour >= 17) return "dinner";
  return "snack";
}

/** « 480 g », « 1,2 kg ». */
export const gramsLabel = (g: number) => (g >= 1000 ? `${(Math.round(g / 100) / 10).toLocaleString("fr-FR")} kg` : `${Math.round(g)} g`);

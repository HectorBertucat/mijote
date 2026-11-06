// Les mangeurs et leur part : combien d'unités d'une recette chacun mange, tiré de sa cible
// (Santé) et des macros de la recette. Module pur, sans accès à la base (tests/eaters.test.ts).
//
// Règles :
// - repère d'un repas du batch = (cible du jour ± tolérance − ce que la personne mange hors
//   batch) / 2, comme le bilan de la Semaine (week/nutrition.ts, dayRef) ;
// - unités d'une recette : au demi près, entre 60 % et 160 % de la part de base
//   (people.portion_units), celles qui tiennent les kcal, puis, à kcal tenues, un excès de protéines
//   au plus bas, puis le milieu des kcal : un plat très protéiné donne une part un peu plus petite
//   dans les kcal visées, un plat peu protéiné une part au milieu (pas plus de féculents pour des
//   protéines) ; un plat très léger ou très riche ne donne pas une assiette absurde, et l'écart
//   restant se voit dans le verdict ;
// - sans repère (profil incomplet) ou sans macros connues, la part de base, et on le dit ;
// - garniture cuite à part (riz, semoule : lignes `side` de la fiche) : la part se compose. Le plat
//   (viande, sauce, légumes mêlés) et la garniture se dosent chacun, le rapport garniture / plat
//   restant entre la moitié et une fois et demie celui de la fiche (SIDE_RATIO_MIN, SIDE_RATIO_MAX) :
//   jamais 100 g de poulet pour 300 g de riz. On ne quitte la fiche que si l'assiette s'en rapproche
//   nettement du repère (trop de protéines : plus de riz et moins de plat ; pas assez : l'inverse).
//   Un plat mélangé (one pot) ne se compose pas : seule la taille de la part change ;
// - l'écart au repère (gapOf) sert au choix des recettes : il reste surtout les protéines,
//   puisque les kcal sont visées par la taille de la part ;
// - repère automatique (autoMealRef, par défaut) : le repère tiré de la cible de la semaine, son
//   milieu borné (300 à 1 500 kcal, 15 à 120 g) et qui bouge d'au plus 100 kcal et 10 g par
//   semaine par rapport à celui de la semaine d'avant. Le repère fixe, lui, ne suit pas la cible.
import type { Macros } from "@/lib/nutrition/compute";

/** Une personne du foyer, vue par un module pur : sa part de base et son repère d'un repas. */
export interface Member {
  id: string;
  name: string;
  units: number;
  ref: MealRef | null;
  /** Ce qu'elle n'aime pas (préférences « dislike »), pour l'atelier. */
  dislikes?: string[];
}

/** Foyer de démonstration (tests, faux client) : deux adultes sans repère. */
export const SAMPLE_HOUSEHOLD: Member[] = [
  { id: "a", name: "Alex", units: 5, ref: { kcalMin: 650, kcalMax: 750, proteinMin: 45, proteinMax: 60 } },
  { id: "b", name: "Sam", units: 4, ref: null },
];

export interface MealRef {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
}

/** sante = dépense mesurée (ou en attente) ; fixe = repère choisi par la personne (people.fixed_meal_ref, mode fixe) ; estimation = formule (Mifflin). */
export type RefSource = "sante" | "fixe" | "estimation";

export interface Eater {
  id: string;
  name: string;
  /** Part de base, en unités (people.portion_units) : quand rien ne permet de mieux faire. */
  baseUnits: number;
  ref: MealRef | null;
  source: RefSource | null;
  /** Ce qui manque pour une part juste (libellés courts, à demander). */
  missing: string[];
}

export const PORTION_STEP = 0.5;
export const PORTION_MIN_RATIO = 0.6;
export const PORTION_MAX_RATIO = 1.6;

const roundStep = (x: number) => Math.round(x / PORTION_STEP) * PORTION_STEP;

export type Verdict = "ok" | "low" | "high";

export function verdictOf(ref: MealRef, m: { kcal: number; protein: number }): { kcal: Verdict; protein: Verdict } {
  return {
    kcal: m.kcal < ref.kcalMin ? "low" : m.kcal > ref.kcalMax ? "high" : "ok",
    protein: m.protein < ref.proteinMin ? "low" : m.protein > ref.proteinMax ? "high" : "ok",
  };
}

/** Ce qu'apporte la garniture cuite à part (lignes `side`), par unité de la fiche. */
export interface SideMacros {
  kcalUnit: number;
  proteinUnit: number;
  carbsUnit?: number;
  fatUnit?: number;
  fiberUnit?: number;
}

export interface RecipeMacros {
  kcalUnit: number | null;
  proteinUnit: number | null;
  /** Garniture à part, comprise dans kcalUnit / proteinUnit. Absente : un plat d'un seul tenant. */
  side?: SideMacros | null;
}

/** Rapport garniture / plat d'une part, relatif à celui de la fiche (1 = la fiche). */
export const SIDE_RATIO_MIN = 0.5;
export const SIDE_RATIO_MAX = 1.5;
const SIDE_RATIO_STEP = 0.05;
/** Quitter la fiche coûte : 1 point (20 kcal ou 2 g de protéines d'écart) pour 0,2 de rapport. */
const SIDE_DRIFT_COST = 5;

/** La composition d'une part : unités de plat (au demi près) et rapport de garniture (1 = la fiche). */
export interface Composition {
  units: number;
  sideRatio: number;
  /** Pourquoi le riz quitte la fiche : protéines trop hautes ou trop basses, ou kcal à ajuster. */
  why?: "proteines-hautes" | "proteines-basses" | "kcal";
}

/** Macros d'une unité de plat avec sa garniture au rapport `ratio`. */
export function unitMacros(r: RecipeMacros, ratio = 1): { kcal: number; protein: number } | null {
  if (r.kcalUnit == null) return null;
  const k = r.kcalUnit;
  const p = r.proteinUnit ?? 0;
  if (!r.side || ratio === 1) return { kcal: k, protein: p };
  return { kcal: k + (ratio - 1) * r.side.kcalUnit, protein: p + (ratio - 1) * r.side.proteinUnit };
}

/** a avant b, critère après critère (à 1e-9 près). */
function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i];
  return false;
}


/**
 * La part de cette personne : sans repère ni macros, la part de base à la fiche. Sinon, parmi les
 * tailles au demi près (entre 60 % et 160 % de la part de base) et, si la garniture est à part, les
 * rapports permis, dans cet ordre :
 * 1. les kcal dans le repère (la taille de l'assiette d'abord : jamais plus de kcal pour des protéines) ;
 * 2. les protéines au plus près du repère, quitter la fiche coûtant (SIDE_DRIFT_COST) ;
 * 3. les kcal au plus près du milieu, puis la fiche.
 * Un plat trop protéiné donne une part un peu plus petite, toujours dans les kcal ; avec du riz à
 * part, plus de riz et moins de plat. Un plat peu protéiné garde une part au milieu des kcal (on ne
 * mange pas plus de féculents pour des protéines : le conseil propose un complément) ; avec du riz à
 * part, moins de riz et plus de plat.
 */
export function compose(e: Pick<Eater, "baseUnits" | "ref">, r: RecipeMacros): Composition {
  if (!e.ref || r.kcalUnit == null || r.kcalUnit <= 0) return { units: e.baseUnits, sideRatio: 1 };
  const ref = e.ref;
  const side = r.side && r.side.kcalUnit > 0 && r.side.kcalUnit < r.kcalUnit ? r.side : null;
  const mid = (ref.kcalMin + ref.kcalMax) / 2;
  const lo = Math.max(PORTION_STEP, roundStep(e.baseUnits * PORTION_MIN_RATIO));
  const hi = roundStep(e.baseUnits * PORTION_MAX_RATIO);
  const ratios = side ? Array.from({ length: Math.round((SIDE_RATIO_MAX - SIDE_RATIO_MIN) / SIDE_RATIO_STEP) + 1 }, (_, k) => Math.round((SIDE_RATIO_MIN + k * SIDE_RATIO_STEP) * 100) / 100) : [1];
  let best: { c: Composition; key: number[] } | null = null;
  for (const ratio of ratios) {
    const m = unitMacros({ ...r, side }, ratio)!;
    if (m.kcal <= 0) continue;
    for (let units = lo; units <= hi + 1e-9; units += PORTION_STEP) {
      const kcal = Math.round(m.kcal * units);
      const protein = Math.round(m.protein * units);
      // Le riz ne bouge que dans le sens qui corrige : plus de riz contre un excès de protéines ou un
      // manque de kcal, moins contre un manque de protéines ou un excès de kcal ; jamais l'inverse.
      const why: Composition["why"] =
        ratio > 1 ? (protein > ref.proteinMax ? "proteines-hautes" : kcal <= ref.kcalMax && Math.round(units * (m.kcal - (ratio - 1) * side!.kcalUnit)) < ref.kcalMin ? "kcal" : undefined)
        : ratio < 1 ? (protein < ref.proteinMin ? "proteines-basses" : kcal >= ref.kcalMin && Math.round(units * (m.kcal + (1 - ratio) * side!.kcalUnit)) > ref.kcalMax ? "kcal" : undefined)
        : undefined;
      if (ratio !== 1 && !why) continue;
      // Trop de protéines : une part plus petite (dans les kcal) aide. Pas assez : seule la densité
      // compte (protéines d'une part au milieu des kcal), on ne grossit pas l'assiette pour en grappiller.
      const high = Math.max(0, protein - ref.proteinMax);
      const low = Math.max(0, ref.proteinMin - (m.protein * mid) / m.kcal);
      const key = [
        Math.max(0, kcal - ref.kcalMax, ref.kcalMin - kcal),
        (high + low) / 2 + Math.abs(ratio - 1) * SIDE_DRIFT_COST,
        Math.abs(kcal - mid),
        Math.abs(ratio - 1),
      ];
      if (!best || lexLess(key, best.key)) best = { c: why ? { units, sideRatio: ratio, why } : { units, sideRatio: ratio }, key };
    }
  }
  return best?.c ?? { units: e.baseUnits, sideRatio: 1 };
}

/** Unités de plat d'une recette pour cette personne (au demi près). */
export function portionUnits(e: Pick<Eater, "baseUnits" | "ref">, r: RecipeMacros): number {
  return compose(e, r).units;
}

export interface Portion {
  units: number;
  /** Garniture à part : son rapport à celui de la fiche (1 = la fiche, 1,3 = 30 % de riz en plus). */
  sideRatio: number;
  kcal: number | null;
  protein: number | null;
  verdict: { kcal: Verdict; protein: Verdict } | null;
  /** La part n'a pas pu viser le repère (bornes 60-160 %) : le plat est trop léger ou trop riche. */
  capped: boolean;
}

export function portionOf(e: Pick<Eater, "baseUnits" | "ref">, r: RecipeMacros): Portion {
  const { units, sideRatio } = compose(e, r);
  const u = unitMacros(r, sideRatio);
  if (!u) return { units, sideRatio, kcal: null, protein: null, verdict: null, capped: false };
  // Verdict sur les chiffres affichés (arrondis) : 699,6 kcal s'affiche 700 et compte comme 700.
  const m = { kcal: Math.round(u.kcal * units), protein: Math.round(u.protein * units) };
  const verdict = e.ref ? verdictOf(e.ref, m) : null;
  return { units, sideRatio, kcal: m.kcal, protein: m.protein, verdict, capped: !!verdict && verdict.kcal !== "ok" };
}

/** Macros complètes d'une part (fiche recette). */
export const portionMacros = (perUnit: Macros, units: number): Macros => ({
  kcal: perUnit.kcal * units,
  protein: perUnit.protein * units,
  carbs: perUnit.carbs * units,
  fat: perUnit.fat * units,
  fiber: perUnit.fiber * units,
});

/** Écart de la part au repère, en « points » (20 kcal ou 2 g de protéines = 1), 8 si inconnu. */
export function gapOf(e: Pick<Eater, "baseUnits" | "ref">, r: RecipeMacros): number {
  if (r.kcalUnit == null) return 8;
  if (!e.ref) return 0;
  const p = portionOf(e, r);
  const t = e.ref;
  return Math.max(0, p.kcal! - t.kcalMax, t.kcalMin - p.kcal!) / 20 + Math.max(0, p.protein! - t.proteinMax, t.proteinMin - p.protein!) / 2;
}

/** Écart moyen des mangeurs qui ont un repère (pour classer la bibliothèque). */
export function meanGap(eaters: Eater[], r: RecipeMacros): number {
  const withRef = eaters.filter((e) => e.ref);
  if (!withRef.length) return r.kcalUnit == null ? 8 : 0;
  return withRef.reduce((s, e) => s + gapOf(e, r), 0) / withRef.length;
}

// ─── Repère d'un repas ───

/** Tolérances autour de la cible du jour de Santé : ±150 kcal, protéines −8 % / +12 %. */
export const REF_KCAL = 150;
const PROT_LOW = 0.92;
const PROT_HIGH = 1.12;

export interface DayTarget {
  kcal: number;
  proteinG: number;
}
export interface Outside {
  kcal: number;
  protein: number;
}

/** Part de la journée prise hors batch quand la personne ne l'a pas dit (petit-déjeuner, en-cas). */
export const DEFAULT_OUTSIDE_SHARE = 0.2;

export function dayRange(t: DayTarget): MealRef {
  return { kcalMin: t.kcal - REF_KCAL, kcalMax: t.kcal + REF_KCAL, proteinMin: Math.round(t.proteinG * PROT_LOW), proteinMax: Math.round(t.proteinG * PROT_HIGH) };
}

/** Repère d'un des deux repas du batch : (jour − hors batch) / 2. */
export function mealRef(t: DayTarget, outside: Outside): MealRef {
  const day = dayRange(t);
  const half = (v: number, sub: number) => Math.max(0, Math.round((v - sub) / 2));
  return { kcalMin: half(day.kcalMin, outside.kcal), kcalMax: half(day.kcalMax, outside.kcal), proteinMin: half(day.proteinMin, outside.protein), proteinMax: half(day.proteinMax, outside.protein) };
}

export const defaultOutside = (t: DayTarget): Outside => ({ kcal: Math.round(t.kcal * DEFAULT_OUTSIDE_SHARE), protein: Math.round(t.proteinG * DEFAULT_OUTSIDE_SHARE) });

/** Libellé court d'une part : « 4,5 u ». */
export const unitsLabel = (u: number) => `${u.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} u`;

// ─── Repère automatique ───

/** Bornes du milieu d'un repère automatique, et ce dont il bouge au plus d'une semaine à l'autre. */
export const AUTO_REF = { kcalMin: 300, kcalMax: 1500, proteinMin: 15, proteinMax: 120, kcalStep: 100, proteinStep: 10 } as const;

export interface AutoRef {
  ref: MealRef;
  /** Ce que la cible seule donnerait (mealRef), avant bornes et pas. */
  raw: MealRef;
  /** Le pas de la semaine a retenu le repère : il rejoindra la cible les semaines suivantes. */
  limited: boolean;
  /** Le milieu sortait des bornes. */
  bounded: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Repère d'un repas en mode automatique : (cible − hors batch) / 2, comme mealRef, dont le milieu est
 * borné puis rapproché du repère de la semaine d'avant d'au plus un pas. La largeur de la fourchette
 * reste celle de la cible. Sans repère précédent (premier calcul), pas de pas.
 */
export function autoMealRef(t: DayTarget, outside: Outside, previous: MealRef | null): AutoRef {
  const raw = mealRef(t, outside);
  let bounded = false;
  let limited = false;
  const axis = (lo: number, hi: number, min: number, max: number, step: number, prevLo?: number, prevHi?: number) => {
    const half = (hi - lo) / 2;
    let mid = (lo + hi) / 2;
    const b = clamp(mid, min, max);
    if (b !== mid) bounded = true;
    mid = b;
    if (prevLo != null && prevHi != null) {
      const prev = (prevLo + prevHi) / 2;
      if (Math.abs(mid - prev) > step) {
        mid = prev + Math.sign(mid - prev) * step;
        limited = true;
      }
    }
    return [Math.max(0, Math.round(mid - half)), Math.round(mid + half)];
  };
  const [kcalMin, kcalMax] = axis(raw.kcalMin, raw.kcalMax, AUTO_REF.kcalMin, AUTO_REF.kcalMax, AUTO_REF.kcalStep, previous?.kcalMin, previous?.kcalMax);
  const [proteinMin, proteinMax] = axis(raw.proteinMin, raw.proteinMax, AUTO_REF.proteinMin, AUTO_REF.proteinMax, AUTO_REF.proteinStep, previous?.proteinMin, previous?.proteinMax);
  return { ref: { kcalMin, kcalMax, proteinMin, proteinMax }, raw, limited, bounded };
}

/** Libellé d'un repère : « 640–790 kcal, 48–58 g de protéines ». */
export const refLabel = (r: MealRef) => `${r.kcalMin.toLocaleString("fr-FR")}–${r.kcalMax.toLocaleString("fr-FR")}\u00a0kcal, ${r.proteinMin}–${r.proteinMax}\u00a0g de protéines`;

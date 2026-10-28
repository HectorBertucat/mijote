// Les mangeurs et leur part : combien d'unités d'une recette chacun mange, tiré de sa cible
// (Santé) et des macros de la recette. Module pur, sans accès à la base (tests/eaters.test.ts).
//
// Règles :
// - repère d'un repas du batch = (cible du jour ± tolérance − ce que la personne mange hors
//   batch) / 2, comme le bilan de la Semaine (week/nutrition.ts, dayRef) ;
// - unités d'une recette = milieu du repère en kcal ÷ kcal d'une unité, au demi près, bornées
//   entre 60 % et 160 % de la part de base (people.portion_units) : un plat très léger ou très
//   riche ne donne pas une assiette absurde, et l'écart restant se voit dans le verdict ;
// - sans repère (profil incomplet) ou sans macros connues, la part de base, et on le dit ;
// - l'écart au repère (gapOf) sert au choix des recettes : il reste surtout les protéines,
//   puisque les kcal sont visées par la taille de la part.
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

/** sante = dépense mesurée ; fixe = repère choisi par la personne (people.fixed_meal_ref) ; estimation = formule (Mifflin). */
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

export interface RecipeMacros {
  kcalUnit: number | null;
  proteinUnit: number | null;
}

/** Unités d'une recette pour cette personne (au demi près). */
export function portionUnits(e: Pick<Eater, "baseUnits" | "ref">, r: RecipeMacros): number {
  if (!e.ref || r.kcalUnit == null || r.kcalUnit <= 0) return e.baseUnits;
  const mid = (e.ref.kcalMin + e.ref.kcalMax) / 2;
  const lo = Math.max(PORTION_STEP, roundStep(e.baseUnits * PORTION_MIN_RATIO));
  const hi = roundStep(e.baseUnits * PORTION_MAX_RATIO);
  return Math.min(hi, Math.max(lo, roundStep(mid / r.kcalUnit)));
}

export interface Portion {
  units: number;
  kcal: number | null;
  protein: number | null;
  verdict: { kcal: Verdict; protein: Verdict } | null;
  /** La part n'a pas pu viser le repère (bornes 60-160 %) : le plat est trop léger ou trop riche. */
  capped: boolean;
}

export function portionOf(e: Pick<Eater, "baseUnits" | "ref">, r: RecipeMacros): Portion {
  const units = portionUnits(e, r);
  if (r.kcalUnit == null) return { units, kcal: null, protein: null, verdict: null, capped: false };
  // Verdict sur les chiffres affichés (arrondis) : 699,6 kcal s'affiche 700 et compte comme 700.
  const m = { kcal: Math.round(r.kcalUnit * units), protein: Math.round((r.proteinUnit ?? 0) * units) };
  const verdict = e.ref ? verdictOf(e.ref, m) : null;
  return { units, kcal: m.kcal, protein: m.protein, verdict, capped: !!verdict && verdict.kcal !== "ok" };
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

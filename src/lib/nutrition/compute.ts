// Macros d'une recette : Σ grammes réellement mangés × valeurs pour 100 g, puis par unité
// cuite et par part. « Réellement mangé » = la part du paquet utilisée, moins la parure
// retirée (os, peau, couenne), moins le gras qui reste dans la poêle (foods.ts, PAN_LOSS).
import { FOODS, isFoodId, type Food } from "./foods";

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/** Rendement d'une ligne de recette ; chaque champ remplace le défaut de l'aliment. */
export interface IngredientYield {
  usedGrams?: number | null; // part du paquet réellement utilisée (grams = le paquet)
  usedPct?: number | null; // idem en % (« la moitié du pot » = 50)
  trimPct?: number | null; // % du poids retiré avant de manger
  panLossPct?: number | null; // % des lipides qui restent dans la poêle ou sont jetés
  note?: string | null;
}

export interface IngredientForNutrition {
  item: string;
  food: string | null;
  grams: number | null;
  units: number | null;
  yield?: IngredientYield | null;
}

/** Ce qui est mis dans la recette, et ce qui en est mangé. */
export interface Eaten {
  inG: number; // poids de la ligne (acheté, ou sorti du paquet)
  usedG: number; // part du paquet utilisée
  trimPct: number;
  trimG: number; // os, peau, gras retirés
  panLossPct: number;
  panFatG: number; // gras resté dans la poêle ou jeté
  eatenG: number; // poids mangé (avant la perte de gras)
  macros: Macros; // apport de la ligne entière, sur ce qui est mangé
  note: string | null;
}

export interface RecipeNutrition {
  total: Macros;
  perUnit: Macros;
  coverage: number; // part des ingrédients pesables qui ont une valeur (0 à 1)
  missing: string[]; // ingrédients sans valeur, à compléter
}

/** À incrémenter quand le calcul ou foods.ts change : les fiches se réimportent au démarrage. */
export const NUTRITION_VERSION = 2;

/** Part de base d'une personne quand rien n'est encore réglé (people.portion_units). */
export const DEFAULT_PORTION_UNITS = 4;

const zero = (): Macros => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

export function gramsOf(ing: IngredientForNutrition): number | null {
  if (ing.grams != null) return ing.grams;
  if (ing.units != null && isFoodId(ing.food)) {
    const piece = FOODS[ing.food].pieceG;
    if (piece) return ing.units * piece;
  }
  return null;
}

const pct = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.min(100, Math.max(0, x)));

export function eatenOf(ing: IngredientForNutrition): Eaten | null {
  if (!isFoodId(ing.food)) return null;
  const y = ing.yield ?? {};
  const g = gramsOf(ing);
  const inG = g ?? y.usedGrams ?? null;
  if (inG == null) return null;
  const food: Food = FOODS[ing.food];
  const usedPctV = pct(y.usedPct);
  const usedG = y.usedGrams != null ? Math.min(y.usedGrams, inG) : usedPctV != null ? (inG * usedPctV) / 100 : inG;
  const trimPct = pct(y.trimPct) ?? food.trimPct ?? 0;
  const panLossPct = pct(y.panLossPct) ?? food.panLossPct ?? 0;
  const trimG = (usedG * trimPct) / 100;
  const eatenG = usedG - trimG;
  const k = eatenG / 100;
  const fat = food.fat * k;
  const panFatG = (fat * panLossPct) / 100;
  const macros: Macros = {
    kcal: Math.max(0, food.kcal * k - panFatG * 9),
    protein: food.protein * k,
    carbs: food.carbs * k,
    fat: fat - panFatG,
    fiber: food.fiber * k,
  };
  return { inG, usedG, trimPct, trimG, panLossPct, panFatG, eatenG, macros, note: y.note ?? null };
}

/** Vrai quand la ligne ne compte pas tout ce qui y est mis (paquet entamé, parure, poêle). */
export const hasYield = (e: Eaten) => e.usedG < e.inG - 0.5 || e.trimG >= 0.5 || e.panFatG >= 0.5;

export function computeNutrition(ings: IngredientForNutrition[], servingsUnits: number): RecipeNutrition {
  const total = zero();
  const missing: string[] = [];
  let counted = 0;
  let countable = 0;
  for (const ing of ings) {
    if (ing.food === "zero") continue;
    countable++;
    const e = eatenOf(ing);
    if (e == null) {
      missing.push(ing.item);
      continue;
    }
    counted++;
    total.kcal += e.macros.kcal;
    total.protein += e.macros.protein;
    total.carbs += e.macros.carbs;
    total.fat += e.macros.fat;
    total.fiber += e.macros.fiber;
  }
  const units = Math.max(1, servingsUnits);
  const perUnit = scale(total, 1 / units);
  return { total: round(total), perUnit, coverage: countable ? counted / countable : 1, missing };
}

export function scale(m: Macros, k: number): Macros {
  return { kcal: m.kcal * k, protein: m.protein * k, carbs: m.carbs * k, fat: m.fat * k, fiber: m.fiber * k };
}

export function round(m: Macros): Macros {
  return {
    kcal: Math.round(m.kcal),
    protein: Math.round(m.protein * 10) / 10,
    carbs: Math.round(m.carbs * 10) / 10,
    fat: Math.round(m.fat * 10) / 10,
    fiber: Math.round(m.fiber * 10) / 10,
  };
}

export type Verdict = "ok" | "low" | "high";

/** Repère d'un repas (kcal et protéines) ; vient du profil de chaque personne (src/lib/eaters). */
export interface MealTarget {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
}

/** Verdict d'une part face à un repère ; null sans repère (profil pas encore rempli). */
export function verdictFor(target: MealTarget | null | undefined, portion: Pick<Macros, "kcal" | "protein">): { kcal: Verdict; protein: Verdict } | null {
  if (!target) return null;
  return {
    kcal: portion.kcal < target.kcalMin ? "low" : portion.kcal > target.kcalMax ? "high" : "ok",
    protein: portion.protein < target.proteinMin ? "low" : portion.protein > target.proteinMax ? "high" : "ok",
  };
}

/** Part des calories apportée par les protéines (4 kcal/g). */
export const proteinShare = (m: Macros) => (m.kcal > 0 ? (m.protein * 4) / m.kcal : 0);

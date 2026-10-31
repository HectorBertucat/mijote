// Bloc nutrition d'une fiche : la part de chacun (unités tirées de sa cible), comparée à son repère,
// ce qui ne se mange pas (paquet entamé, parure, gras de la poêle), et ce qui pèse le
// plus dans la part (pour savoir quoi ajuster). Calcul ici (serveur), affichage dans NutritionView.
import { DEFAULT_PORTION_UNITS, eatenOf, hasYield, round, scale, type Eaten, type IngredientYield, type Macros } from "@/lib/nutrition/compute";
import { portionUnits, type Eater } from "@/lib/eaters/core";
import { NutritionView, type NutritionPerson } from "./NutritionView";

interface Ing {
  item: string;
  foodId: string | null;
  grams: number | null;
  units: number | null;
  yield?: IngredientYield | null;
}

const shortName = (item: string) => item.split(/[,(]/)[0].trim();
const g = (x: number) => (x >= 1000 ? `${(Math.round(x / 10) / 100).toLocaleString("fr-FR")} kg` : `${Math.round(x)} g`);
const approx = (x: number) => (x < 10 ? `~${Math.round(x)} g` : `~${Math.round(x / 5) * 5} g`);

/** « Huile : 45 g dont ~5 g restent dans la poêle ». */
function yieldText(item: string, e: Eaten, isOil: boolean): string {
  const parts: string[] = [];
  if (e.usedG < e.inG - 0.5) parts.push(`${g(e.usedG)} utilisés sur ${g(e.inG)}`);
  if (e.trimG >= 0.5) parts.push(`${parts.length ? "" : `${g(e.usedG)} dont `}${approx(e.trimG)} d'os, de peau ou de gras retirés`);
  if (e.panFatG >= 0.5) {
    const what = isOil ? `restent dans la poêle` : `de gras restent dans la poêle ou sont jetés`;
    parts.push(`${parts.length ? "" : `${g(e.usedG)} dont `}${approx(e.panFatG)} ${what}`);
  }
  return `${shortName(item)} : ${parts.join(", ")}`;
}

export type NutritionData = {
  /** Part de chacun (id du mangeur → macros). */
  portions: Record<string, Macros>;
  /** Contribution de chaque ingrédient à une unité (kcal, protéines) : × unités de la part affichée. */
  contrib: { item: string; kcal: number; protein: number }[];
  /** Ce qui est mis dans la recette mais pas mangé, et les kcal retirées d'une unité. */
  notEaten: { key: string; text: string; note?: string | null; kcalUnit: number }[];
  coverage: number | null;
};

/** Les mangeurs d'une fiche et leur part de cette recette. */
export function nutritionPeople(eaters: Eater[], perUnit: Macros): NutritionPerson[] {
  return eaters.map((e) => ({ id: e.id, name: e.name, units: portionUnits(e, { kcalUnit: perUnit.kcal, proteinUnit: perUnit.protein }), ref: e.ref }));
}

const DEFAULT_PEOPLE: NutritionPerson[] = [{ id: "part", name: "Une part", units: DEFAULT_PORTION_UNITS, ref: null }];

/** Calcul du bloc (pur) : parts, ce qui pèse, ce qui ne se mange pas. */
export function nutritionData({ perUnit, coverage, ingredients, servingsUnits, people = DEFAULT_PEOPLE }: { perUnit: Macros; coverage: number | null; ingredients: Ing[]; servingsUnits: number; people?: NutritionPerson[] }): NutritionData {
  const portions = Object.fromEntries(people.map((x) => [x.id, round(scale(perUnit, x.units))]));
  const share = 1 / Math.max(1, servingsUnits);
  const eaten = ingredients.map((i) => ({ i, e: eatenOf({ item: i.item, food: i.foodId, grams: i.grams, units: i.units, yield: i.yield }) }));
  const contrib = eaten
    .map(({ i, e }) => (e ? { item: i.item, kcal: e.macros.kcal * share, protein: e.macros.protein * share } : null))
    .filter((x): x is { item: string; kcal: number; protein: number } => x != null && x.kcal * 5 >= 1)
    .sort((a, b) => b.kcal - a.kcal)
    .slice(0, 6);
  const notEaten = eaten
    .filter((x): x is { i: Ing; e: Eaten } => x.e != null && hasYield(x.e))
    .map(({ i, e }) => {
      const full = eatenOf({ item: i.item, food: i.foodId, grams: i.grams, units: i.units, yield: { usedPct: 100, trimPct: 0, panLossPct: 0 } });
      return { key: i.item, text: yieldText(i.item, e, i.foodId === "huile"), note: e.note ?? null, kcalUnit: ((full?.macros.kcal ?? 0) - e.macros.kcal) * share };
    });
  return { portions, contrib, notEaten, coverage };
}

export function NutritionPanel({ bare, ...props }: { perUnit: Macros; coverage: number | null; ingredients: Ing[]; servingsUnits: number; eaters?: Eater[]; bare?: boolean }) {
  const people = props.eaters?.length ? nutritionPeople(props.eaters, props.perUnit) : DEFAULT_PEOPLE;
  return <NutritionView data={nutritionData({ ...props, people })} people={people} bare={bare} />;
}

// Apports de la semaine par personne, à partir des repas couverts par les recettes
// retenues (meal_slots.recipe_id). Module pur, sans accès à la base.
//
// Règles :
// - un repas compte s'il a une recette (congelé compris) dont les macros sont connues ;
//   la part d'une personne = ses unités (meal_slots.units) × macros par unité ;
// - « par jour » = moyenne sur les jours où la personne mange au moins un repas du batch
//   (les repas pris ailleurs ne sont pas connus : on ne les compte pas, on le dit) ;
// - chacun ajoute chaque jour ce qu'il a dit manger hors batch (petit-déjeuner, en-cas :
//   people.outside_kcal), quand il l'a dit ;
// - repère par jour = la cible du jour calculée dans Santé (dayRef), comparée aux 2 repas
//   principaux + le hors batch ; sans cible, pas de repère.
import { round, type Macros } from "@/lib/nutrition/compute";
import type { Meal } from "./propose";

export interface WeekSlot {
  day: number; // 0 = lundi
  meal: Meal;
  personId: string;
  portionUnits: number;
  recipeId: string | null;
}

export interface UnitMacros {
  id: string;
  kcalUnit: number | null;
  proteinUnit: number | null;
  carbsUnit?: number | null;
  fatUnit?: number | null;
  fiberUnit?: number | null;
}

export interface DayRef {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
  /** Repère d'un repas du batch : (cible du jour − hors batch) / 2, même tolérance. */
  meal: { kcalMin: number; kcalMax: number; proteinMin: number; proteinMax: number };
  source: "sante" | "fixe" | "estimation";
}

/** Repère d'un mangeur (src/lib/eaters) : la cible du jour et la part d'un repas qu'il en tire. */
export function dayRefOf(e: { source: "sante" | "fixe" | "estimation" | null; dayTarget: { kcal: number; proteinG: number } | null; ref: DayRef["meal"] | null; outside?: { kcal: number; protein: number } | null }): DayRef | null {
  // Repère fixe : la journée = deux repas du batch + ce qui est mangé hors batch.
  if (e.source === "fixe" && e.ref) {
    const o = e.outside ?? { kcal: 0, protein: 0 };
    return { kcalMin: 2 * e.ref.kcalMin + o.kcal, kcalMax: 2 * e.ref.kcalMax + o.kcal, proteinMin: 2 * e.ref.proteinMin + o.protein, proteinMax: 2 * e.ref.proteinMax + o.protein, meal: { ...e.ref }, source: "fixe" };
  }
  if (!e.dayTarget || !e.ref || !e.source) return null;
  const t = e.dayTarget;
  return { kcalMin: t.kcal - REF_KCAL, kcalMax: t.kcal + REF_KCAL, proteinMin: Math.round(t.proteinG * PROT_LOW), proteinMax: Math.round(t.proteinG * PROT_HIGH), meal: { ...e.ref }, source: e.source };
}

/** Tolérances autour de la cible du jour de Santé : ±150 kcal (comme Aujourd'hui), protéines −8 % / +12 %. */
export const REF_KCAL = 150;
const PROT_LOW = 0.92;
const PROT_HIGH = 1.12;

/** Repère d'un jour du batch pour une personne : toute la cible du jour, et la part d'un repas (hors batch déduit). */
export function dayRef(target: { kcal: number; proteinG: number } | null, outside: { kcal: number; protein: number } | null = null): DayRef | null {
  if (!target) return null;
  const day = { kcalMin: target.kcal - REF_KCAL, kcalMax: target.kcal + REF_KCAL, proteinMin: Math.round(target.proteinG * PROT_LOW), proteinMax: Math.round(target.proteinG * PROT_HIGH) };
  const half = (v: number, sub: number) => Math.round((v - sub) / 2);
  return {
    ...day,
    meal: { kcalMin: half(day.kcalMin, outside?.kcal ?? 0), kcalMax: half(day.kcalMax, outside?.kcal ?? 0), proteinMin: half(day.proteinMin, outside?.protein ?? 0), proteinMax: half(day.proteinMax, outside?.protein ?? 0) },
    source: "sante",
  };
}

export interface PersonWeek {
  personId: string;
  meals: number; // repas du batch comptés
  unknownMeals: number; // repas avec une recette sans macros
  days: number; // jours avec au moins un repas compté
  /** Jours où le hors batch dit par la personne est ajouté. */
  outsideDays: number;
  perMeal: Macros | null; // moyenne d'un repas du batch (sans le hors batch)
  perDay: Macros | null; // moyenne par jour compté (repas + hors batch)
  /** Jour par jour (0 = lundi) : repas du batch comptés + hors batch ; null = aucun repas du batch ce jour-là. */
  byDay: ({ meals: number; macros: Macros } | null)[];
}

const zero = (): Macros => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
const add = (a: Macros, b: Macros, k = 1) => {
  a.kcal += b.kcal * k;
  a.protein += b.protein * k;
  a.carbs += b.carbs * k;
  a.fat += b.fat * k;
  a.fiber += b.fiber * k;
};
const div = (m: Macros, n: number) => round({ kcal: m.kcal / n, protein: m.protein / n, carbs: m.carbs / n, fat: m.fat / n, fiber: m.fiber / n });

export function weekNutrition(slots: WeekSlot[], recipes: UnitMacros[], personIds?: string[], outside?: Map<string, { kcal: number; protein: number }>): PersonWeek[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const ids = personIds ?? [...new Set(slots.map((s) => s.personId))];
  return ids.map((personId) => {
    const mine = slots.filter((s) => s.personId === personId && s.recipeId);
    const meals = zero();
    const days = new Set<number>();
    const perDayList: ({ meals: number; macros: Macros } | null)[] = Array.from({ length: 7 }, () => null);
    let n = 0;
    let unknown = 0;
    for (const s of mine) {
      const r = byId.get(s.recipeId!);
      if (!r || r.kcalUnit == null) {
        unknown++;
        continue;
      }
      const m = { kcal: r.kcalUnit, protein: r.proteinUnit ?? 0, carbs: r.carbsUnit ?? 0, fat: r.fatUnit ?? 0, fiber: r.fiberUnit ?? 0 };
      add(meals, m, s.portionUnits);
      if (s.day >= 0 && s.day < 7) {
        const d = (perDayList[s.day] ??= { meals: 0, macros: zero() });
        add(d.macros, m, s.portionUnits);
        d.meals++;
      }
      days.add(s.day);
      n++;
    }
    const out = outside?.get(personId);
    const extra: Macros | null = out ? { kcal: out.kcal, protein: out.protein, carbs: 0, fat: 0, fiber: 0 } : null;
    const dayTotal = { ...meals };
    if (extra) add(dayTotal, extra, days.size);
    const byDay = perDayList.map((d) => {
      if (!d) return null;
      if (extra) add(d.macros, extra);
      return { meals: d.meals, macros: round(d.macros) };
    });
    return {
      personId,
      meals: n,
      unknownMeals: unknown,
      days: days.size,
      outsideDays: extra ? days.size : 0,
      perMeal: n ? div(meals, n) : null,
      perDay: days.size ? div(dayTotal, days.size) : null,
      byDay,
    };
  });
}

// Habitudes hors batch : ce que chacun mange à côté des repas du batch (shaker, petit-déjeuner,
// en-cas), composé d'aliments de la table nutritionnelle, avec ses jours. Module pur, sans accès
// à la base (tests/habitudes.test.ts).
//
// Règles :
// - les macros d'une habitude se calculent en code (grammes × table pour 100 g) ; une ancienne
//   habitude sans ingrédients garde ses chiffres saisis ;
// - le hors batch d'un jour = la somme des habitudes prévues ce jour-là (weekdays, 0 = lundi) ;
// - le repère d'un repas du batch prend la moyenne de la semaine : les parts sont cuites d'avance
//   et identiques d'un jour à l'autre, l'écart d'un jour se rattrape sur la semaine. Le bilan de
//   la Semaine, lui, compte jour par jour ;
// - sans habitude, le chiffre libre (people.outside_kcal) sert de repli, puis la valeur par défaut ;
// - le conseil compare la cible du jour aux deux repas du batch et au hors batch : il ne parle que
//   d'un manque notable (≥ 15 g de protéines ou ≥ 250 kcal par jour), sinon il dit que rien n'est utile.
import { FOODS, isFoodId, type FoodId } from "@/lib/nutrition/foods";
import type { DayTarget, Outside } from "./core";

export type HabitMeal = "breakfast" | "snack";

export interface HabitItem {
  food: FoodId;
  grams: number;
}

export interface HabitMacros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Une habitude vue par le calcul (food_templates). */
export interface HabitLike {
  weekdays: number[];
  items: { food: string; grams: number }[];
  kcal: number;
  proteinG: number;
}

export const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"] as const;
export const WEEKDAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Macros d'une habitude composée (aliments inconnus ignorés). */
export function habitMacros(items: { food: string; grams: number }[]): HabitMacros {
  const m = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const i of items) {
    if (!isFoodId(i.food) || !(i.grams > 0)) continue;
    const f = FOODS[i.food];
    const k = i.grams / 100;
    m.kcal += f.kcal * k;
    m.proteinG += f.protein * k;
    m.carbsG += f.carbs * k;
    m.fatG += f.fat * k;
  }
  return { kcal: Math.round(m.kcal), proteinG: r1(m.proteinG), carbsG: r1(m.carbsG), fatG: r1(m.fatG) };
}

/** Les chiffres d'une habitude : calculés depuis ses aliments, sinon ceux saisis. */
export const macrosOf = (h: HabitLike): { kcal: number; protein: number } => {
  if (h.items.length) {
    const m = habitMacros(h.items);
    return { kcal: m.kcal, protein: m.proteinG };
  }
  return { kcal: h.kcal, protein: h.proteinG };
};

/** Hors batch de chaque jour de la semaine (0 = lundi). */
export function outsideWeek(habits: HabitLike[]): Outside[] {
  return EVERY_DAY.map((d) => {
    const o = { kcal: 0, protein: 0 };
    for (const h of habits) {
      if (!h.weekdays.includes(d)) continue;
      const m = macrosOf(h);
      o.kcal += m.kcal;
      o.protein += m.protein;
    }
    return { kcal: Math.round(o.kcal), protein: Math.round(o.protein) };
  });
}

/** Moyenne d'un jour de la semaine (le shaker pris 5 jours sur 7 compte pour 5/7). */
export function outsideMean(week: Outside[]): Outside {
  const n = week.length || 1;
  return { kcal: Math.round(week.reduce((s, o) => s + o.kcal, 0) / n), protein: Math.round(week.reduce((s, o) => s + o.protein, 0) / n) };
}

/** Une habitude compte pour le hors batch dès qu'elle est prévue au moins un jour. */
export const counts = (h: Pick<HabitLike, "weekdays">) => h.weekdays.length > 0;

// ─── Modèles ───

export interface HabitPreset {
  id: "shaker" | "petit-dej" | "rien";
  label: string;
  hint: string;
  meal: HabitMeal;
  items: HabitItem[];
}

export const HABIT_PRESETS: HabitPreset[] = [
  {
    id: "shaker",
    label: "Shaker protéiné",
    hint: "protéine en poudre, lait, banane",
    meal: "breakfast",
    items: [
      { food: "whey", grams: 35 },
      { food: "lait_demi", grams: 250 },
      { food: "banane", grams: 120 },
    ],
  },
  {
    id: "petit-dej",
    label: "Petit-déjeuner classique",
    hint: "pain, beurre, confiture, yaourt",
    meal: "breakfast",
    items: [
      { food: "pain", grams: 80 },
      { food: "beurre", grams: 10 },
      { food: "confiture", grams: 20 },
      { food: "yaourt", grams: 125 },
    ],
  },
  { id: "rien", label: "Rien hors batch", hint: "café, thé : les deux repas font la journée", meal: "breakfast", items: [] },
];

/** Aliments proposés en premier dans l'éditeur d'une habitude (les autres suivent). */
export const HABIT_FOODS: FoodId[] = ["whey", "proteine_vegetale", "lait_demi", "skyr", "yaourt", "banane", "pomme", "flocons_avoine", "pain", "pain_complet", "beurre", "confiture", "miel", "oeuf", "amandes"];

// ─── Conseil ───

/** Seuils d'un manque « notable », par jour. */
export const ADVICE_PROTEIN_G = 15;
export const ADVICE_KCAL = 250;

export interface Advice {
  /** gap : il manque quelque chose ; ok : aucun complément utile. */
  kind: "gap" | "ok";
  proteinG: number;
  kcal: number;
  text: string;
}

const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);
const round50 = (x: number) => Math.max(50, Math.round(x / 50) * 50);
const shakerOf = () => habitMacros(HABIT_PRESETS[0].items);
const breakfastOf = () => habitMacros(HABIT_PRESETS[1].items);

/**
 * Ce qui manque par jour, une fois mangés les deux repas du batch (`batchMeal` : un repas moyen)
 * et le hors batch déclaré, et de quoi le couvrir. `hasShaker` : un shaker est déjà une habitude.
 */
export function adviceOf(target: DayTarget, batchMeal: { kcal: number; protein: number }, outside: Outside, hasShaker = false): Advice {
  const protein = Math.round(target.proteinG - 2 * batchMeal.protein - outside.protein);
  const kcal = Math.round(target.kcal - 2 * batchMeal.kcal - outside.kcal);
  const lowP = protein >= ADVICE_PROTEIN_G;
  const lowK = kcal >= ADVICE_KCAL;
  if (!lowP && !lowK) {
    const what = outside.kcal > 0 ? "Les repas du batch et tes habitudes couvrent" : "Les repas du batch couvrent";
    return { kind: "ok", proteinG: Math.max(0, protein), kcal: Math.max(0, kcal), text: `${what} ta cible du jour : aucun complément n’est utile.` };
  }
  const shaker = shakerOf();
  const bfast = breakfastOf();
  const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
  let text: string;
  if (lowP) {
    const need = round5(protein);
    const head = lowK ? `Il manque ~${need} g de protéines et ~${fr(round50(kcal))} kcal par jour` : `Il manque ~${need} g de protéines par jour`;
    if (hasShaker) text = `${head} : un en-cas protéiné de plus (200 g de skyr : ~21 g) ou un shaker plus dosé les couvre.`;
    else if (shaker.proteinG >= protein * 0.85) text = `${head} : un shaker le matin les couvre (~${Math.round(shaker.proteinG)} g, ~${fr(shaker.kcal)} kcal).`;
    else text = `${head} : un shaker le matin en couvre ~${Math.round(shaker.proteinG)} g ; ajoute un en-cas protéiné (skyr, yaourt).`;
  } else {
    const need = round50(kcal);
    text =
      bfast.kcal >= kcal * 0.85
        ? `Il manque ~${fr(need)} kcal par jour : un petit-déjeuner classique les couvre (~${fr(bfast.kcal)} kcal).`
        : `Il manque ~${fr(need)} kcal par jour : un petit-déjeuner classique en couvre ~${fr(bfast.kcal)} ; ajoute un en-cas (fruit, amandes).`;
  }
  return { kind: "gap", proteinG: Math.max(0, protein), kcal: Math.max(0, kcal), text };
}

/** Une habitude contient une protéine en poudre : c'est un shaker. */
export const isShaker = (h: Pick<HabitLike, "items">) => h.items.some((i) => i.food === "whey" || i.food === "proteine_vegetale");

/** Les jours d'une habitude en clair : « tous les jours », « du lundi au vendredi », « L M J ». */
export function daysLabel(days: number[]): string {
  const d = [...new Set(days)].sort();
  if (d.length === 7) return "tous les jours";
  if (d.length === 0) return "jamais prévue";
  if (d.join() === "0,1,2,3,4") return "du lundi au vendredi";
  if (d.join() === "5,6") return "le week-end";
  if (d.length === 1) return `le ${WEEKDAY_NAMES[d[0]]}`;
  return d.map((i) => WEEKDAY_NAMES[i].slice(0, 3) + ".").join(" ");
}

/** Vérifie une habitude saisie (éditeur) : nom, repas, jours, aliments connus, grammes bornés. */
export function checkHabit(h: { label: string; meal: string; weekdays: number[]; items: { food: string; grams: number }[] }): string | null {
  if (!h.label.trim()) return "Donne un nom à l'habitude.";
  if (h.meal !== "breakfast" && h.meal !== "snack") return "Une habitude se prend le matin ou à côté.";
  if (!h.weekdays.length || h.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Choisis au moins un jour.";
  if (!h.items.length) return "Ajoute au moins un aliment.";
  if (h.items.length > 12) return "Douze aliments au plus.";
  for (const i of h.items) {
    if (!isFoodId(i.food) || i.food === "zero") return "Aliment inconnu de la table nutritionnelle.";
    if (!(i.grams > 0 && i.grams <= 1000)) return `${FOODS[i.food].name} : entre 1 et 1 000 g.`;
  }
  return null;
}

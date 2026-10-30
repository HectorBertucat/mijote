// Les mangeurs vus par la base : profil, cible de Santé, ce qui est mangé hors batch.
// Le calcul est dans ./core et ./habits (purs, testés).
//
// Hors batch, par ordre de préférence : les habitudes (food_templates prévues au moins un jour,
// moyenne de la semaine pour le repère, jour par jour pour le bilan), le chiffre libre
// (people.outside_kcal, repli rétrocompatible), puis la valeur par défaut (20 % de la journée),
// qui suffit : un hors batch non dit n'est pas un manque.
//
// Repère d'un repas, par ordre de préférence :
// 1. la cible de Santé quand la dépense est mesurée (ou en attente d'une nouvelle mesure) ;
// 2. le repère fixe que la personne a choisi (people.fixed_meal_ref), s'il y en a un : plus juste
//    qu'une formule tant que la balance n'a pas parlé ;
// 3. la formule (Mifflin-St Jeor × activité) dès que le profil et une pesée existent, même
//    pesée cette semaine (le bilan de Santé, lui, attend le lundi suivant) ;
// 4. rien : la part de base, et la liste de ce qui manque.
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { mealSlots, people, preferences, recipes, weekPlans, weighIns } from "@/lib/db/schema";
import { estimatedTdee, missingForEstimate, targetsFor } from "@/lib/health/core";
import { currentReview, todayParis, toProfile, type Person } from "@/lib/health/store";
import { DEFAULT_PORTION_UNITS } from "@/lib/nutrition/compute";
import { mondayOf } from "@/lib/week/propose";
import { defaultOutside, mealRef, portionOf, type DayTarget, type Eater, type MealRef, type Member, type Outside, type RefSource } from "./core";
import { adviceOf, counts, isShaker, outsideMean, outsideWeek, type Advice } from "./habits";
import { listHabits } from "./setup";

/** Le chiffre libre de la personne (repli quand elle n'a pas d'habitude) ; null = pas encore dit. */
export function outsideOf(p: Pick<Person, "id" | "outsideKcal" | "outsideProteinG">): Outside | null {
  if (p.outsideKcal != null) return { kcal: p.outsideKcal, protein: p.outsideProteinG ?? 0 };
  return null;
}

/** D'où vient le hors batch : les habitudes, le chiffre libre, ou rien de dit (valeur par défaut). */
export type OutsideSource = "habitudes" | "chiffre" | null;

/** Hors batch d'une personne : moyenne d'un jour, et jour par jour quand il vient des habitudes. */
export function outsideFor(db: Db, p: Pick<Person, "id" | "outsideKcal" | "outsideProteinG">): { outside: Outside | null; byDay: Outside[] | null; source: OutsideSource; hasShaker: boolean } {
  const habits = listHabits(db, p.id).filter(counts);
  if (habits.length) {
    const byDay = outsideWeek(habits);
    return { outside: outsideMean(byDay), byDay, source: "habitudes", hasShaker: habits.some(isShaker) };
  }
  const o = outsideOf(p);
  return { outside: o, byDay: null, source: o ? "chiffre" : null, hasShaker: false };
}

export interface EaterInfo extends Eater {
  dayTarget: DayTarget | null;
  /** Hors batch d'un jour moyen ; null = rien de dit (le repère prend la valeur par défaut). */
  outside: Outside | null;
  /** Hors batch jour par jour (0 = lundi), quand il vient des habitudes. */
  outsideByDay: Outside[] | null;
  outsideSource: OutsideSource;
  hasShaker: boolean;
  explanation: string | null;
  setupDone: boolean;
}

export function eaterOf(db: Db, p: Person, now = new Date()): EaterInfo {
  const review = currentReview(db, p, now);
  const profile = toProfile(p);
  const lastKg = db.select({ kg: weighIns.kg }).from(weighIns).where(eq(weighIns.personId, p.id)).orderBy(asc(weighIns.measuredAt)).all().at(-1)?.kg ?? null;
  const missing = [...missingForEstimate(profile), ...(!p.goal ? ["objectif"] : []), ...(lastKg == null ? ["poids"] : [])];
  const out = outsideFor(db, p);
  const outside = out.outside;

  let dayTarget: DayTarget | null = null;
  let source: RefSource | null = null;
  let explanation: string | null = null;
  if (review && review.confidence !== "estimate") {
    dayTarget = { kcal: review.targets.kcal, proteinG: review.targets.proteinG };
    source = "sante";
    explanation = review.explanation;
  } else if (p.fixedMealRef) {
    source = "fixe";
    explanation = "Repère fixe choisi dans le profil, tant que la dépense n'est pas mesurée (pesées et journées complètes).";
  } else if (review) {
    dayTarget = { kcal: review.targets.kcal, proteinG: review.targets.proteinG };
    source = "estimation";
    explanation = review.explanation;
  } else if (lastKg != null) {
    const tdee = estimatedTdee(profile, lastKg, todayParis(now));
    if (tdee != null) {
      const t = targetsFor(profile, tdee, lastKg);
      dayTarget = { kcal: t.kcal, proteinG: t.proteinG };
      source = "estimation";
      explanation = "Estimation par formule (Mifflin-St Jeor × activité), en attendant les premières mesures.";
    }
  }
  const ref = source === "fixe" ? { ...p.fixedMealRef! } : dayTarget ? mealRef(dayTarget, outside ?? defaultOutside(dayTarget)) : null;
  return { id: p.id, name: p.name, baseUnits: p.portionUnits, ref, source, missing, dayTarget, outside, outsideByDay: out.byDay, outsideSource: out.source, hasShaker: out.hasShaker, explanation, setupDone: !!p.setupDoneAt };
}

/**
 * Un repas moyen du batch pour cette personne : ses repas de la semaine en cours (ou de la plus
 * récente) quand il y en a, sinon sa part des recettes de la bibliothèque. null sans macros.
 */
export function batchMealOf(db: Db, e: Pick<Eater, "id" | "baseUnits" | "ref">, now = new Date()): { kcal: number; protein: number; from: "semaine" | "bibliotheque" } | null {
  const monday = mondayOf(now);
  const plans = db.select({ id: weekPlans.id, weekStart: weekPlans.weekStart }).from(weekPlans).orderBy(desc(weekPlans.weekStart)).all();
  const plan = plans.find((x) => x.weekStart === monday) ?? plans.find((x) => x.weekStart <= monday);
  if (plan) {
    const rows = db
      .select({ units: mealSlots.units, kcalUnit: recipes.kcalUnit, proteinUnit: recipes.proteinUnit })
      .from(mealSlots)
      .innerJoin(recipes, eq(recipes.id, mealSlots.recipeId))
      .where(and(eq(mealSlots.weekPlanId, plan.id), eq(mealSlots.personId, e.id), isNotNull(recipes.kcalUnit), inArray(mealSlots.place, ["home", "office"])))
      .all();
    if (rows.length) {
      const sum = rows.reduce((s, r) => ({ kcal: s.kcal + r.kcalUnit! * (r.units ?? e.baseUnits), protein: s.protein + (r.proteinUnit ?? 0) * (r.units ?? e.baseUnits) }), { kcal: 0, protein: 0 });
      return { kcal: sum.kcal / rows.length, protein: sum.protein / rows.length, from: "semaine" };
    }
  }
  const lib = db.select({ kcalUnit: recipes.kcalUnit, proteinUnit: recipes.proteinUnit, status: recipes.status, parentId: recipes.parentId }).from(recipes).all().filter((r) => r.kcalUnit != null && r.status !== "archived" && !r.parentId);
  if (!lib.length) return null;
  const parts = lib.map((r) => portionOf(e, r));
  return { kcal: parts.reduce((s, x) => s + x.kcal!, 0) / parts.length, protein: parts.reduce((s, x) => s + x.protein!, 0) / parts.length, from: "bibliotheque" };
}

/** Le conseil du jour (pur : ./habits adviceOf) : faut-il un complément hors batch ? null sans cible. */
export function adviceFor(db: Db, e: EaterInfo, now = new Date()): (Advice & { from: "semaine" | "bibliotheque" }) | null {
  if (!e.dayTarget || !e.ref) return null;
  const meal = batchMealOf(db, e, now);
  if (!meal) return null;
  return { ...adviceOf(e.dayTarget, meal, e.outside ?? { kcal: 0, protein: 0 }, e.hasShaker), from: meal.from };
}

/** Tous les mangeurs, dans l'ordre du foyer (people.rank). */
export function loadEaters(db: Db, now = new Date()): EaterInfo[] {
  const ps = db.select().from(people).orderBy(asc(people.rank), asc(people.name)).all();
  return ps.map((p) => eaterOf(db, p, now));
}

export const eaterMap = (list: Eater[]) => new Map(list.map((e) => [e.id, e]));

/** La part de référence du foyer : la personne demandée (profil actif), sinon la première. */
export function leadOf(list: Eater[], id?: string | null): { id: string | null; name: string | null; units: number; ref: MealRef | null } {
  const e = (id ? list.find((x) => x.id === id) : null) ?? list[0];
  return e ? { id: e.id, name: e.name, units: e.baseUnits, ref: e.ref } : { id: null, name: null, units: DEFAULT_PORTION_UNITS, ref: null };
}

/** Unités mangées par repas quand tout le foyer est là (parts de base). */
export const householdUnits = (list: Pick<Eater, "baseUnits">[]) => list.reduce((s, e) => s + e.baseUnits, 0) || DEFAULT_PORTION_UNITS * 2;

/** Le foyer vu par les modules purs (atelier, restes) : la personne demandée en tête, ses goûts. */
export function householdMembers(db: Db, leadId?: string | null, now = new Date()): Member[] {
  const list = loadEaters(db, now);
  const dislikes = new Map<string, string[]>();
  for (const p of db.select({ personId: preferences.personId, kind: preferences.kind, text: preferences.text, tags: preferences.tags }).from(preferences).all()) {
    if (p.kind !== "dislike" || !p.personId || p.tags.includes("retiré")) continue;
    dislikes.set(p.personId, [...(dislikes.get(p.personId) ?? []), p.text]);
  }
  const members = list.map((e) => ({ id: e.id, name: e.name, units: e.baseUnits, ref: e.ref, dislikes: dislikes.get(e.id) ?? [] }));
  const i = leadId ? members.findIndex((m) => m.id === leadId) : -1;
  if (i > 0) members.unshift(...members.splice(i, 1));
  return members;
}

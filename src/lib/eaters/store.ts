// Les mangeurs vus par la base : profil, cible de Santé, ce qui est mangé hors batch.
// Le calcul est dans ./core (pur, testé).
//
// Repère d'un repas, par ordre de préférence :
// 1. la cible de Santé quand la dépense est mesurée (ou en attente d'une nouvelle mesure) ;
// 2. le repère fixe que la personne a choisi (people.fixed_meal_ref), s'il y en a un : plus juste
//    qu'une formule tant que la balance n'a pas parlé ;
// 3. la formule (Mifflin-St Jeor × activité) dès que le profil et une pesée existent, même
//    pesée cette semaine (le bilan de Santé, lui, attend le lundi suivant) ;
// 4. rien : la part de base, et la liste de ce qui manque.
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { people, preferences, weighIns } from "@/lib/db/schema";
import { estimatedTdee, missingForEstimate, targetsFor } from "@/lib/health/core";
import { currentReview, todayParis, toProfile, type Person } from "@/lib/health/store";
import { DEFAULT_PORTION_UNITS } from "@/lib/nutrition/compute";
import { defaultOutside, mealRef, type DayTarget, type Eater, type MealRef, type Member, type Outside, type RefSource } from "./core";

/** Ce que la personne mange hors batch ; null = pas encore dit. */
export function outsideOf(p: Pick<Person, "id" | "outsideKcal" | "outsideProteinG">): Outside | null {
  if (p.outsideKcal != null) return { kcal: p.outsideKcal, protein: p.outsideProteinG ?? 0 };
  return null;
}

export interface EaterInfo extends Eater {
  dayTarget: DayTarget | null;
  outside: Outside | null;
  explanation: string | null;
  setupDone: boolean;
}

export function eaterOf(db: Db, p: Person, now = new Date()): EaterInfo {
  const review = currentReview(db, p, now);
  const profile = toProfile(p);
  const lastKg = db.select({ kg: weighIns.kg }).from(weighIns).where(eq(weighIns.personId, p.id)).orderBy(asc(weighIns.measuredAt)).all().at(-1)?.kg ?? null;
  const missing = [...missingForEstimate(profile), ...(!p.goal ? ["objectif"] : []), ...(lastKg == null ? ["poids"] : [])];
  const outside = outsideOf(p);
  if (outside == null) missing.push("ce que tu manges hors batch");

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
  return { id: p.id, name: p.name, baseUnits: p.portionUnits, ref, source, missing, dayTarget, outside, explanation, setupDone: !!p.setupDoneAt };
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

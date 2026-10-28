// Objectifs et activité : lecture et écriture en base. La vérification est dans ./goals (pur, testé).
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { healthSamples, people } from "@/lib/db/schema";
import { listWorkouts } from "@/lib/training/store";
import { mondayOf } from "@/lib/week/propose";
import { checkProposal, mergeSessions, sportOf, type Checked, type GoalProposal, type Session, type SportPlanItem } from "./goals";
import { addWeighIn, currentReview, listWeighIns, todayParis, toProfile, type Person } from "./store";
import { dailyWeights, DEFAULT_PROTEIN_G_PER_KG, proteinTarget, rateOf, trendSeries } from "./core";
import type { GoalValues } from "./goal-format";

export const planOf = (p: Person): SportPlanItem[] => (p.sportPlan ?? []) as SportPlanItem[];

/** Tendance du poids aujourd'hui (ou null sans pesée). */
export function trendNow(db: Db, personId: string, today = todayParis()): number | null {
  const s = trendSeries(dailyWeights(listWeighIns(db, personId)), today);
  return s.length ? Math.round(s[s.length - 1].trend * 10) / 10 : null;
}

/** Séances de la personne : carnet guidé et Apple Santé, sans doublon, la plus récente d'abord. */
export function listSessions(db: Db, personId: string): Session[] {
  const carnet: Session[] = listWorkouts(db, personId).map((w) => ({ date: w.date, kind: "kettlebell", label: `Kettlebell ${w.type}`, minutes: w.minutes, source: "carnet" }));
  const apple: Session[] = db
    .select()
    .from(healthSamples)
    .where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout")))
    .all()
    .map((s) => {
      const label = String((s.meta as { type?: string } | null)?.type ?? "Séance");
      return { date: todayParis(new Date(s.start)), kind: sportOf(label), label, minutes: s.value ? Math.round(s.value) : null, source: "apple" as const };
    });
  return mergeSessions(carnet, apple);
}

/** Contexte des contrôles : profil, tendance, dépense de la semaine. */
export function goalContext(db: Db, person: Person) {
  const today = todayParis();
  const review = currentReview(db, person);
  return { profile: { ...toProfile(person), targetWeightKg: person.targetWeightKg }, trendKg: trendNow(db, person.id, today) ?? review?.trendKg ?? null, tdee: review?.tdee ?? null, today };
}

export function check(db: Db, person: Person, proposal: GoalProposal): Checked {
  return checkProposal(proposal, goalContext(db, person));
}

/** Applique un patch déjà vérifié : profil, objectifs, et la pesée du jour s'il y en a une. */
export function applyPatch(db: Db, personId: string, patch: GoalProposal) {
  const { weightKg, ...rest } = patch;
  const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) db.update(people).set(set).where(eq(people.id, personId)).run();
  if (weightKg && !listWeighIns(db, personId).some((w) => w.date === todayParis())) addWeighIn(db, personId, weightKg);
}

export const currentMonday = () => mondayOf(new Date());

/** Objectifs actuels, pour les lignes « avant → après » et les résumés. */
export const goalValues = (p: Person): GoalValues => ({
  sex: p.sex,
  birthDate: p.birthDate,
  heightCm: p.heightCm,
  activity: p.activity,
  goal: p.goal,
  ratePct: p.ratePct,
  proteinGPerKg: p.proteinGPerKg,
  proteinG: p.proteinG,
  targetWeightKg: p.targetWeightKg,
  targetDate: p.targetDate,
  sportPlan: planOf(p),
  constraints: p.constraints,
});

/** Résumé des objectifs pour les cartes (vue d'ensemble, page Objectifs). */
export function goalSummary(db: Db, p: Person) {
  const kg = trendNow(db, p.id);
  return {
    goal: p.goal,
    ratePct: rateOf(toProfile(p)),
    proteinText: p.proteinG ? `${Math.round(p.proteinG)} g de protéines/j` : p.goal ? `${String(p.proteinGPerKg ?? DEFAULT_PROTEIN_G_PER_KG).replace(".", ",")} g/kg de protéines${kg ? ` (${proteinTarget(toProfile(p), kg)} g/j)` : ""}` : null,
    targetWeightKg: p.targetWeightKg,
    targetDate: p.targetDate,
    trendKg: kg,
    plan: planOf(p),
    constraints: p.constraints,
  };
}

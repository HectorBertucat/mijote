// Santé : lecture et écriture en base. Le calcul est dans ./core (pur, testé).
import { randomUUID } from "crypto";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { dayLogs, foodLog, people, waistMeasures, weeklyTargets, weighIns } from "@/lib/db/schema";
import { mondayOf } from "@/lib/week/propose";
import { weeklyReview, type IntakeDay, type Profile, type WeeklyReview } from "./core";

export type Person = typeof people.$inferSelect;

/** Date du jour à Paris, AAAA-MM-JJ. */
export const todayParis = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(d);

export const listPeople = (db: Db) => db.select().from(people).orderBy(asc(people.rank), asc(people.name)).all();
export const getPerson = (db: Db, id: string) => db.select().from(people).where(eq(people.id, id)).get() ?? null;

export const toProfile = (p: Person): Profile => ({
  sex: p.sex,
  birthDate: p.birthDate,
  heightCm: p.heightCm,
  activity: p.activity,
  goal: p.goal,
  ratePct: p.ratePct,
  proteinGPerKg: p.proteinGPerKg,
  proteinG: p.proteinG,
});

export type ProfilePatch = Partial<Pick<Person, "sex" | "birthDate" | "heightCm" | "activity" | "goal" | "ratePct" | "proteinGPerKg" | "proteinG">>;

export function updateProfile(db: Db, id: string, patch: ProfilePatch) {
  db.update(people).set(patch).where(eq(people.id, id)).run();
}

// ─── Pesées et tour de taille ───

export function listWeighIns(db: Db, personId: string, since?: string) {
  return db
    .select()
    .from(weighIns)
    .where(since ? and(eq(weighIns.personId, personId), gte(weighIns.date, since)) : eq(weighIns.personId, personId))
    .orderBy(asc(weighIns.measuredAt))
    .all();
}

export function addWeighIn(db: Db, personId: string, kg: number, at = new Date(), source: "manual" | "health" | "import" = "manual", externalId?: string) {
  if (!(kg > 25 && kg < 300)) throw new Error("Poids hors de la plage attendue (25 à 300 kg).");
  const row = { id: randomUUID(), personId, date: todayParis(at), measuredAt: at.toISOString(), kg: Math.round(kg * 100) / 100, source, externalId: externalId ?? null };
  db.insert(weighIns).values(row).onConflictDoNothing().run();
  return row;
}

export const deleteWeighIn = (db: Db, id: string) => db.delete(weighIns).where(eq(weighIns.id, id)).run();

export const listWaist = (db: Db, personId: string) => db.select().from(waistMeasures).where(eq(waistMeasures.personId, personId)).orderBy(asc(waistMeasures.date)).all();

export function setWaist(db: Db, personId: string, date: string, cm: number) {
  if (!(cm > 40 && cm < 200)) throw new Error("Tour de taille hors de la plage attendue (40 à 200 cm).");
  db.insert(waistMeasures)
    .values({ id: randomUUID(), personId, date, cm })
    .onConflictDoUpdate({ target: [waistMeasures.personId, waistMeasures.date], set: { cm } })
    .run();
}

// ─── Apports et bilan ───

/** Total par jour du journal, et si la journée est marquée complète. */
export function intakeDays(db: Db, personId: string, since: string): IntakeDay[] {
  const totals = db
    .select({ date: foodLog.date, kcal: sql<number>`sum(${foodLog.kcal})` })
    .from(foodLog)
    .where(and(eq(foodLog.personId, personId), gte(foodLog.date, since)))
    .groupBy(foodLog.date)
    .all();
  const complete = new Set(
    db
      .select({ date: dayLogs.date })
      .from(dayLogs)
      .where(and(eq(dayLogs.personId, personId), eq(dayLogs.complete, true), gte(dayLogs.date, since)))
      .all()
      .map((d) => d.date)
  );
  return totals.map((t) => ({ date: t.date, kcal: t.kcal, complete: complete.has(t.date) }));
}

/**
 * Bilan de la semaine en cours, recalculé à chaque lecture puis enregistré : une pesée ou une
 * journée ajoutée après coup le met à jour. La limite de 150 kcal se mesure à la semaine d'avant.
 */
export function currentReview(db: Db, person: Person, now = new Date()): WeeklyReview | null {
  const weekStart = mondayOf(now);
  const previous =
    db
      .select()
      .from(weeklyTargets)
      .where(and(eq(weeklyTargets.personId, person.id), lt(weeklyTargets.weekStart, weekStart)))
      .orderBy(desc(weeklyTargets.weekStart))
      .get() ?? null;
  const review = weeklyReview({
    profile: toProfile(person),
    weekStart,
    weighIns: listWeighIns(db, person.id),
    intake: intakeDays(db, person.id, "0000-01-01"),
    previous,
  });
  if (!review) return null;
  const row = {
    tdeeKcal: review.tdee,
    kcalTarget: review.targets.kcal,
    proteinG: review.targets.proteinG,
    fatMinG: review.targets.fatMinG,
    confidence: review.confidence,
    details: { explanation: review.explanation, stepLimited: review.stepLimited, trendKg: review.trendKg, adaptive: review.adaptive, dailyDeltaKcal: review.targets.dailyDeltaKcal },
  };
  db.insert(weeklyTargets)
    .values({ id: randomUUID(), personId: person.id, weekStart, ...row })
    .onConflictDoUpdate({ target: [weeklyTargets.personId, weeklyTargets.weekStart], set: row })
    .run();
  return review;
}

export const listTargets = (db: Db, personId: string) => db.select().from(weeklyTargets).where(eq(weeklyTargets.personId, personId)).orderBy(desc(weeklyTargets.weekStart)).limit(12).all();

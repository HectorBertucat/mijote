// Carnet d'entraînement : lecture et écriture des séances (table workouts).
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { workouts } from "@/lib/db/schema";
import { todayParis } from "@/lib/health/store";
import type { Workout } from "./program";
import { exerciseLookup } from "./programs";

export function listWorkouts(db: Db, personId: string): Workout[] {
  const findExercise = exerciseLookup(db, personId);
  return db
    .select()
    .from(workouts)
    .where(eq(workouts.personId, personId))
    .orderBy(desc(workouts.ts))
    .all()
    .map((w) => ({ id: w.id, date: w.date, ts: w.ts, type: w.type, minutes: w.minutes, note: w.note, entries: w.entries.filter((e) => findExercise(e.ex)) }));
}

/** Enregistre une séance terminée ; les entrées vides ou inconnues sont ignorées. */
export function saveWorkout(db: Db, personId: string, w: { type: string; minutes: number; note: string; entries: { ex: string; sets: number[]; level: number }[] }, now = new Date()) {
  const findExercise = exerciseLookup(db, personId);
  const entries = w.entries
    .flatMap((e) => {
      const x = findExercise(e.ex);
      return x ? [{ ex: e.ex, sets: e.sets.filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.round(n)), level: Math.max(0, Math.min(x.ladder.length - 1, Math.round(e.level))) }] : [];
    })
    .filter((e) => e.sets.length);
  if (!entries.length) return null;
  const id = randomUUID();
  db.insert(workouts)
    .values({ id, personId, date: todayParis(now), ts: now.getTime(), type: w.type, minutes: Math.max(0, Math.round(w.minutes)), note: w.note.trim() || null, entries })
    .run();
  return id;
}

export const deleteWorkout = (db: Db, id: string) => db.delete(workouts).where(eq(workouts.id, id)).run();

// Ce qu'a envoyé Apple Santé : dernier envoi, pas et énergie active récents, séances.
import { and, desc, eq, gte, max } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { healthSamples, weighIns } from "@/lib/db/schema";

export function lastReceived(db: Db, personId: string) {
  const w = db.select({ at: max(weighIns.measuredAt) }).from(weighIns).where(and(eq(weighIns.personId, personId), eq(weighIns.source, "health"))).get()?.at ?? null;
  const s = db.select({ at: max(healthSamples.start) }).from(healthSamples).where(eq(healthSamples.personId, personId)).get()?.at ?? null;
  return { weight: w, sample: s };
}

export function recentDaily(db: Db, personId: string, kind: "steps" | "active_kcal", since: string) {
  return db.select({ date: healthSamples.start, value: healthSamples.value }).from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, kind), gte(healthSamples.start, since))).orderBy(healthSamples.start).all();
}

export function recentWorkouts(db: Db, personId: string, limit = 10) {
  return db.select().from(healthSamples).where(and(eq(healthSamples.personId, personId), eq(healthSamples.kind, "workout"))).orderBy(desc(healthSamples.start)).limit(limit).all();
}

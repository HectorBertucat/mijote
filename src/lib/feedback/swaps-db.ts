// Les remplacements notés pour une session (lus par la réserve au rangement : src/lib/reserve/store.ts,
// calcModel). À part de ./store pour que la réserve ne dépende que du schéma.
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { recipeSwaps } from "@/lib/db/schema";
import type { Swap } from "./swap";

export function sessionSwaps(db: Db, sessionId: string, recipeId: string): Swap[] {
  return db
    .select({ position: recipeSwaps.position, toFood: recipeSwaps.toFood })
    .from(recipeSwaps)
    .where(and(eq(recipeSwaps.sessionId, sessionId), eq(recipeSwaps.recipeId, recipeId)))
    .orderBy(asc(recipeSwaps.createdAt))
    .all();
}

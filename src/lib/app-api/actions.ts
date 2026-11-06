// Les gestes de l'app déjà faits, par `actionId` (table app_actions) : gardés en base, un renvoi après une
// coupure, un redémarrage ou depuis un autre processus ne refait pas le geste. Contrat : docs/api-app.md.
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { appActions } from "@/lib/db/schema";

/** Durée de garde d'un `actionId` : l'app ne renvoie pas un geste plus vieux. */
export const ACTION_KEEP_MS = 30 * 86_400_000;

/** L'`actionId` d'une requête, s'il est valable (chaîne non vide de 80 caractères au plus). */
export function actionIdOf(body: unknown): string | null {
  const id = body && typeof body === "object" ? (body as { actionId?: unknown }).actionId : undefined;
  return typeof id === "string" && id.length > 0 && id.length <= 80 ? id : null;
}

export function findAction(db: Db, personId: string, actionId: string) {
  return db.select().from(appActions).where(and(eq(appActions.personId, personId), eq(appActions.actionId, actionId))).get() ?? null;
}

/** Garde la réponse d'un geste fait, et oublie ceux de plus de 30 jours. */
export function saveAction(db: Db, a: { personId: string; actionId: string; route: string; reply: Record<string, unknown> }, now: number) {
  db.insert(appActions).values({ ...a, at: now }).onConflictDoNothing().run();
  purgeActions(db, now);
}

export function purgeActions(db: Db, now: number): number {
  return db.delete(appActions).where(lt(appActions.at, now - ACTION_KEEP_MS)).run().changes;
}

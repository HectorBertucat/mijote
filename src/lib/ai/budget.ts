// Plafond mensuel des appels IA, calculé sur la table ai_calls (mois UTC en cours).
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";

export class AiCapReachedError extends Error {
  constructor(readonly spentUsd: number, readonly capUsd: number) {
    super(`Plafond IA du mois atteint : ${spentUsd.toFixed(2)} $ dépensés sur ${capUsd.toFixed(2)} $ (AI_MONTHLY_CAP_USD).`);
  }
}

export function monthlyCapUsd(): number {
  const v = Number(process.env.AI_MONTHLY_CAP_USD ?? 30);
  return Number.isFinite(v) && v >= 0 ? v : 30;
}

export function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function spentThisMonth(db: Db, now = new Date()): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)` })
    .from(aiCalls)
    .where(sql`${aiCalls.at} >= ${monthStart(now)}`)
    .get();
  return row?.total ?? 0;
}

/** Lève AiCapReachedError si le mois a déjà atteint le plafond. Appelé avant tout appel au SDK. */
export function assertUnderCap(db: Db, now = new Date(), capUsd = monthlyCapUsd()) {
  const spent = spentThisMonth(db, now);
  if (spent >= capUsd) throw new AiCapReachedError(spent, capUsd);
  return { spent, capUsd };
}

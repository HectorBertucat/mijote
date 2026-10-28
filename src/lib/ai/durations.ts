// Durée attendue d'un appel IA, pour caler la progression des chargements : médiane des
// derniers appels réussis du même écran (ai_calls.duration_ms), sinon un repère mesuré en prod.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";

/** Repères mesurés en production (Sonnet, effort moyen), quand l'écran n'a pas encore d'historique. */
const FALLBACK_MS: Record<string, number> = { ajuster: 28_000, atelier: 30_000 };
export const MOCK_NOTE = "réponse simulée (MIJOTE_AI_MOCK)";

export function expectedDurationMs(db: Db, screen: string, opts: { mock?: boolean; last?: number } = {}): { ms: number; samples: number } {
  const rows = db
    .select({ ms: aiCalls.durationMs })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.screen, screen),
        eq(aiCalls.ok, true),
        isNotNull(aiCalls.durationMs),
        // Les réponses simulées (dev) ne calent que les chargements simulés, et inversement.
        opts.mock ? eq(aiCalls.error, MOCK_NOTE) : sql`coalesce(${aiCalls.error}, '') != ${MOCK_NOTE}`
      )
    )
    .orderBy(desc(aiCalls.at))
    .limit(opts.last ?? 10)
    .all()
    .map((r) => r.ms!)
    .sort((a, b) => a - b);
  if (!rows.length) return { ms: FALLBACK_MS[screen] ?? 25_000, samples: 0 };
  const mid = rows.length >> 1;
  const median = rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
  return { ms: Math.round(median), samples: rows.length };
}

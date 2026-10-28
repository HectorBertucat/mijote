// Proposition « Ajuster » en cours, une seule par recette (table adjust_proposals) : on la
// retrouve en revenant sur la fiche, avec les échanges qui l'ont produite. « Effacer » et
// « Garder cette version » la vident. Si la fiche change entre-temps, elle est périmée.
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { adjustProposals, recipes } from "@/lib/db/schema";

export interface Exchange {
  at: string;
  /** Ce qui a été demandé, tel qu'affiché (libellé de l'option ou ses mots). */
  ask: string;
  optionId: string | null;
  /** Vrai si la demande affinait la proposition précédente (et non l'originale). */
  refine: boolean;
  /** Réponse de l'IA (explication). */
  answer: string;
}

export interface Stored<P> {
  proposal: P;
  exchanges: Exchange[];
  updatedAt: string;
}

const MAX_EXCHANGES = 12;

function recipeStamp(db: Db, recipeId: string) {
  return db.select({ updatedAt: recipes.updatedAt }).from(recipes).where(eq(recipes.id, recipeId)).get()?.updatedAt ?? null;
}

export function loadProposal<P>(db: Db, recipeId: string): Stored<P> | null {
  const row = db.select().from(adjustProposals).where(eq(adjustProposals.recipeId, recipeId)).get();
  if (!row) return null;
  if (row.recipeUpdatedAt !== recipeStamp(db, recipeId)) {
    // La fiche a été modifiée (réimport, nouvelle nutrition) : la comparaison ne tient plus.
    clearProposal(db, recipeId);
    return null;
  }
  return { proposal: row.proposal as P, exchanges: (row.exchanges ?? []) as Exchange[], updatedAt: row.updatedAt };
}

/**
 * Remplace la proposition de la recette. Les échanges racontent comment elle a été obtenue : une demande qui
 * affine s'ajoute à la suite, une demande qui repart de la fiche d'origine recommence le fil.
 */
export function saveProposal<P>(db: Db, recipeId: string, proposal: P, exchange: Omit<Exchange, "at">): Stored<P> {
  const stamp = recipeStamp(db, recipeId);
  if (!stamp) throw new Error("Recette inconnue.");
  const prev = db.select({ exchanges: adjustProposals.exchanges }).from(adjustProposals).where(eq(adjustProposals.recipeId, recipeId)).get();
  const at = new Date().toISOString();
  const before = exchange.refine ? ((prev?.exchanges ?? []) as Exchange[]) : [];
  const exchanges = [...before, { ...exchange, at }].slice(-MAX_EXCHANGES);
  db.insert(adjustProposals)
    .values({ recipeId, proposal, exchanges, recipeUpdatedAt: stamp, updatedAt: at })
    .onConflictDoUpdate({ target: adjustProposals.recipeId, set: { proposal, exchanges, recipeUpdatedAt: stamp, updatedAt: at } })
    .run();
  return { proposal, exchanges, updatedAt: at };
}

export function clearProposal(db: Db, recipeId: string) {
  db.delete(adjustProposals).where(eq(adjustProposals.recipeId, recipeId)).run();
}

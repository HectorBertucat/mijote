"use server";

// Créer une recette d'après des recettes publiées : une action par étape (recherche, composition, retouche,
// enregistrement), pour que l'écran montre les sources pendant que les recettes se composent.
import { revalidatePath } from "next/cache";
import { aiEnabled, monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { userMessage } from "@/lib/atelier/errors";
import { closeCreation, composeProposals, refineProposal, saveCreation, startCreation, type Creation } from "@/lib/creation";
import { db } from "@/lib/db/client";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Budget = { spentUsd: number; capUsd: number };

const budget = (): Budget => ({ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() });

async function run(fn: () => Promise<Creation>): Promise<Result<{ creation: Creation; budget: Budget }>> {
  if (!aiEnabled()) return { ok: false, error: "IA non configurée ici (ANTHROPIC_API_KEY manquante)." };
  try {
    const creation = await fn();
    return { ok: true, creation, budget: budget() };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function startCreationAction(envie: string) {
  return run(() => startCreation(db, String(envie ?? "")));
}

export async function composeAction(id: string) {
  return run(() => composeProposals(db, String(id)));
}

export async function refineAction(id: string, proposalId: string, ask: string, fix: boolean) {
  return run(() => refineProposal(db, String(id), String(proposalId), { ask: String(ask ?? ""), fix: Boolean(fix) }));
}

export async function saveCreationAction(id: string, proposalId: string): Promise<Result<{ slug: string; creation: Creation }>> {
  if (!aiEnabled()) return { ok: false, error: "IA non configurée ici (ANTHROPIC_API_KEY manquante)." };
  try {
    const r = await saveCreation(db, String(id), String(proposalId));
    revalidatePath("/recettes");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

export async function closeCreationAction(id: string) {
  closeCreation(db, String(id));
}

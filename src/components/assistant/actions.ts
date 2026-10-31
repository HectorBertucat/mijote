"use server";

// L'assistant côté serveur : sa conversation, et les gestes sur ses propositions (Appliquer, Annuler).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { aiEnabled } from "@/lib/ai";
import { activeProfileId } from "@/lib/health/active";
import { applyAssistantAction, clearAssistant, dismissAssistantAction, viewsFor, type AssistantView } from "@/lib/assistant/store";

export async function loadAssistant(): Promise<AssistantView[]> {
  if (!aiEnabled()) return [];
  const id = await activeProfileId();
  return id ? viewsFor(db, id) : [];
}

/** Appliquer : revérifiée sur les données du moment, exécutée par les fonctions de l'interface. */
export async function applyAction(messageId: string, index: number): Promise<{ ok: boolean; message: string; href?: string; messages: AssistantView[] }> {
  const id = await activeProfileId();
  const r = applyAssistantAction(db, id, messageId, index);
  if (r.ok) revalidatePath("/", "layout");
  return { ...r, messages: viewsFor(db, id) };
}

export async function dismissAction(messageId: string, index: number): Promise<AssistantView[]> {
  const id = await activeProfileId();
  dismissAssistantAction(db, id, messageId, index);
  return viewsFor(db, id);
}

export async function restartAssistant(): Promise<void> {
  clearAssistant(db, await activeProfileId());
}

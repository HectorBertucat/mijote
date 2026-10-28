// Message d'erreur montré pour un appel de l'atelier (plafond, clé manquante, autre).
import { AiCapReachedError } from "@/lib/ai";

export function userMessage(e: unknown): string {
  if (e instanceof AiCapReachedError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  return m.includes("ANTHROPIC_API_KEY") ? "IA non configurée ici (ANTHROPIC_API_KEY manquante)." : m;
}

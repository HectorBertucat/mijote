"use server";

// Retours de goût, ingrédients remplacés et variante ajustée (src/lib/feedback) : sur la fiche et sur /plats.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { isTag, type TasteTag } from "@/lib/feedback/core";
import { FeedbackError, recordSwap, saveAdjustedVariant, saveFeedback, type FeedbackInput } from "@/lib/feedback/store";

type Result<T = object> = ({ ok: true; message: string } & T) | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof FeedbackError ? e.message : e instanceof Error ? e.message : "Action impossible." });
const refresh = (slug?: string | null) => {
  if (slug) revalidatePath(`/recettes/${slug}`);
  revalidatePath("/recettes");
  revalidatePath("/semaine");
  revalidatePath("/plats", "layout");
};

/** « J'adore, ok, bof » et les étiquettes, pour une recette (ou la portion qui vient d'être mangée). */
export async function tasteAction(input: { recipeId?: string | null; slug?: string | null; personId: string; servingId?: string | null } & FeedbackInput): Promise<Result> {
  try {
    const f = saveFeedback(db, input);
    refresh(input.slug);
    return { ok: true, message: `Noté pour ${f.name} : la prochaine fois, j’en tiens compte.` };
  } catch (e) {
    return fail(e);
  }
}

/** « J'ai remplacé… » : rattaché à la réserve ouverte du plat, sinon à la session en cours. */
export async function swapAction(input: { recipeId: string; slug: string; position: number; toFood: string }): Promise<Result> {
  try {
    const s = recordSwap(db, { recipeId: input.recipeId, position: input.position, toFood: input.toFood });
    refresh(input.slug);
    const where = s.where === "reserve" ? " La nutrition du plat en réserve suit." : s.where === "session" ? " La réserve de la session en tiendra compte." : "";
    return { ok: true, message: `Noté : ${s.from} → ${s.to}.${where}` };
  } catch (e) {
    return fail(e);
  }
}

/** Enregistre la variante ajustée d'après les retours (refaite côté serveur) : l'originale reste. */
export async function variantAction(input: { slug: string; tags: string[]; withSwaps: boolean }): Promise<Result<{ slug: string }>> {
  try {
    const tags = input.tags.filter(isTag) as TasteTag[];
    const v = saveAdjustedVariant(db, input.slug, { tags, withSwaps: input.withSwaps, leadId: await activeProfileId() });
    refresh(input.slug);
    return { ok: true, message: `Variante enregistrée : ${v.name}.`, slug: v.slug };
  } catch (e) {
    return fail(e);
  }
}

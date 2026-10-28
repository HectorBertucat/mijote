"use server";

import { revalidatePath } from "next/cache";
import { clearProposal, loadRecipeInput, saveDraft } from "@/lib/atelier";
import { userMessage } from "@/lib/atelier/errors";
import { verifyRecipe } from "@/lib/atelier/verify";
import { loadLibrary } from "@/lib/atelier/library";
import { resolve } from "@/lib/chronocatalog";
import { db } from "@/lib/db/client";
import { recipes } from "@/lib/db/schema";
import { RecipeInput } from "@/lib/recipes/format";
import { eq } from "drizzle-orm";

export type ActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const idOf = (slug: string) => db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, slug)).get()?.id ?? null;

// La proposition elle-même passe par le flux /api/ajuster/[slug] (étapes réelles du chargement).

/** « Effacer » : vide la proposition en cours de la recette. */
export async function clearProposalAction(slug: string): Promise<ActionResult<object>> {
  const id = idOf(slug);
  if (!id) return { ok: false, error: "Recette inconnue." };
  clearProposal(db, id);
  revalidatePath(`/recettes/${slug}`);
  return { ok: true };
}

/** « Garder cette version » : nouvelle recette liée, à essayer ; l'originale ne bouge pas. La proposition est vidée. */
export async function keepVariantAction(slug: string, rawDraft: unknown, explanation: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const parent = loadRecipeInput(db, slug);
    if (!parent) return { ok: false, error: "Recette inconnue." };
    const parsed = RecipeInput.safeParse(rawDraft);
    if (!parsed.success) return { ok: false, error: "Variante invalide." };
    // Le code revérifie au moment d'enregistrer : on ne garde pas une variante indisponible.
    const v = await verifyRecipe({ draft: parsed.data, original: parent, library: loadLibrary(db), resolve: (q) => resolve(q, { limit: 5 }) }).catch(() => null);
    if (!v) return { ok: false, error: "Catalogue injoignable : réessaie dans un instant." };
    if (v.blocked.length) return { ok: false, error: `À remplacer d'abord : ${v.blocked.join(", ")}.` };
    const newSlug = saveDraft(db, parsed.data, { parent: { slug: parent.slug, name: parent.name }, explanation: explanation.slice(0, 600), origin: "ajuster" });
    const id = idOf(slug);
    if (id) clearProposal(db, id);
    revalidatePath("/recettes");
    revalidatePath(`/recettes/${slug}`);
    return { ok: true, slug: newSlug };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}

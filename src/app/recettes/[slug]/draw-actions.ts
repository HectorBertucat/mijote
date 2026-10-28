"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { userMessage } from "@/lib/atelier/errors";
import { drawFoods, missingArt } from "@/lib/illus/ai";
import { getRecipe } from "@/lib/recipes/queries";

/** Dessine (IA) les aliments de la recette qui n'ont qu'un dessin générique. */
export async function drawMissingAction(slug: string): Promise<{ ok: boolean; text: string }> {
  const r = getRecipe(db, slug);
  if (!r) return { ok: false, text: "Recette inconnue." };
  try {
    const items = missingArt(db, r.ingredients.map((i) => ({ item: i.item, food: i.foodId })));
    const res = await drawFoods(db, items);
    revalidatePath("/", "layout");
    const done = res.saved.length ? `${res.saved.length} dessin${res.saved.length > 1 ? "s" : ""} ajouté${res.saved.length > 1 ? "s" : ""} (${res.saved.map((s) => s.label).join(", ")}).` : "";
    const ko = res.failed.length ? ` Refusé${res.failed.length > 1 ? "s" : ""} par la vérification : ${res.failed.map((f) => f.item).join(", ")} (le dessin générique reste).` : "";
    return { ok: res.failed.length === 0, text: (done + ko).trim() || "Rien à dessiner." };
  } catch (e) {
    return { ok: false, text: userMessage(e) };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { cookRecipe } from "@/lib/costs";

export async function cooked(recipeId: string, slug: string): Promise<{ ok: boolean; message: string }> {
  try {
    const r = cookRecipe(db, recipeId);
    revalidatePath(`/recettes/${slug}`);
    revalidatePath("/placard");
    revalidatePath("/couts");
    return { ok: true, message: `Noté : ${r.lotsTouched} lots du placard décomptés, ${r.total.toFixed(2).replace(".", ",")} € consommés.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Action impossible." };
  }
}

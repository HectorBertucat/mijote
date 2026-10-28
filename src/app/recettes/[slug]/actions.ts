"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { recipeNotes, recipes } from "@/lib/db/schema";
import { NOTE_CATEGORIES } from "@/lib/recipes/format";

const NoteForm = z.object({
  recipeId: z.string().min(1),
  slug: z.string().min(1),
  personId: z.string().nullable(),
  category: z.enum(NOTE_CATEGORIES),
  text: z.string().trim().min(1).max(2000),
});

export async function addNote(input: z.input<typeof NoteForm>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = NoteForm.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Note vide ou invalide." };
  const n = parsed.data;
  // Pas encore d'auth dans l'appli : elle est derrière Cloudflare Access (étape 6 du plan).
  // On vérifie au moins que la recette correspond bien au slug ; les clés étrangères font le reste.
  const ok = db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.id, n.recipeId), eq(recipes.slug, n.slug))).get();
  if (!ok) return { ok: false, error: "Recette inconnue." };
  db.insert(recipeNotes).values({ id: randomUUID(), recipeId: n.recipeId, personId: n.personId, category: n.category, text: n.text }).run();
  revalidatePath(`/recettes/${n.slug}`);
  revalidatePath("/recettes");
  return { ok: true };
}

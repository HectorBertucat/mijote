"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { isWeekStart } from "@/lib/week/propose";
import { addRecipe, clearWeek, cyclePlace, loadSelection, loadWeek, proposeWeek, removeRecipe, setExtra, setFactor, swapRecipe } from "@/lib/week/store";
import { startShoppingList } from "@/lib/shopping/build";

function weekOf(formData: FormData): string {
  const w = String(formData.get("w") ?? "");
  if (!isWeekStart(w)) throw new Error("Semaine invalide.");
  return w;
}

const back = (w: string, done: string) => redirect(`/semaine?w=${w}&done=${encodeURIComponent(done)}`);

/** Un tap sur une présence : maison → bureau → absent → maison. Les recettes retenues sont redistribuées. */
export async function togglePlace(slotId: string) {
  cyclePlace(db, slotId);
  revalidatePath("/semaine");
}

export async function proposeAction(formData: FormData) {
  const w = weekOf(formData);
  const p = await proposeWeek(db, w);
  revalidatePath("/semaine");
  back(w, p ? `propose:${p.slugs.join(",")}` : "propose:");
}

export async function swapAction(formData: FormData) {
  const w = weekOf(formData);
  const out = String(formData.get("slug") ?? "");
  const before = new Set(String(formData.get("current") ?? "").split(",").filter(Boolean));
  const p = await swapRecipe(db, w, out);
  revalidatePath("/semaine");
  const added = p?.slugs.find((s) => !before.has(s)) ?? "";
  back(w, `swap:${out}:${added}`);
}

export async function clearAction(formData: FormData) {
  const w = weekOf(formData);
  clearWeek(db, w);
  revalidatePath("/semaine");
  back(w, "clear");
}

/** − / + sur les unités d'une recette : le multiplicateur change, les repas se redistribuent. */
export async function factorAction(formData: FormData) {
  const w = weekOf(formData);
  setFactor(db, w, String(formData.get("slug") ?? ""), Number(formData.get("factor")));
  revalidatePath("/semaine");
  redirect(`/semaine?w=${w}#recettes`);
}

/** Ajoute une recette proposée pour finir un paquet entamé. */
export async function addAction(formData: FormData) {
  const w = weekOf(formData);
  const slug = String(formData.get("slug") ?? "");
  addRecipe(db, w, slug);
  revalidatePath("/semaine");
  back(w, `add:${slug}`);
}

export async function removeAction(formData: FormData) {
  const w = weekOf(formData);
  const slug = String(formData.get("slug") ?? "");
  removeRecipe(db, w, slug);
  revalidatePath("/semaine");
  back(w, `remove:${slug}`);
}

/** Met le reste d'un paquet dans une recette déjà choisie (ou le retire : grams = 0). */
export async function extraAction(formData: FormData) {
  const w = weekOf(formData);
  const slug = String(formData.get("slug") ?? "");
  const grams = Number(formData.get("grams") ?? 0);
  setExtra(db, w, slug, String(formData.get("ingredientId") ?? ""), Number.isFinite(grams) ? grams : 0);
  revalidatePath("/semaine");
  back(w, grams > 0 ? `extra:${slug}:${Math.round(grams)}` : `unextra:${slug}`);
}

/** « Faire la liste de courses » depuis la semaine : la liste garde week_plan_id et les unités choisies. */
export async function weekListAction(formData: FormData) {
  const w = weekOf(formData);
  const { planId } = loadWeek(db, w);
  const sel = loadSelection(db, planId);
  if (!sel.length) back(w, "propose:");
  const id = startShoppingList(db, sel.map((x) => x.slug), {
    weekPlanId: planId,
    scales: Object.fromEntries(sel.map((x) => [x.slug, x.factor])),
    extras: Object.assign({}, ...sel.map((x) => x.extras)),
  });
  revalidatePath("/courses");
  revalidatePath("/semaine");
  redirect(`/courses/${id}`);
}

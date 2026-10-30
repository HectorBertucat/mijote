"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { eatBox, freezeBox, sessionPots, storeBoxes, thawBox, throwBox } from "@/lib/boxes/store";
import type { Weights } from "@/lib/boxes/core";

type Result = { ok: boolean; message: string };
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? e.message : "Action impossible." });

/** Fin de session : les marmites à peser, et ce qui est déjà rangé. */
export async function loadSessionPots(sessionId: string) {
  return sessionPots(db, sessionId);
}

/** Range les boîtes d'une recette de la session (le partage est refait côté serveur). */
export async function storeSessionBoxes(sessionId: string, recipeId: string, weights: Weights): Promise<Result & { count?: number }> {
  try {
    const count = storeBoxes(db, sessionId, recipeId, weights);
    revalidatePath("/frigo");
    return { ok: true, message: `${count} boîte${count > 1 ? "s" : ""} rangée${count > 1 ? "s" : ""}.`, count };
  } catch (e) {
    return fail(e);
  }
}

/** « Je mange cette boîte » : au journal du profil de l'appareil. */
export async function eatBoxAction(id: string): Promise<Result> {
  try {
    const e = eatBox(db, id, await activeProfileId());
    revalidatePath("/frigo");
    revalidatePath("/sante");
    return { ok: true, message: `Noté au journal : ${Math.round(e.kcal)} kcal.` };
  } catch (e) {
    return fail(e);
  }
}

export async function moveBoxAction(id: string, to: "freezer" | "fridge"): Promise<Result> {
  try {
    if (to === "freezer") freezeBox(db, id);
    else thawBox(db, id);
    revalidatePath("/frigo");
    return { ok: true, message: to === "freezer" ? "Au congélo." : "Au frigo : à manger d'ici demain." };
  } catch (e) {
    return fail(e);
  }
}

export async function throwBoxAction(id: string): Promise<Result> {
  try {
    throwBox(db, id);
    revalidatePath("/frigo");
    return { ok: true, message: "Boîte jetée." };
  } catch (e) {
    return fail(e);
  }
}

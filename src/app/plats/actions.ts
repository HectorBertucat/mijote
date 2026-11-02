"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { adjustReserve, closeReserve, eatPortion, saveReserve, sessionReserves, undoServing } from "@/lib/reserve/store";
import type { Grams } from "@/lib/reserve/core";

type Result = { ok: boolean; message: string };
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? e.message : "Action impossible." });
const refresh = () => {
  revalidatePath("/plats", "layout");
  revalidatePath("/");
  revalidatePath("/sante", "layout");
};

/** Fin de session : les marmites à peser, et les réserves déjà rangées. */
export async function loadSessionReserves(sessionId: string) {
  return sessionReserves(db, sessionId);
}

/** Range la marmite d'une recette de la session (le partage est refait côté serveur). */
export async function saveReserveAction(sessionId: string, recipeId: string, input: { weights: Record<string, number | null>; counts: Record<string, number>; freezer: Record<string, number> }): Promise<Result> {
  try {
    const r = saveReserve(db, sessionId, recipeId, input);
    refresh();
    const n = Object.values(input.counts).reduce((s, x) => s + x, 0);
    return { ok: true, message: `${n} portion${n > 1 ? "s" : ""} en réserve${r.boxes ? `, dont ${r.boxes} en boîte${r.boxes > 1 ? "s" : ""} au congélo` : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

/** « J'ai mangé une portion » (de la personne affichée) : au journal de Santé, la réserve se recalcule. */
export async function eatAction(reserveId: string, personId: string, opts: { boxId?: string; grams?: Grams } = {}): Promise<Result & { servingId?: string }> {
  try {
    const s = eatPortion(db, reserveId, personId, opts);
    refresh();
    return { ok: true, message: `Noté au journal : ${s.kcal} kcal, ${s.protein} g de protéines.`, servingId: s.id };
  } catch (e) {
    return fail(e);
  }
}

export async function undoAction(servingId: string): Promise<Result> {
  try {
    undoServing(db, servingId);
    refresh();
    return { ok: true, message: "Annulé : la portion est revenue." };
  } catch (e) {
    return fail(e);
  }
}

/** Réajuster : nouvelle pesée de ce qui reste, portions restantes de chacun. */
export async function adjustAction(reserveId: string, input: { weights?: Record<string, number | null>; left?: Record<string, number> }): Promise<Result> {
  try {
    adjustReserve(db, reserveId, input);
    refresh();
    return { ok: true, message: "Réserve réajustée." };
  } catch (e) {
    return fail(e);
  }
}

export async function closeAction(reserveId: string): Promise<Result> {
  try {
    closeReserve(db, reserveId);
    refresh();
    return { ok: true, message: "Plat terminé." };
  } catch (e) {
    return fail(e);
  }
}

"use server";

// Les boîtes (des portions rangées de la réserve) : passer au congélo, en sortir, jeter. Manger une boîte
// passe par la réserve (src/app/plats/actions.ts).
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { freezeBox, thawBox, throwBox } from "@/lib/boxes/store";

type Result = { ok: boolean; message: string };
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? e.message : "Action impossible." });

export async function moveBoxAction(id: string, to: "freezer" | "fridge"): Promise<Result> {
  try {
    if (to === "freezer") freezeBox(db, id);
    else thawBox(db, id);
    revalidatePath("/plats", "layout");
    return { ok: true, message: to === "freezer" ? "Au congélo." : "Au frigo : à manger d'ici demain." };
  } catch (e) {
    return fail(e);
  }
}

export async function throwBoxAction(id: string): Promise<Result> {
  try {
    throwBox(db, id);
    revalidatePath("/plats", "layout");
    return { ok: true, message: "Boîte jetée." };
  } catch (e) {
    return fail(e);
  }
}

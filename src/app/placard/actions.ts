"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { closeLot, reopenLot } from "@/lib/costs";

export async function markLot(lotId: string, status: "used" | "lost"): Promise<{ ok: boolean; message: string }> {
  try {
    const lot = closeLot(db, lotId, status);
    revalidatePath("/placard");
    revalidatePath("/couts");
    return { ok: true, message: status === "lost" ? `${lot.item} : perdu, compté aux recettes.` : `${lot.item} : utilisé.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Action impossible." };
  }
}

export async function undoLot(lotId: string): Promise<{ ok: boolean; message: string }> {
  reopenLot(db, lotId);
  revalidatePath("/placard");
  revalidatePath("/couts");
  return { ok: true, message: "Remis au placard." };
}

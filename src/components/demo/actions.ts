"use server";

// « Recommencer » de la démo : la base du visiteur repart de la base modèle du jour.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { demoEnabled } from "@/lib/demo/core";
import { currentVisitor } from "@/lib/demo/request";
import { resetVisitor } from "@/lib/demo/store";

export async function restartDemo() {
  const id = demoEnabled() ? currentVisitor() : null;
  if (id) resetVisitor(id);
  revalidatePath("/", "layout");
  redirect("/");
}

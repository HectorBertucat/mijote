"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { createSession, rescaleSession, restartSession as restart, resumeSession as resume } from "@/lib/session/store";
import { parseSelection } from "@/lib/week/selection";

export async function startSession(formData: FormData) {
  // Unités choisies : « r » / « x » du Composer (src/lib/week/selection.ts) ; depuis une liste de
  // courses (Composer ou Semaine), celles enregistrées sur la liste (buildPlan les relit).
  const r = formData.get("r");
  const sel = parseSelection(String(r ?? formData.get("slugs") ?? ""), String(formData.get("x") ?? ""));
  if (!sel.slugs.length) redirect("/composer");
  const listId = String(formData.get("listId") ?? "") || null;
  const m = String(formData.get("mode") ?? "solo");
  const mode = m === "duo" || m === "veille" ? m : "solo";
  const units = r != null && !listId ? { scales: sel.scales, extras: sel.extras } : {};
  // « Session test » : pour montrer l'appli, rien n'est compté (durées), elle ne masque pas une vraie session.
  const test = formData.get("test") === "1";
  const id = createSession(db, { slugs: sel.slugs, shoppingListId: listId, mode, test, ...units });
  redirect(`/session/${id}`);
}

/** Réduit les unités des recettes au prorata de ce qui a été commandé. */
export async function applyScales(sessionId: string, scales: Record<string, number>) {
  rescaleSession(db, sessionId, scales);
}

/** Prep la veille : reprise le jour J, seul (le plan de la veille) ou à deux (plan refait). */
export async function resumeSession(sessionId: string, dayMode: "solo" | "duo", eventId?: string) {
  return Boolean(resume(db, sessionId, dayMode === "duo" ? "duo" : "solo", eventId));
}

/** Relancer la session (mêmes plats, unités, liste et mode), pour de vrai ou en test : l’ancienne s’arrête sur tous les écrans. */
export async function restartSession(sessionId: string, test: boolean) {
  const id = restart(db, sessionId, { test });
  if (id) redirect(`/session/${id}`);
}

/** Même chose depuis un formulaire (liste de courses) : `sessionId`, et `test=1` pour une session test. */
export async function restartFromForm(formData: FormData) {
  await restartSession(String(formData.get("sessionId") ?? ""), formData.get("test") === "1");
}

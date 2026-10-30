"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { people } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PROFILE_COOKIE } from "@/lib/health/active";
import { addWeighIn, deleteWeighIn, getPerson, setWaist, todayParis, updateProfile, type ProfilePatch } from "@/lib/health/store";
import type { Activity, Goal, Sex } from "@/lib/health/core";
import { AiCapReachedError } from "@/lib/ai";
import { estimateMeal, type MealEstimate } from "@/lib/health/estimate";
import { ImportPayload, ingest } from "@/lib/health/ingest";
import { CF_ID, CF_SECRET, resetHistory, rotateLink, setSetting } from "@/lib/health/link";
import { addEntry, addRecipeEntry, deleteEntry, listTemplates, setComplete, setEntryUnits, type LogMeal } from "@/lib/health/log";
import { deleteWorkout, saveWorkout } from "@/lib/training/store";
import { addDislikes, markSetupDone, removeDislike, removeHabit, saveHabit, setNothingOutside, setOutside, type HabitInput } from "@/lib/eaters/setup";
import { askCoach, clearCoach, getCoachMessage, setCoachStatus } from "@/lib/health/coach";
import type { GoalProposal, SportPlanItem } from "@/lib/health/goals";
import { applyPatch, check } from "@/lib/health/objectives";

type Result = { ok: boolean; message: string };
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? e.message : "Action impossible." });
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return String(v ?? "").trim() === "" || !Number.isFinite(n) ? null : n;
};

export async function setActiveProfile(id: string): Promise<void> {
  if (!getPerson(db, id)) return;
  (await cookies()).set(PROFILE_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 400, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function logWeight(personId: string, kg: number): Promise<Result> {
  try {
    addWeighIn(db, personId, kg);
    revalidatePath("/sante");
    return { ok: true, message: `${kg.toFixed(1).replace(".", ",")} kg noté.` };
  } catch (e) {
    return fail(e);
  }
}

export async function removeWeighIn(id: string): Promise<Result> {
  deleteWeighIn(db, id);
  revalidatePath("/sante");
  return { ok: true, message: "Pesée supprimée." };
}

export async function logWaist(personId: string, cm: number): Promise<Result> {
  try {
    setWaist(db, personId, todayParis(), cm);
    revalidatePath("/sante");
    return { ok: true, message: `Tour de taille : ${cm} cm.` };
  } catch (e) {
    return fail(e);
  }
}

export async function saveProfile(personId: string, form: FormData): Promise<Result> {
  const sex = form.get("sex");
  const activity = form.get("activity");
  const goal = form.get("goal");
  const birth = String(form.get("birthDate") ?? "");
  const patch: ProfilePatch = {
    sex: sex === "m" || sex === "f" ? (sex as Sex) : null,
    birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null,
    heightCm: num(form.get("heightCm")),
    activity: activity ? (String(activity) as Activity) : null,
    goal: goal ? (String(goal) as Goal) : null,
  };
  if (patch.heightCm != null && !(patch.heightCm > 100 && patch.heightCm < 230)) return { ok: false, message: "Taille en centimètres, entre 100 et 230." };
  updateProfile(db, personId, patch);
  const kg = num(form.get("kg"));
  try {
    if (kg != null) addWeighIn(db, personId, kg);
  } catch (e) {
    return fail(e);
  }
  // Objectifs : vérifiés comme ceux du coach (rythme, protéines, poids visé, plancher calorique).
  const person = getPerson(db, personId)!;
  let plan: SportPlanItem[] | null = null;
  try {
    const raw = JSON.parse(String(form.get("sportPlan") ?? "null"));
    if (Array.isArray(raw)) plan = raw;
  } catch {}
  const targetDate = String(form.get("targetDate") ?? "");
  const proposal: GoalProposal = {
    goal: patch.goal,
    ratePct: num(form.get("ratePct")),
    proteinGPerKg: num(form.get("proteinGPerKg")),
    proteinG: num(form.get("proteinG")),
    targetWeightKg: num(form.get("targetWeightKg")),
    targetDate: targetDate || null,
    sportPlan: plan,
    activity: patch.activity,
    constraints: form.has("constraints") ? String(form.get("constraints")) : null,
  };
  const checked = check(db, person, proposal);
  applyPatch(db, personId, checked.patch);
  // Vider un champ l'efface.
  const clear: ProfilePatch & { targetWeightKg?: null; targetDate?: null } = {};
  if (proposal.targetWeightKg == null) clear.targetWeightKg = null;
  if (!proposal.targetDate) clear.targetDate = null;
  if (proposal.ratePct == null) clear.ratePct = null;
  if (Object.keys(clear).length) applyPatch(db, personId, clear);
  revalidatePath("/sante", "layout");
  return { ok: true, message: checked.notes.length ? `Profil enregistré. ${checked.notes.join(" ")}` : "Profil enregistré." };
}

// ─── Coach ───

/** Repère fixe d'un repas (Santé › Profil) : quatre bornes, ou rien pour l'effacer. */
export async function saveFixedRef(personId: string, ref: { kcalMin: number; kcalMax: number; proteinMin: number; proteinMax: number } | null): Promise<Result> {
  if (!getPerson(db, personId)) return { ok: false, message: "Profil inconnu." };
  if (ref) {
    const n = [ref.kcalMin, ref.kcalMax, ref.proteinMin, ref.proteinMax];
    if (n.some((x) => !Number.isFinite(x))) return { ok: false, message: "Quatre nombres, s'il te plaît." };
    if (!(ref.kcalMin >= 200 && ref.kcalMax <= 2500 && ref.kcalMin < ref.kcalMax)) return { ok: false, message: "kcal d'un repas : entre 200 et 2 500, le minimum sous le maximum." };
    if (!(ref.proteinMin >= 5 && ref.proteinMax <= 200 && ref.proteinMin < ref.proteinMax)) return { ok: false, message: "Protéines d'un repas : entre 5 et 200 g, le minimum sous le maximum." };
  }
  db.update(people).set({ fixedMealRef: ref ? { kcalMin: Math.round(ref.kcalMin), kcalMax: Math.round(ref.kcalMax), proteinMin: Math.round(ref.proteinMin), proteinMax: Math.round(ref.proteinMax) } : null }).where(eq(people.id, personId)).run();
  revalidatePath("/", "layout");
  return { ok: true, message: ref ? "Repère enregistré." : "Repère retiré." };
}

export async function sendToCoach(personId: string, text: string): Promise<Result> {
  const person = getPerson(db, personId);
  if (!person) return { ok: false, message: "Profil inconnu." };
  try {
    await askCoach(db, person, text);
    revalidatePath("/sante/objectifs");
    return { ok: true, message: "" };
  } catch (e) {
    if (e instanceof AiCapReachedError) return { ok: false, message: "Plafond IA du mois atteint : le coach reprend le mois prochain." };
    return fail(e);
  }
}

/** Applique une proposition du coach, revérifiée sur les données du moment. */
export async function applyCoachProposal(id: string): Promise<Result> {
  const m = getCoachMessage(db, id);
  const person = m && getPerson(db, m.personId);
  if (!m?.proposal || !person) return { ok: false, message: "Proposition introuvable." };
  const { eta: _eta, why: _why, ...proposal } = m.proposal as GoalProposal & { eta?: unknown; why?: string };
  const checked = check(db, person, proposal);
  applyPatch(db, person.id, checked.patch);
  setCoachStatus(db, id, "applied");
  revalidatePath("/sante", "layout");
  return { ok: true, message: "Objectifs appliqués : la cible de la semaine est recalculée." };
}

export async function dismissCoachProposal(id: string): Promise<Result> {
  setCoachStatus(db, id, "dismissed");
  revalidatePath("/sante/objectifs");
  return { ok: true, message: "Proposition ignorée." };
}

export async function restartCoach(personId: string): Promise<Result> {
  clearCoach(db, personId);
  revalidatePath("/sante/objectifs");
  return { ok: true, message: "Nouvelle conversation." };
}

/**
 * Mise en route d'un mangeur (/sante/demarrer) : profil, pesée, ce qu'il mange hors batch, ce
 * qu'il n'aime pas. Sa part de chaque recette en découle (src/lib/eaters) ; la Semaine la suit.
 */
export async function saveSetup(personId: string, form: FormData): Promise<Result> {
  if (!getPerson(db, personId)) return { ok: false, message: "Personne inconnue." };
  const birth = String(form.get("birthDate") ?? "");
  const missing = [
    !form.get("sex") && "le sexe",
    !/^\d{4}-\d{2}-\d{2}$/.test(birth) && "la date de naissance",
    num(form.get("heightCm")) == null && "la taille",
    !form.get("activity") && "l'activité",
    !form.get("goal") && "l'objectif",
  ].filter(Boolean);
  if (missing.length) return { ok: false, message: `Il manque ${missing.join(", ")}.` };
  // Profil et objectifs : même chemin et mêmes vérifications que la page Profil.
  const r = await saveProfile(personId, form);
  if (!r.ok) return r;
  const outK = num(form.get("outsideKcal"));
  const outP = num(form.get("outsideProteinG"));
  try {
    if (outK != null) setOutside(db, personId, outK, outP ?? 0);
    for (const id of form.getAll("removeDislike")) removeDislike(db, personId, String(id));
    const add = String(form.get("dislikes") ?? "").trim();
    if (add) addDislikes(db, personId, add);
    markSetupDone(db, personId);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `C'est enregistré : les parts suivent ta cible.${r.message.startsWith("Profil enregistré. ") ? " " + r.message.slice(19) : ""}` };
}

// ─── Journal des repas (Aujourd'hui) ───

const done = (message: string): Result => {
  revalidatePath("/sante", "layout");
  return { ok: true, message };
};

export async function eatRecipe(personId: string, date: string, meal: LogMeal, recipeId: string, units: number, fromPlan: boolean): Promise<Result> {
  try {
    const e = addRecipeEntry(db, personId, date, meal, recipeId, units, fromPlan ? "plan" : "manual");
    return done(`${e.label} : ${e.kcal} kcal, ${Math.round(e.proteinG)} g de protéines.`);
  } catch (e) {
    return fail(e);
  }
}

export async function eatTemplate(personId: string, date: string, templateId: string): Promise<Result> {
  const t = listTemplates(db, personId).find((x) => x.id === templateId);
  if (!t) return { ok: false, message: "Habitude introuvable." };
  addEntry(db, { personId, date, meal: t.meal, kind: "template", templateId: t.id, label: t.label, kcal: t.kcal, proteinG: t.proteinG, fatG: t.fatG, carbsG: t.carbsG });
  return done(`${t.label} noté.`);
}

export async function eatFree(personId: string, date: string, meal: LogMeal, entry: { label: string; kcal: number; proteinG: number; fatG?: number | null; carbsG?: number | null; ai?: boolean }): Promise<Result> {
  try {
    addEntry(db, { personId, date, meal, kind: "free", label: entry.label, kcal: entry.kcal, proteinG: entry.proteinG, fatG: entry.fatG, carbsG: entry.carbsG, source: entry.ai ? "ai" : "manual" });
    return done(`${entry.label} noté.`);
  } catch (e) {
    return fail(e);
  }
}

export async function estimateFree(personId: string, text: string): Promise<{ ok: true; estimate: MealEstimate } | { ok: false; message: string }> {
  if (text.trim().length < 3) return { ok: false, message: "Décris le repas en quelques mots." };
  try {
    const p = getPerson(db, personId);
    return { ok: true, estimate: await estimateMeal(db, text, p?.name ?? "") };
  } catch (e) {
    return { ok: false, message: e instanceof AiCapReachedError ? "Plafond IA du mois atteint : saisis les kcal à la main." : e instanceof Error ? e.message : "Estimation impossible." };
  }
}

export async function changeUnits(id: string, units: number): Promise<Result> {
  try {
    setEntryUnits(db, id, units);
    return done("Part mise à jour.");
  } catch (e) {
    return fail(e);
  }
}

export async function removeEntry(id: string): Promise<Result> {
  deleteEntry(db, id);
  return done("Retiré du journal.");
}

export async function markComplete(personId: string, date: string, complete: boolean): Promise<Result> {
  setComplete(db, personId, date, complete);
  return done(complete ? "Journée complète : elle compte pour la cible." : "Journée marquée incomplète : elle ne compte pas.");
}

// ─── Habitudes hors batch (Santé › Habitudes) : elles font le hors batch, donc la part ───

const habitsDone = (message: string): Result => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

export async function saveHabitAction(personId: string, id: string | null, h: HabitInput): Promise<Result> {
  if (!getPerson(db, personId)) return { ok: false, message: "Profil inconnu." };
  try {
    saveHabit(db, personId, h, id);
    return habitsDone(id ? `« ${h.label.trim()} » modifiée : les parts suivent.` : `« ${h.label.trim()} » ajoutée : les parts suivent.`);
  } catch (e) {
    return fail(e);
  }
}

export async function dropHabit(personId: string, id: string): Promise<Result> {
  removeHabit(db, personId, id);
  return habitsDone("Habitude retirée.");
}

export async function nothingOutside(personId: string): Promise<Result> {
  if (!getPerson(db, personId)) return { ok: false, message: "Profil inconnu." };
  setNothingOutside(db, personId);
  return habitsDone("Rien hors batch : les deux repas font la journée.");
}

// ─── Apple Santé : historique lu dans l'export, envoyé par paquets depuis le navigateur ───

/** Un paquet lu dans l'export d'Apple Santé (pesées, pas par jour, séances). */
export async function importExportBatch(
  personId: string,
  batch: { weights?: { kg: number; at: string }[]; steps?: { date: string; count: number }[]; workouts?: { type: string; start: string; end?: string; durationMin?: number; distanceM?: number; kcal?: number }[] }
): Promise<{ ok: boolean; weights: number; steps: number; workouts: number; message: string }> {
  const parsed = ImportPayload.safeParse({ person: personId, ...batch, source: "export" });
  if (!parsed.success || !getPerson(db, personId)) return { ok: false, weights: 0, steps: 0, workouts: 0, message: "Paquet illisible." };
  const r = ingest(db, parsed.data);
  revalidatePath("/sante", "layout");
  return { ok: true, weights: r.weights, steps: r.steps, workouts: r.workouts, message: "Importé." };
}

// ---------- Raccourci Apple Santé ----------

/** Jeton de service Cloudflare du Raccourci : saisi une fois, recopié dans chaque code d'installation. */
export async function saveCloudflareToken(form: FormData): Promise<Result> {
  const id = String(form.get("clientId") ?? "").trim();
  const secret = String(form.get("clientSecret") ?? "").trim();
  if (!id.endsWith(".access") || secret.length < 20) return { ok: false, message: "Le Client ID finit par « .access » et le secret est long : recopie-les depuis Cloudflare." };
  setSetting(db, CF_ID, id);
  setSetting(db, CF_SECRET, secret);
  revalidatePath("/sante/apple");
  return { ok: true, message: "Jeton enregistré." };
}

export async function newHealthKey(personId: string): Promise<Result> {
  if (!getPerson(db, personId)) return { ok: false, message: "Profil inconnu." };
  rotateLink(db, personId);
  revalidatePath("/sante/apple");
  return { ok: true, message: "Nouvelle clé : recopie le code dans le Raccourci." };
}

export async function redoHistory(personId: string): Promise<Result> {
  resetHistory(db, personId);
  revalidatePath("/sante/apple");
  return { ok: true, message: "Le prochain envoi relira 6 mois." };
}

// ---------- Entraînement ----------

export async function finishWorkout(personId: string, w: { type: string; minutes: number; note: string; entries: { ex: string; sets: number[]; level: number }[] }): Promise<Result> {
  if (!getPerson(db, personId)) return { ok: false, message: "Profil inconnu." };
  const id = saveWorkout(db, personId, w);
  if (!id) return { ok: false, message: "Aucune série notée : rien à enregistrer." };
  revalidatePath("/sante/entrainement");
  return { ok: true, message: "Séance enregistrée dans le carnet." };
}

export async function removeWorkout(id: string): Promise<Result> {
  deleteWorkout(db, id);
  revalidatePath("/sante/entrainement");
  return { ok: true, message: "Séance supprimée." };
}

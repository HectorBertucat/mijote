// Libellés des objectifs (pour la carte de proposition du coach et la vue d'ensemble). Pur.
import { ACTIVITY_LABEL, GOAL_LABEL, type Activity, type Goal } from "./core";
import { SPORTS, type GoalProposal, type SportPlanItem } from "./goals";

const fr = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
export const frDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
export const planText = (plan: SportPlanItem[]) => (plan.length ? plan.map((p) => `${SPORTS[p.kind]} ${p.perWeek}×/sem. · ${p.minutes} min`).join(", ") : "aucun");

export interface GoalValues {
  sex: "m" | "f" | null;
  birthDate: string | null;
  heightCm: number | null;
  activity: Activity | null;
  goal: Goal | null;
  ratePct: number | null;
  proteinGPerKg: number | null;
  proteinG: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  sportPlan: SportPlanItem[] | null;
  constraints: string | null;
}

const show: { [K in keyof GoalProposal]?: { label: string; fmt: (v: NonNullable<GoalProposal[K]>) => string } } = {
  sex: { label: "Sexe", fmt: (v) => (v === "m" ? "homme" : "femme") },
  birthDate: { label: "Naissance", fmt: (v) => frDate(v) },
  heightCm: { label: "Taille", fmt: (v) => `${v} cm` },
  weightKg: { label: "Pesée du jour", fmt: (v) => `${fr(v)} kg` },
  goal: { label: "Objectif", fmt: (v) => GOAL_LABEL[v] },
  ratePct: { label: "Rythme", fmt: (v) => `${v > 0 ? "+" : ""}${fr(v, 2)} % du poids/sem.` },
  proteinG: { label: "Protéines", fmt: (v) => `${Math.round(v)} g/j` },
  proteinGPerKg: { label: "Protéines", fmt: (v) => `${fr(v)} g/kg` },
  targetWeightKg: { label: "Poids visé", fmt: (v) => `${fr(v)} kg` },
  targetDate: { label: "Échéance souhaitée", fmt: (v) => frDate(v) },
  activity: { label: "Activité", fmt: (v) => ACTIVITY_LABEL[v] },
  sportPlan: { label: "Sport", fmt: (v) => planText(v) },
  constraints: { label: "Ce que tu peux faire", fmt: (v) => v },
};

const before = (k: keyof GoalProposal, cur: GoalValues): string | null => {
  if (k === "weightKg") return null;
  if (k === "proteinG" || k === "proteinGPerKg") return cur.proteinG ? `${Math.round(cur.proteinG)} g/j` : cur.proteinGPerKg ? `${fr(cur.proteinGPerKg)} g/kg` : null;
  const v = cur[k as keyof GoalValues];
  if (v == null || (Array.isArray(v) && !v.length)) return null;
  const s = show[k];
  return s ? (s.fmt as (x: unknown) => string)(v) : null;
};

/** Lignes « avant → après » d'une proposition, dans l'ordre d'affichage, sans les valeurs inchangées. */
export function describeChanges(cur: GoalValues, p: GoalProposal): { label: string; before: string | null; after: string }[] {
  const out: { label: string; before: string | null; after: string }[] = [];
  for (const k of Object.keys(show) as (keyof GoalProposal)[]) {
    const v = p[k];
    if (v == null) continue;
    const s = show[k]!;
    const after = (s.fmt as (x: unknown) => string)(v);
    const b = before(k, cur);
    if (b === after) continue;
    out.push({ label: s.label, before: b, after });
  }
  return out;
}

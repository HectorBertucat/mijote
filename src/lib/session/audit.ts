// Audit d'un plan : ce que le planificateur promet, vérifié de l'extérieur. Module pur, utilisé par les
// tests (tests/planner-pairs.ts, tests/planner-audit.test.ts) et par `pnpm plan:audit`.
//
// - aucun récipient trop petit pour ce qu'il reçoit (volume au plus fort, remplissage compris) ;
// - pas plus de bols et boîtes de prep en même temps que la cuisine n'en a ;
// - une base commune (le riz de deux recettes) cuit dans le moins de récipients possible ;
// - toute étape qui prend des ingrédients les donne avec leurs quantités ;
// - jamais deux moments « mains » en même temps pour une personne (validatePlan) ;
// - et aucune erreur du plan.
import { baseFood, baseLiters, baseMethod, usableLiters } from "./capacity";
import { validatePlan, type PlannerResources, type SessionPlan } from "./planner";

/**
 * `vessel_warned`, `bowls_warned` : trop petit ou pas assez de bols, mais la cuisine n'a pas mieux et le plan le
 * dit en clair (pas un écart du planificateur).
 */
export type AuditKind = "error" | "vessel_small" | "vessel_warned" | "bowls_over" | "bowls_warned" | "bases_apart" | "no_quantities" | "hands";
/** Ce qui n'est pas un écart : une limite de la cuisine, dite par le plan. */
export const WARNED: AuditKind[] = ["vessel_warned", "bowls_warned"];

export interface AuditIssue {
  kind: AuditKind;
  message: string;
  stepIds: string[];
}

/** Une dose écrite dans le nom (« 1 c. à s. », « une pincée », « 4 cm ») vaut une quantité. */
const DOSE = /\d|c\. à [sc]\.|pincée|filet|trait|poignée|cuill/i;

export function auditPlan(plan: SessionPlan, res: PlannerResources): AuditIssue[] {
  const out: AuditIssue[] = [];
  for (const e of plan.errors) out.push({ kind: "error", message: e.message, stepIds: e.stepIds });
  for (const e of validatePlan(plan, res)) out.push({ kind: e.kind === "hands_busy" || e.kind === "person_busy" ? "hands" : "error", message: e.message, stepIds: e.stepIds });

  // Récipients : le volume au plus fort tient dans ce que le récipient offre.
  for (const s of plan.steps) {
    if (!s.load || s.load.usableL == null) continue;
    if (s.load.liters <= s.load.usableL + 0.05) continue;
    const name = plan.recipes.find((r) => r.slug === s.recipeSlug)?.name;
    const warned = plan.warnings.some((w) => w.startsWith(`${name}, étape ${s.order} :`) && /environ .* L/.test(w));
    out.push({ kind: warned ? "vessel_warned" : "vessel_small", message: `${s.id} : ${s.load.liters} L dans ${s.equipmentId} (${s.load.usableL} L utiles)`, stepIds: [s.id] });
  }

  // Bols : jamais plus de contenants pleins en même temps que l'inventaire, aucun groupe sans contenant.
  const c = plan.containers;
  if (c && (c.missing.length || c.peak > c.owned)) out.push({ kind: plan.warnings.some((w) => w.startsWith("Il manque")) ? "bowls_warned" : "bowls_over", message: `${c.peak} contenants en même temps pour ${c.owned} (sans contenant : ${c.missing.join(", ") || "aucun"})`, stepIds: [] });

  // Bases : autant de cuissons que le plus grand récipient l'impose, pas plus.
  const pots = res.equipment.filter((e) => e.kind === "pot");
  const biggest = Math.max(0, ...pots.map((e) => usableLiters(e, "boil") ?? 0));
  const byBase = new Map<string, typeof plan.steps>();
  for (const s of plan.steps) if (s.base && s.load) byBase.set(s.base, [...(byBase.get(s.base) ?? []), s]);
  for (const [base, list] of byBase) {
    const recipes = new Set(list.flatMap((s) => (s.shared ? s.shared.map((p) => p.recipeSlug) : [s.recipeSlug])));
    if (recipes.size < 2 || list.length < 2 || !biggest) continue;
    // Les cuissons qu'il faudrait au moins : les recettes rangées de la plus grosse à la plus petite dans des
    // récipients comme le plus grand (le volume ne s'additionne pas tout à fait : l'eau a un minimum).
    const food = list[0].ingredients?.find((i) => baseFood(i.food))?.food ?? null;
    const info = baseFood(food);
    if (!info) continue;
    const method = baseMethod(info, list[0].text);
    const grams = list.flatMap((s) => (s.shared ? s.shared.map((p) => p.rawG) : [(s.ingredients ?? []).filter((i) => i.food === food).reduce((x, i) => x + (i.grams ?? 0), 0)])).sort((a, b) => b - a);
    const bins: number[] = [];
    for (const g of grams) {
      const k = bins.findIndex((b) => baseLiters(info, method, (b + g) / 1000) <= biggest + 1e-6);
      if (k >= 0) bins[k] += g;
      else bins.push(g);
    }
    if (list.length > bins.length) out.push({ kind: "bases_apart", message: `${base} : ${list.length} cuissons pour ${recipes.size} recettes, ${bins.length} suffiraient`, stepIds: list.map((s) => s.id) });
  }

  // Quantités : chaque étape qui prend des bols dit ce qu'il y a dedans, en grammes, en pièces ou en dose.
  for (const s of plan.steps) {
    if (!s.bowls.length || s.tasks) continue;
    if (!s.ingredients?.length) {
      out.push({ kind: "no_quantities", message: `${s.id} : bols ${s.bowls.join(", ")} sans ingrédients`, stepIds: [s.id] });
      continue;
    }
    const vague = s.ingredients.filter((i) => i.bowl && !i.optional && i.grams == null && i.units == null && !DOSE.test(i.item) && i.food !== "zero");
    if (vague.length) out.push({ kind: "no_quantities", message: `${s.id} : sans quantité : ${vague.map((i) => i.item).join(", ")}`, stepIds: [s.id] });
  }
  return out;
}

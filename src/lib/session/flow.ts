// Le parcours simple d'une session (téléphone d'abord) : trois temps, Prépare (tout sur le plan de
// travail, par bols), Cuisine (une consigne à la fois) et Range (boîtes et frigo). Le planificateur
// ne change pas : ce module dit seulement où on en est et ce qu'il faut montrer. Pur, testé.
import { modeOf, type PlanBowl, type PrepItem, type PrepTask, type SessionPlan } from "./planner";
import { stepStatus, type SessionState, type TimerState } from "./state";

export type Temps = "prep" | "cook" | "store";
/** Le temps en cours, ou l'un des deux écrans hors parcours : la prep de la veille au frigo, la fin. */
export type Stage = Temps | "fridge" | "done";

export const TEMPS: { id: Temps; label: string }[] = [
  { id: "prep", label: "Prépare" },
  { id: "cook", label: "Cuisine" },
  { id: "store", label: "Range" },
];

/** Toutes les étapes sont faites (à deux : et tous les gestes de prep). */
export function allCooked(plan: SessionPlan, state: SessionState): boolean {
  if (!plan.steps.length) return false;
  const steps = plan.steps.every((s) => stepStatus(state, s.id) === "done");
  return modeOf(plan) === "duo" ? steps && plan.prep.tasks.every((t) => state.prepDone.has(t.id)) : steps;
}

export function stageOf(plan: SessionPlan, state: SessionState): Stage {
  if (state.status === "done" || state.status === "abandoned") return "done";
  if (state.status === "fridge") return "fridge";
  if (allCooked(plan, state)) return "store";
  // À deux, chacun suit son fil (gestes de prep et étapes mêlés) : un seul temps jusqu'au rangement.
  if (modeOf(plan) === "duo") return "cook";
  return state.status === "cooking" ? "cook" : "prep";
}

/** Prep la veille, le soir : seulement ce qui se garde au frigo. */
const evening = (plan: SessionPlan, state: SessionState) => modeOf(plan) === "veille" && !state.eveDone;

/** Un groupe pesé et versé au moment de l'étape (une boîte de pulpe, la crème, le riz) : pas de bol à remplir. */
export const atMoment = (b: Pick<PlanBowl, "holder">) => b.holder === "moment";

/** Les bols à remplir avant la cuisson : ce soir (veille), sinon tous sauf ceux qu'un geste finit pendant la cuisson ; jamais ceux du moment. */
export function prepBowls(plan: SessionPlan, state: SessionState): PlanBowl[] {
  return (evening(plan, state) ? plan.bowls.filter((b) => b.fridge) : plan.bowls.filter((b) => !b.during?.length)).filter((b) => !atMoment(b));
}

/** Les groupes du moment : rien à préparer, l'étape dit quoi peser. */
export const momentBowls = (plan: Pick<SessionPlan, "bowls">): PlanBowl[] => plan.bowls.filter(atMoment);

/** Les gestes de prep du moment (ce soir, le reste le jour J, ou tout). */
export function prepTasks(plan: SessionPlan, state: SessionState): PrepTask[] {
  if (evening(plan, state)) return plan.prep.tasks.filter((t) => t.eve);
  if (modeOf(plan) === "veille") return plan.prep.tasks.filter((t) => !t.eve);
  return plan.prep.tasks;
}

/** Hors des bols : ce qui attend sur le plateau (la viande à saisir…) et les gestes à part (tamponner…). */
export function prepExtras(plan: SessionPlan, state: SessionState): { plate: PrepItem[]; tasks: PrepTask[] } {
  const tasks = prepTasks(plan, state);
  return {
    plate: tasks.flatMap((t) => (t.kind === "cut" ? t.items.filter((i) => !i.bowl) : [])),
    tasks: tasks.filter((t) => t.kind === "other"),
  };
}

/** Avancement de chaque temps, de 0 à 1 (la barre en trois segments). */
export function tempsProgress(plan: SessionPlan, state: SessionState): Record<Temps, number> {
  if (state.status === "done") return { prep: 1, cook: 1, store: 1 };
  const duo = modeOf(plan) === "duo";
  const share = (n: number, of: number) => (of ? n / of : 1);
  let prep: number;
  if (duo) prep = share(plan.prep.tasks.filter((t) => state.prepDone.has(t.id)).length, plan.prep.tasks.length);
  else if (state.status === "prep" || state.status === "planned") {
    const bowls = prepBowls(plan, state);
    prep = bowls.length ? share(bowls.filter((b) => state.bowlsReady.has(b.letter)).length, bowls.length) : 0;
  } else prep = 1;
  // La cuisson au prorata des durées : une étape lancée compte pour moitié.
  const total = plan.steps.reduce((x, s) => x + Math.max(1, s.durationMin), 0);
  const cooked = plan.steps.reduce((x, s) => {
    const st = stepStatus(state, s.id);
    return x + (st === "done" ? 1 : st === "active" ? 0.5 : 0) * Math.max(1, s.durationMin);
  }, 0);
  const cook = state.status === "fridge" ? 0 : share(cooked, total);
  const store = share(plan.recipes.filter((r) => state.boxed.has(r.slug)).length, plan.recipes.length);
  return { prep, cook, store };
}

/** Ce qui sonne bientôt : les minuteurs qui tournent, sauf ceux de l'étape montrée, du plus proche au plus lointain. */
export function soonTimers(timers: TimerState[], now: number, exclude: string | null = null): TimerState[] {
  return timers.filter((t) => t.doneAt == null && t.endsAt > now && (exclude == null || t.stepId !== exclude)).sort((a, b) => a.endsAt - b.endsAt);
}

// ─── Range : boîtes et frigo ───

/** Ce que la page sait de chaque recette pour la ranger (unités cuites, conservation). */
export interface RecipeStorage {
  slug: string;
  /** Unités cuites (unités de la fiche × facteur). */
  units: number;
  /** Repas que ça fait pour le foyer : une boîte par repas. */
  meals: number;
  fridgeDays: number | null;
  freezerOk: boolean;
}

/** Une boîte par repas du foyer (au moins une). */
export const mealsOf = (units: number, unitsPerMeal: number) => Math.max(1, Math.floor(units / Math.max(1, unitsPerMeal)));

/** « 4 boîtes · 4 jours au frigo · se congèle ». */
export function storageLine(s: RecipeStorage): string {
  return [`${s.meals} boîte${s.meals > 1 ? "s" : ""}`, s.fridgeDays ? `${s.fridgeDays} jour${s.fridgeDays > 1 ? "s" : ""} au frigo` : null, s.freezerOk ? "se congèle" : null].filter(Boolean).join(" · ");
}

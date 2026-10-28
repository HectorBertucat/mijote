// État d'une session, déduit du journal cook_events. Le même code tourne sur le serveur
// et dans chaque écran : un écran rejoue les événements reçus en SSE, sans recharger.
import type { Person, PlanStep, PrepTask, SessionPlan } from "./planner";

export type EventKind = "step_start" | "step_done" | "bowl_ready" | "timer_start" | "timer_done" | "note";

export interface SessionEvent {
  seq?: number; // rowid côté serveur (absent tant que l'événement n'est pas confirmé)
  id: string;
  at: string;
  kind: EventKind;
  ref: string | null;
  payload: Record<string, unknown> | null;
}

export interface TimerState {
  id: string;
  label: string;
  stepId: string | null;
  endsAt: number; // ms
  minutes: number;
  doneAt: number | null;
  /** Minuteur d'une sous-étape (son rang dans step.phases) : il ne sonne pas en plein écran, la suivante démarre. */
  phase: number | null;
  /** Lancement et durée d'origine (gardés quand on règle le minuteur : « ↺ » y revient). */
  startedAt: number;
  refMinutes: number;
}

export interface SessionState {
  status: "planned" | "prep" | "fridge" | "cooking" | "done" | "abandoned";
  cookingStartedAt: number | null;
  /** Prep la veille : la soirée est finie (bols au frigo) ; resumedAt = reprise le lendemain. */
  eveDone: boolean;
  resumedAt: number | null;
  bowlsReady: Set<string>;
  prepDone: Set<string>; // tâches de prep (ref « prep:<id> »)
  started: Map<string, number>; // étape → heure de début réelle
  done: Map<string, number>;
  timers: Map<string, TimerState>;
  /** Sous-étapes faites, « <rang>:<id de l'étape> » (ref « phase:<rang>:<id> »). */
  phasesDone: Set<string>;
  /** Dernière sous-étape passée, par étape : une étape qui sort d'une attente repasse devant. */
  phaseAt: Map<string, number>;
}

export function reduce(initialStatus: SessionState["status"], events: SessionEvent[]): SessionState {
  const s: SessionState = {
    status: initialStatus === "planned" ? "prep" : initialStatus,
    cookingStartedAt: null,
    eveDone: initialStatus === "fridge",
    resumedAt: null,
    bowlsReady: new Set(),
    prepDone: new Set(),
    started: new Map(),
    done: new Map(),
    timers: new Map(),
    phasesDone: new Set(),
    phaseAt: new Map(),
  };
  // L'état initial vient du statut en base ; les notes de statut le rejouent dans l'ordre.
  for (const e of events) {
    const at = Date.parse(e.at);
    const undo = e.payload?.undo === true;
    switch (e.kind) {
      case "bowl_ready":
        if (!e.ref) break;
        if (e.payload?.ready === false) s.bowlsReady.delete(e.ref);
        else s.bowlsReady.add(e.ref);
        break;
      case "step_start":
        if (!e.ref) break;
        if (undo) {
          s.started.delete(e.ref);
          s.done.delete(e.ref);
        } else if (!s.started.has(e.ref)) s.started.set(e.ref, at);
        break;
      case "step_done":
        if (!e.ref) break;
        if (e.ref.startsWith("phase:")) {
          if (undo) s.phasesDone.delete(e.ref.slice(6));
          else s.phasesDone.add(e.ref.slice(6));
          const stepId = e.ref.slice(6).replace(/^\d+:/, "");
          s.phaseAt.set(stepId, at);
          break;
        }
        if (e.ref.startsWith("prep:")) {
          if (undo) s.prepDone.delete(e.ref.slice(5));
          else s.prepDone.add(e.ref.slice(5));
          break;
        }
        if (undo) s.done.delete(e.ref);
        else {
          s.done.set(e.ref, at);
          if (!s.started.has(e.ref)) s.started.set(e.ref, at);
        }
        break;
      case "timer_start": {
        if (!e.ref) break;
        const endsAt = Date.parse(String(e.payload?.endsAt ?? e.at));
        const prev = s.timers.get(e.ref);
        const minutes = Number(e.payload?.minutes ?? Math.round((endsAt - at) / 60000));
        // Un réglage (+1, glisser, ↺) garde le lancement et la durée d'origine ; un nouveau lancement les remplace.
        const keep = e.payload?.adjust === true && prev && prev.doneAt == null;
        s.timers.set(e.ref, {
          startedAt: keep ? prev.startedAt : at,
          refMinutes: keep ? prev.refMinutes : minutes,
          id: e.ref,
          label: String(e.payload?.label ?? "Minuteur"),
          stepId: (e.payload?.stepId as string) ?? null,
          endsAt,
          minutes,
          doneAt: null,
          phase: typeof e.payload?.phase === "number" ? e.payload.phase : null,
        });
        break;
      }
      case "timer_done": {
        const t = e.ref ? s.timers.get(e.ref) : undefined;
        if (t && t.doneAt == null) t.doneAt = at;
        break;
      }
      case "note": {
        const st = e.payload?.status;
        if (typeof st === "string") {
          s.status = st as SessionState["status"];
          if (st === "cooking" && s.cookingStartedAt == null) s.cookingStartedAt = at;
          if (st === "prep") s.cookingStartedAt = null;
          if (st === "fridge") s.eveDone = true;
          if (st === "prep" && e.payload?.resume === true) {
            s.eveDone = true;
            s.resumedAt = at;
          }
        }
        break;
      }
    }
  }
  return s;
}

export type StepStatus = "todo" | "active" | "done";
export const stepStatus = (s: SessionState, id: string): StepStatus => (s.done.has(id) ? "done" : s.started.has(id) ? "active" : "todo");

// ─── Sous-étapes chronométrées ───

/** Rang de la sous-étape en cours d'une étape (la première pas faite), null sans sous-étapes ou toutes faites. */
export function currentPhase(s: SessionState, step: PlanStep): number | null {
  if (!step.phases?.length) return null;
  const i = step.phases.findIndex((_, n) => !s.phasesDone.has(`${n}:${step.id}`));
  return i < 0 ? null : i;
}

/** Fournée en cours et nombre de fournées d'une étape (sous-étapes numérotées), sinon null. */
export function batchOf(s: SessionState, step: PlanStep): { at: number; of: number } | null {
  const of = Math.max(0, ...(step.phases ?? []).map((p) => p.batch ?? 0));
  if (of < 2) return null;
  const n = currentPhase(s, step);
  const at = n == null ? of : (step.phases![n].batch ?? (step.phases!.slice(0, n).reverse().find((p) => p.batch)?.batch ?? 1));
  return { at, of };
}

/** La sous-étape en cours est une attente (aucun geste) : l'écran passe à autre chose. */
export function inWait(s: SessionState, step: PlanStep): boolean {
  const n = currentPhase(s, step);
  return n != null && step.phases![n].wait === true;
}

/** Une attente qui tourne encore : l'étape compte comme « en fond », comme pendant son minuteur d'attente. */
export function waiting(s: SessionState, step: PlanStep, now: number): boolean {
  if (!inWait(s, step)) return false;
  const t = phaseTimer(s, step.id, currentPhase(s, step)!);
  return !!t && t.endsAt > now;
}

/** Le minuteur d'une sous-étape d'attente : quand il finit, il sonne comme celui d'une étape. */
export function isWaitTimer(plan: SessionPlan, t: TimerState): boolean {
  if (t.phase == null || !t.stepId) return false;
  return plan.steps.find((x) => x.id === t.stepId)?.phases?.[t.phase]?.wait === true;
}

/** Dernière activité d'une étape lancée : son lancement, ou la dernière sous-étape passée. */
const lastActivity = (s: SessionState, id: string) => Math.max(s.started.get(id) ?? 0, s.phaseAt.get(id) ?? 0);

/** Le minuteur en cours de l'étape elle-même (attente, mijotage), sans ceux des sous-étapes. */
export const stepTimer = (s: SessionState, stepId: string) => [...s.timers.values()].find((t) => t.stepId === stepId && t.phase == null && t.doneAt == null);

/** Le minuteur de la sous-étape `n` de l'étape, s'il tourne encore. */
export const phaseTimer = (s: SessionState, stepId: string, n: number) => [...s.timers.values()].find((t) => t.stepId === stepId && t.phase === n && t.doneAt == null);

/** Ids stables : deux écrans qui enchaînent la même sous-étape écrivent les mêmes événements (le serveur garde le premier). */
export const phaseIds = (sessionId: string, stepId: string, n: number) => ({
  timer: `ph${n}:${sessionId.slice(0, 8)}:${stepId}`,
  start: `phs-${n}-${sessionId.slice(0, 8)}-${stepId}`,
  done: `phd-${n}-${sessionId.slice(0, 8)}-${stepId}`,
  stop: `pht-${n}-${sessionId.slice(0, 8)}-${stepId}`,
});

/**
 * Étape à montrer en grand : la dernière touchée (lancée, ou sortie d'une sous-étape) qui n'attend pas
 * (minuteur d'attente ou sous-étape d'attente en cours) ; sinon, si tout attend, la prochaine à faire ;
 * sinon la dernière lancée.
 */
export function focusStep(plan: SessionPlan, s: SessionState, now: number): PlanStep | null {
  const active = plan.steps.filter((x) => stepStatus(s, x.id) === "active").sort((a, b) => lastActivity(s, b.id) - lastActivity(s, a.id));
  const running = (x: PlanStep) => waiting(s, x, now) || [...s.timers.values()].some((t) => t.stepId === x.id && t.phase == null && t.doneAt == null && t.endsAt > now);
  const free = active.find((x) => !running(x));
  if (free) return free;
  // Tout ce qui est lancé attend : la suite du plan, sauf si une attente de sous-étape tient l'écran faute de suite.
  return (active.some((x) => waiting(s, x, now)) ? nextTodo(plan, s) : null) ?? active[0] ?? nextTodo(plan, s);
}

export const nextTodo = (plan: SessionPlan, s: SessionState, after?: PlanStep | null) =>
  plan.steps.find((x) => stepStatus(s, x.id) === "todo" && x.id !== after?.id) ?? null;

/** Les étapes lancées qui tournent « en fond » (mijotage, four) pendant qu'on fait autre chose. */
export function backgroundSteps(plan: SessionPlan, s: SessionState, focus: PlanStep | null) {
  return plan.steps.filter((x) => x.id !== focus?.id && stepStatus(s, x.id) === "active");
}

/** Minutes d'attente d'une étape (ce qui reste quand le geste est fait). */
export const passiveMin = (st: PlanStep) =>
  // Avec des sous-étapes, leur temps est compté par leurs minuteurs : l'attente est ce qui reste après.
  st.phases?.length ? Math.max(0, st.durationMin - st.phases.reduce((x, p) => x + p.min, 0)) : Math.max(0, st.durationMin - st.activeMin);

export function randomId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch {
      /* contexte non sécurisé */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── À deux : le fil de chaque personne (gestes de prep et étapes, dans l'ordre des heures) ───

export type ThreadItem =
  | { type: "prep"; id: string; startMin: number; task: PrepTask }
  | { type: "step"; id: string; startMin: number; step: PlanStep };

export function threadOf(plan: SessionPlan, person: Person): ThreadItem[] {
  const items: ThreadItem[] = [
    ...plan.prep.tasks.filter((t) => t.person === person).map((t) => ({ type: "prep" as const, id: `prep:${t.id}`, startMin: t.startMin ?? 0, task: t })),
    ...plan.steps.filter((x) => (x.person ?? "A") === person).map((x) => ({ type: "step" as const, id: x.id, startMin: x.startMin, step: x })),
  ];
  return items.sort((a, b) => a.startMin - b.startMin || (a.type === "prep" ? -1 : 1) - (b.type === "prep" ? -1 : 1));
}

export const itemStatus = (s: SessionState, it: ThreadItem): StepStatus =>
  it.type === "prep" ? (s.prepDone.has(it.task.id) ? "done" : "todo") : stepStatus(s, it.id);

/** L'élément à montrer en grand pour une personne : son étape lancée sans minuteur en cours, sinon la suivante à faire. */
export function personFocus(plan: SessionPlan, s: SessionState, person: Person, now: number): ThreadItem | null {
  const th = threadOf(plan, person);
  const running = (it: ThreadItem) =>
    (it.type === "step" && waiting(s, it.step, now)) || [...s.timers.values()].some((t) => t.stepId === it.id && t.phase == null && t.doneAt == null && t.endsAt > now);
  const active = th.filter((it) => it.type === "step" && itemStatus(s, it) === "active").sort((a, b) => lastActivity(s, b.id) - lastActivity(s, a.id));
  return active.find((it) => !running(it)) ?? th.find((it) => itemStatus(s, it) === "todo") ?? active[0] ?? null;
}

export const personNext = (plan: SessionPlan, s: SessionState, person: Person, after: ThreadItem | null) =>
  threadOf(plan, person).find((it) => itemStatus(s, it) === "todo" && it.id !== after?.id) ?? null;

/** Les bols dont tous les gestes sont faits (à deux : un bol se remplit par plusieurs tâches). */
export function bowlsCompletedBy(plan: SessionPlan, done: Set<string>): string[] {
  return plan.bowls.filter((b) => b.tasks?.length && b.tasks.every((t) => done.has(t))).map((b) => b.letter);
}

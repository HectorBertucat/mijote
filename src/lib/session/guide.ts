// Ce que l'écran de session dit à chaque instant, déduit du plan et du journal (pur, testé :
// tests/session-guide.test.ts). Rien ne se lance tout seul : le bouton principal fait une seule
// chose et la nomme (« Lance 8 min : beurre + bol E », « Fait : bol G versé ») ; le retour défait
// la dernière action encore visible, pour chaque personne à deux ; un minuteur qui sonne dit de quoi
// il s'agit, ce qu'il touche, quoi faire maintenant et ce qui suit ; le fil range les étapes en
// « mains » (ce qui t'occupe), « en fond » (surveille, libre) et « ensuite ».
//
// Niveau d'attention et rappels : lus dans le plan s'il les porte (`attention`, `reminders` sur
// l'étape ou la sous-étape), sinon déduits du texte et du type d'étape.
import type { EventKind, SessionEvent, SessionState, TimerState } from "./state";
import type { Person, PlanBowlItem, PlanStep, PrepTask, SessionPlan } from "./planner";
import { currentPhase, liveTimer, passiveMin, phaseIds, phaseTimer, stepStatus, stepTimer } from "./state";
import { parseGesture } from "./gestures";
import { bowlParts, clip, stepTitleOf } from "./text";

export type Attention = "mains" | "surveille" | "libre";
export const ATTENTION_LABELS: Record<Attention, string> = { mains: "mains prises", surveille: "à surveiller", libre: "libre" };

/** Un rappel pendant une attente : toutes les `everyMin` minutes, ou une fois à `atMin`. */
export interface Reminder {
  text: string;
  everyMin?: number;
  atMin?: number;
}

/** Un événement à écrire (forme de `send`). */
export interface Ev {
  id?: string;
  kind: EventKind;
  ref?: string | null;
  payload?: Record<string, unknown> | null;
}

// ─── Formats ───

export const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${Number.isInteger(m) ? m : m.toFixed(1).replace(".", ",")} min`);
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);

const HOB_NAMES = ["grand foyer", "foyer moyen", "petit foyer"];
/** « grand foyer · 28 » : le rang du foyer dans la cuisine, et son diamètre. */
export const hobName = (plan: Pick<SessionPlan, "hobs">, id: string) => {
  const i = plan.hobs.findIndex((x) => x.id === id);
  const h = plan.hobs[i];
  return `${HOB_NAMES[i] ?? h?.name ?? id}${h?.diameterCm ? ` · ${String(h.diameterCm).replace(".", ",")}` : ""}`;
};

/** Ce qui se passe pendant l'attente d'une étape, en deux mots (« mijotage », « préchauffage »). */
export function passiveLabel(step: Pick<PlanStep, "kind">): string {
  switch (step.kind) {
    case "preheat":
      return "préchauffage";
    case "bake":
      return "cuisson au four";
    case "braise":
      return "mijotage";
    case "rest":
      return "repos";
    case "cool":
      return "refroidissement";
    default:
      return "cuisson";
  }
}

// ─── Attention et rappels ───

const isAttention = (x: unknown): x is Attention => x === "mains" || x === "surveille" || x === "libre";
const field = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

function guess(step: PlanStep, text: string, waiting: boolean): Attention {
  if (step.kind === "preheat") return "libre";
  if (!waiting) return /de temps en temps/i.test(text) ? "surveille" : "mains";
  if (/remue|surveille|mélange|écume|retourne/i.test(text)) return "surveille";
  if (/hors du feu|repos|refroidi|tiédi/i.test(text) || step.kind === "rest" || step.kind === "cool") return "libre";
  if (step.hobId) return "surveille";
  return "libre";
}

/**
 * Niveau d'attention de la sous-étape `n` (ou, sans sous-étape, du geste ; `passive` : de l'attente
 * qui suit) : « mains » occupe, « surveille » laisse faire autre chose en jetant un œil, « libre » non.
 */
export function attentionOf(step: PlanStep, n: number | null, passive = false): Attention {
  const ph = n != null ? step.phases?.[n] : undefined;
  const given = ph ? field(ph, "attention") : passive ? (field(step, "passiveAttention") ?? undefined) : field(step, "attention");
  if (isAttention(given)) return given;
  if (ph) return guess(step, ph.text, ph.wait === true);
  return guess(step, step.text, passive);
}

function readReminders(raw: unknown): Reminder[] {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  return list.flatMap((r): Reminder[] => {
    if (typeof r === "string") return r.trim() ? [{ text: r.trim(), everyMin: 5 }] : [];
    const text = field(r, "text") ?? field(r, "label");
    if (typeof text !== "string" || !text.trim()) return [];
    const every = Number(field(r, "everyMin") ?? field(r, "every") ?? NaN);
    const at = Number(field(r, "atMin") ?? field(r, "at") ?? NaN);
    if (every > 0) return [{ text: text.trim(), everyMin: every }];
    if (at >= 0) return [{ text: text.trim(), atMin: at }];
    return [{ text: text.trim(), everyMin: 5 }];
  });
}

/** Les rappels d'une attente : ceux du plan, sinon « remue » quand la consigne le demande ou qu'un mijotage est long. */
export function remindersOf(step: PlanStep, n: number | null, minutes = 0): Reminder[] {
  const ph = n != null ? step.phases?.[n] : undefined;
  const given = readReminders(ph ? field(ph, "reminders") : field(step, "reminders"));
  if (given.length) return given;
  const text = ph?.text ?? step.text;
  if (/ne touche pas|sans ouvrir|couvert(?!e)/i.test(text)) return [];
  if (/(remue|mélange).*(temps en temps|souvent|régulièrement)|de temps en temps/i.test(text)) return [{ text: "Remue", everyMin: 4 }];
  if (attentionOf(step, n, n == null) === "surveille" && step.kind === "braise" && minutes >= 8) return [{ text: "Remue, vérifie le feu", everyMin: 5 }];
  return [];
}

/** Le rappel qui tombe maintenant (dans la minute qui suit son heure) et le prochain, comptés depuis `since`. */
export function reminderAt(rems: Reminder[], since: number, now: number, until = Infinity): { due: { text: string; at: number } | null; next: { text: string; at: number } | null } {
  let due: { text: string; at: number } | null = null;
  let next: { text: string; at: number } | null = null;
  for (const r of rems) {
    const ticks: number[] = [];
    if (r.everyMin) {
      const every = r.everyMin * 60000;
      const k = Math.floor((now - since) / every);
      if (k >= 1) ticks.push(since + k * every);
      ticks.push(since + (k + 1) * every);
    } else if (r.atMin != null) ticks.push(since + r.atMin * 60000);
    for (const at of ticks) {
      // Un rappel qui tombe à la fin du minuteur n'a pas lieu d'être : c'est la sonnerie qui parle.
      if (at >= until - 30000) continue;
      if (at <= now && now - at < 60000 && (!due || at > due.at)) due = { text: r.text, at };
      if (at > now && (!next || at < next.at)) next = { text: r.text, at };
    }
  }
  return { due, next };
}

// ─── Repères sur l'étape ───

/** Rang de l'étape dans sa recette : « étape 2 sur 5 » du butter chicken. */
export function recipeStep(plan: Pick<SessionPlan, "steps">, step: PlanStep): { n: number; of: number } | null {
  if (!step.recipeSlug) return null;
  const mine = plan.steps.filter((s) => s.recipeSlug === step.recipeSlug).sort((a, b) => a.order - b.order);
  return { n: mine.findIndex((s) => s.id === step.id) + 1, of: mine.length };
}

/** Ce que pèse une pesée (à deux) : les ingrédients du bol avec leur quantité, ceux que la consigne cite. */
export function weighItems(plan: Pick<SessionPlan, "bowls">, task: Pick<PrepTask, "bowls" | "text">): PlanBowlItem[] {
  const out: PlanBowlItem[] = [];
  for (const l of task.bowls ?? []) {
    const b = plan.bowls.find((x) => x.letter === l);
    if (!b) continue;
    const cited = b.items.filter((i) => (task.text ?? "").toLowerCase().includes(parseGesture(i.item).base.toLowerCase()));
    out.push(...(cited.length ? cited : b.items));
  }
  return out;
}

/** Les bols cités dans un texte (dans l'ordre), parmi ceux du plan. */
export const bowlsIn = (plan: Pick<SessionPlan, "bowls">, text: string) => bowlParts(text, plan.bowls.map((b) => b.letter)).flatMap((p) => (p.t === "bowl" ? [p.v] : []));

/** Une sous-étape chronométrée : une attente, ou un geste d'au moins 2 min (« 3 min sans toucher »). */
export const timedPhase = (ph: { min: number; wait?: boolean | null }) => ph.wait === true || ph.min >= 2;

// ─── Le fil : en cours (mains), en fond (surveille, libre), ensuite ───

export interface LaneItem {
  step: PlanStep;
  /** Sous-étape en cours, null sans sous-étape (ou toutes faites). */
  phase: number | null;
  /** Ce qui se fait là, en clair : la sous-étape, ou « mijotage » pendant l'attente. */
  doing: string;
  attention: Attention;
  timer: TimerState | null;
  reminders: Reminder[];
  /** Depuis quand ça dure (compte des rappels). */
  since: number | null;
}

export function laneItem(plan: SessionPlan, state: SessionState, step: PlanStep, now: number): LaneItem {
  const n = stepStatus(state, step.id) === "active" ? currentPhase(state, step) : null;
  const raw = (n != null ? phaseTimer(state, step.id, n) : undefined) ?? stepTimer(state, step.id);
  const timer = raw ? liveTimer(raw, now) : null;
  const passive = n == null && timer != null && timer.phase == null;
  const ph = n != null ? step.phases![n] : null;
  const doing = ph ? ph.text : passive ? `${cap(passiveLabel(step))} · ${stepTitleOf(step, 40)}` : stepTitleOf(step);
  return {
    step,
    phase: n,
    doing,
    attention: attentionOf(step, n, passive),
    timer,
    reminders: timer ? remindersOf(step, n, timer.minutes) : [],
    since: timer?.startedAt ?? state.phaseAt.get(step.id) ?? state.started.get(step.id) ?? null,
  };
}

export interface Lanes {
  now: LaneItem | null;
  background: LaneItem[];
  next: PlanStep[];
  /** L'étape en cours laisse les mains libres : on peut commencer la suivante en parallèle. */
  freeHands: boolean;
}

const ownStep = (s: PlanStep, person: Person | null | undefined) => !person || (s.person ?? "A") === person;

/** Le fil d'un écran (à deux : d'une personne) autour de l'étape montrée. */
export function lanesOf(plan: SessionPlan, state: SessionState, now: number, focus: PlanStep | null, person?: Person | null): Lanes {
  const nowItem = focus && stepStatus(state, focus.id) === "active" ? laneItem(plan, state, focus, now) : null;
  const background = plan.steps
    .filter((s) => s.id !== focus?.id && ownStep(s, person) && stepStatus(state, s.id) === "active")
    .map((s) => laneItem(plan, state, s, now))
    .sort((a, b) => (a.timer?.endsAt ?? Infinity) - (b.timer?.endsAt ?? Infinity));
  const next = plan.steps.filter((s) => s.id !== focus?.id && ownStep(s, person) && stepStatus(state, s.id) === "todo").slice(0, 2);
  return { now: nowItem, background, next, freeHands: !nowItem || nowItem.attention !== "mains" };
}

// ─── Le bouton principal : une seule chose, nommée ───

export type MainKind = "start" | "phase-timer" | "phase" | "passive" | "finish";
export interface MainAction {
  kind: MainKind;
  /** Le libellé du bouton : ce qu'il fait. */
  label: string;
  /** Ce qui se passe ensuite, en une phrase (sous le bouton, et en infobulle). */
  hint: string;
  minutes?: number;
  /** Le geste de rechange : finir sans minuteur. */
  alt?: { kind: "phase" | "finish"; label: string };
}

/** Ce que fait le bouton principal sur l'étape `step`. */
export function mainAction(plan: SessionPlan, state: SessionState, step: PlanStep, _now?: number): MainAction {
  const st = stepStatus(state, step.id);
  const title = stepTitleOf(step, 34);
  const after = plan.steps.find((s) => s.id !== step.id && stepStatus(state, s.id) === "todo" && (s.person ?? "A") === (step.person ?? "A"));
  if (st !== "active") return { kind: "start", label: `Commencer : ${title}`, hint: step.phases?.length ? `${step.phases.length} sous-étapes, une à la fois. Aucun minuteur ne part tout seul.` : "L’étape passe en cours. Aucun minuteur ne part tout seul." };
  const n = currentPhase(state, step);
  if (n != null) {
    const ph = step.phases![n];
    const nxt = step.phases![n + 1];
    const raw = phaseTimer(state, step.id, n);
    const then = nxt ? `Ensuite : ${clip(nxt.text, 60)}.` : passiveMin(step) >= 3 ? `Dernière sous-étape ; puis ${passiveLabel(step)} (${Math.round(passiveMin(step))} min).` : "Dernière sous-étape : l’étape sera finie.";
    if (raw) return { kind: "phase", label: `${ph.wait ? "C’est prêt" : "Fait"} : ${clip(ph.text, 34)}`, hint: `Arrête son minuteur. ${then}` };
    if (timedPhase(ph)) return { kind: "phase-timer", label: `Lance ${fmtMin(ph.min)} : ${clip(ph.text, 30)}`, hint: `Le minuteur sonnera à la fin, rien d’autre ne démarre. ${then}`, minutes: ph.min, alt: { kind: "phase", label: "Fait, sans minuteur" } };
    return { kind: "phase", label: `Fait : ${clip(ph.text, 34)}`, hint: then };
  }
  const later = after ? ` Ensuite, à commencer quand tu veux : ${stepTitleOf(after, 50)}.` : "";
  if (stepTimer(state, step.id)) return { kind: "finish", label: `Fini : ${title}`, hint: `Arrête son minuteur, l’étape est finie.${later}` };
  const wait = Math.round(passiveMin(step));
  if (wait >= 3) return { kind: "passive", label: `Lance ${wait} min : ${passiveLabel(step)}`, hint: `Le minuteur sonnera à la fin ; l’étape passe en fond.`, minutes: wait, alt: { kind: "finish", label: "Déjà fini" } };
  return { kind: "finish", label: `Fait : ${title}`, hint: `L’étape est finie.${later}` };
}

/** Seul, geste glissé dans la cuisson : fait, il finit ses bols (quand leurs autres gestes sont faits). */
export function fillBowls(plan: SessionPlan, state: SessionState, step: PlanStep): Ev[] {
  if (!step.tasks) return [];
  return step.bowls
    .filter((l) => !state.bowlsReady.has(l) && (plan.bowls.find((b) => b.letter === l)?.during ?? []).every((d) => d.stepId === step.id || state.done.has(d.stepId)))
    .map((l) => ({ kind: "bowl_ready" as const, ref: l, payload: { ready: true } }));
}

interface EvOpts {
  sessionId: string;
  person?: Person | null;
  /** Ids d'événements (aléatoires dans l'appli, prévisibles dans les tests). */
  id: () => string;
}
const who = (o: EvOpts) => (o.person ? { person: o.person } : {});

/** Finir l'étape : ses sous-étapes restantes, son minuteur, puis l'étape. */
function finishEvents(plan: SessionPlan, state: SessionState, step: PlanStep, o: EvOpts): Ev[] {
  const out: Ev[] = [];
  const n = currentPhase(state, step);
  if (n != null)
    for (let i = n; i < step.phases!.length; i++) {
      const t = phaseTimer(state, step.id, i);
      if (t) out.push({ kind: "timer_done", ref: t.id });
      out.push({ id: o.id(), kind: "step_done", ref: `phase:${i}:${step.id}`, payload: o.person ? { person: o.person } : null });
    }
  const t = stepTimer(state, step.id);
  if (t) out.push({ kind: "timer_done", ref: t.id });
  return [...out, { kind: "step_done", ref: step.id, payload: o.person ? { person: o.person } : null }, ...fillBowls(plan, state, step)];
}

/** La sous-étape `n` faite (son minuteur arrêté) ; la dernière, sans attente derrière, finit l'étape. */
function phaseDoneEvents(plan: SessionPlan, state: SessionState, step: PlanStep, n: number, o: EvOpts): Ev[] {
  const out: Ev[] = [];
  const t = phaseTimer(state, step.id, n);
  if (t) out.push({ kind: "timer_done", ref: t.id });
  out.push({ id: o.id(), kind: "step_done", ref: `phase:${n}:${step.id}`, payload: o.person ? { person: o.person } : null });
  if (n === step.phases!.length - 1 && passiveMin(step) < 3 && !stepTimer(state, step.id)) out.push({ kind: "step_done", ref: step.id, payload: o.person ? { person: o.person } : null }, ...fillBowls(plan, state, step));
  return out;
}

/** Les événements du bouton principal (ou de son geste de rechange, `alt`). Jamais l'étape suivante, jamais un minuteur non nommé. */
export function mainEvents(plan: SessionPlan, state: SessionState, step: PlanStep, now: number, o: EvOpts, alt = false): Ev[] {
  const a = mainAction(plan, state, step, now);
  const kind = alt ? a.alt?.kind : a.kind;
  const n = currentPhase(state, step);
  switch (kind) {
    case "start":
      return [{ id: o.id(), kind: "step_start", ref: step.id, payload: o.person ? { person: o.person } : null }];
    case "phase-timer": {
      const ph = step.phases![n!];
      return [{ id: o.id(), kind: "timer_start", ref: phaseIds(o.sessionId, step.id, n!).timer, payload: { label: ph.text, minutes: ph.min, stepId: step.id, phase: n, endsAt: new Date(now + ph.min * 60000).toISOString(), ...who(o) } }];
    }
    case "phase":
      return phaseDoneEvents(plan, state, step, n!, o);
    case "passive": {
      const min = a.minutes!;
      return [{ id: o.id(), kind: "timer_start", ref: o.id(), payload: { label: `${cap(passiveLabel(step))} · ${stepTitleOf(step, 40)}`, minutes: min, stepId: step.id, auto: true, passive: true, endsAt: new Date(now + min * 60000).toISOString(), ...who(o) } }];
    }
    case "finish":
      return finishEvents(plan, state, step, o);
    default:
      return [];
  }
}

/** Arrêter un minuteur : celui d'une sous-étape la finit (la suivante attend son geste) ; une attente finie finit l'étape. */
export function stopEvents(plan: SessionPlan, state: SessionState, t: TimerState, now: number, o: EvOpts & { auto: boolean }): Ev[] {
  const step = t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
  if (step && t.phase != null && currentPhase(state, step) === t.phase) return phaseDoneEvents(plan, state, step, t.phase, o);
  const out: Ev[] = [{ kind: "timer_done", ref: t.id }];
  if (step && o.auto && t.endsAt <= now && stepStatus(state, step.id) === "active") out.push({ kind: "step_done", ref: step.id, payload: o.person ? { person: o.person } : null }, ...fillBowls(plan, state, step));
  return out;
}

// ─── Le retour : la dernière action encore visible, par personne ───

/** À qui appartient ce qu'un événement touche (à deux) : la personne de l'étape, du geste ou du minuteur. */
export function ownerOf(plan: SessionPlan, state: SessionState, kind: EventKind, ref: string | null): Person | null {
  if (!ref) return null;
  const stepOwner = (id: string) => {
    const s = plan.steps.find((x) => x.id === id);
    return s ? (s.person ?? "A") : null;
  };
  if (kind === "timer_start") {
    const t = state.timers.get(ref);
    return t?.stepId ? stepOwner(t.stepId) : null;
  }
  if (ref.startsWith("prep:")) return plan.prep.tasks.find((t) => t.id === ref.slice(5))?.person ?? null;
  if (ref.startsWith("phase:")) return stepOwner(ref.slice(6).replace(/^\d+:/, ""));
  return stepOwner(ref);
}

export interface Undo {
  /** Le libellé du bouton (« Revenir à : beurre + bol E »). */
  label: string;
  /** Ce que ça défait, en une phrase. */
  detail: string;
  events: Ev[];
}

/**
 * Le retour : défait la dernière action (de cette personne, à deux) dont l'effet se voit encore :
 * un « Commencer », une sous-étape ou une étape faite, un geste de prep, un minuteur lancé.
 */
export function undoFor(plan: SessionPlan, state: SessionState, events: SessionEvent[], person: Person | null): Undo | null {
  const pay = (extra: Record<string, unknown> = {}) => ({ undo: true, ...extra, ...(person ? { person } : {}) });
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e.ref || e.payload?.undo === true) continue;
    if (!(e.kind === "step_start" || e.kind === "step_done" || (e.kind === "timer_start" && e.payload?.adjust !== true))) continue;
    if (person && ownerOf(plan, state, e.kind, e.ref) !== person) continue;
    const at = Date.parse(e.at);
    if (e.kind === "timer_start") {
      const t = state.timers.get(e.ref);
      if (!t || t.doneAt != null || t.startedAt !== at) continue;
      return { label: `Annuler le minuteur ${fmtMin(t.refMinutes)}`, detail: `Arrête « ${clip(t.label, 50)} » sans rien marquer fait.`, events: [{ kind: "timer_done", ref: t.id }] };
    }
    if (e.ref.startsWith("prep:")) {
      const id = e.ref.slice(5);
      if (!state.prepDone.has(id)) continue;
      const task = plan.prep.tasks.find((t) => t.id === id);
      const bowls = plan.bowls.filter((b) => b.tasks?.includes(id) && state.bowlsReady.has(b.letter));
      return {
        label: `Revenir à : ${task ? clip(task.kind === "weigh" ? `pesée ${task.title.toLowerCase()}` : task.title, 34) : "ce geste"}`,
        detail: "Le geste redevient à faire.",
        events: [{ kind: "step_done", ref: e.ref, payload: pay() }, ...bowls.map((b) => ({ kind: "bowl_ready" as const, ref: b.letter, payload: { ready: false, ...(person ? { person } : {}) } }))],
      };
    }
    if (e.ref.startsWith("phase:")) {
      const key = e.ref.slice(6);
      const n = Number(key.split(":")[0]);
      const stepId = key.replace(/^\d+:/, "");
      const step = plan.steps.find((s) => s.id === stepId);
      if (!step || !state.phasesDone.has(key) || state.phasesDone.has(`${n + 1}:${stepId}`) || state.done.has(stepId)) continue;
      const nextTimer = phaseTimer(state, stepId, n + 1);
      return {
        label: `Revenir à : ${clip(step.phases?.[n]?.text ?? stepTitleOf(step), 34)}`,
        detail: `La sous-étape ${n + 1} redevient celle en cours (étape ${step.no}).`,
        events: [...(nextTimer ? [{ kind: "timer_done" as const, ref: nextTimer.id }] : []), { kind: "step_done", ref: e.ref, payload: pay() }],
      };
    }
    const step = plan.steps.find((s) => s.id === e.ref);
    if (!step) continue;
    if (e.kind === "step_done") {
      if (state.done.get(step.id) !== at) continue;
      return { label: `Rouvrir : ${stepTitleOf(step, 34)}`, detail: `L’étape ${step.no} redevient en cours.`, events: [{ kind: "step_done", ref: step.id, payload: pay() }] };
    }
    if (state.started.get(step.id) !== at || state.done.has(step.id)) continue;
    const timers = [...state.timers.values()].filter((t) => t.stepId === step.id && t.doneAt == null);
    return {
      label: `Pas encore : ${stepTitleOf(step, 34)}`,
      detail: `L’étape ${step.no} redevient à commencer${timers.length ? ", son minuteur s’arrête" : ""}.`,
      events: [...timers.map((t) => ({ kind: "timer_done" as const, ref: t.id })), { kind: "step_start", ref: step.id, payload: pay() }],
    };
  }
  return null;
}

// ─── Ça sonne : de quoi il s'agit, ce que ça touche, quoi faire ───

export interface RingInfo {
  recipe: { slug: string; name: string; color: string } | null;
  step: PlanStep | null;
  /** Ce qui vient de finir (« La sauce mijote »). */
  finished: string;
  /** Ce que ça touche : récipient, foyer et niveau, four. */
  where: string[];
  /** Les bols de l'action à faire. */
  bowls: string[];
  /** L'action à faire maintenant, en grand. */
  action: string;
  /** Le repère de la fiche (« la sauce nappe la cuillère »). */
  cue: string | null;
  /** Et après. */
  after: string | null;
  /** Le libellé du bouton qui arrête. */
  stop: string;
}

const KIND_ACTION: Partial<Record<PlanStep["kind"], string>> = {
  preheat: "Le four est chaud : enfourne quand l’étape le demande",
  bake: "Sors du four, avec les gants",
  braise: "Vérifie la cuisson, puis coupe le feu",
  boil: "Vérifie la cuisson, puis coupe le feu et égoutte",
  sear: "Vérifie la cuisson",
  rest: "C’est reposé",
  cool: "C’est refroidi : ferme et range",
};

export function ringInfo(plan: SessionPlan, state: SessionState, t: TimerState): RingInfo {
  const step = t.stepId ? (plan.steps.find((x) => x.id === t.stepId) ?? null) : null;
  const recipe = step ? (plan.recipes.find((r) => r.slug === step.recipeSlug) ?? null) : null;
  if (!step) return { recipe: null, step: null, finished: t.label, where: [], bowls: [], action: "Le minuteur est fini", cue: null, after: null, stop: "Arrêter le minuteur" };
  const n = t.phase;
  const ph = n != null ? step.phases?.[n] : undefined;
  const nxt = n != null ? step.phases?.[n + 1] : undefined;
  const sameRecipe = plan.steps.find((s) => s.id !== step.id && s.recipeSlug && s.recipeSlug === step.recipeSlug && stepStatus(state, s.id) === "todo");
  const level = nxt?.hobLevel ?? ph?.hobLevel ?? null;
  const where = [
    step.kind !== "preheat" ? step.equipmentName : null,
    step.hobId ? `${hobName(plan, step.hobId)}${level != null ? ` · niveau ${level}` : step.hobLevelLabel ? ` · niveau ${step.hobLevelLabel}` : step.hobLevel != null ? ` · niveau ${step.hobLevel}` : ""}` : null,
    step.oven ? `four ${step.oven.temp} °C${step.oven.levels.length ? ` · gradin${step.oven.levels.length > 1 ? "s" : ""} ${step.oven.levels.join(" et ")}` : ""}` : step.kind === "preheat" ? `four ${step.text.match(/(\d+)\s*°C/)?.[1] ?? ""} °C`.replace(/\s+°C$/, "") : null,
  ].filter((x): x is string => Boolean(x));
  const thenStep = sameRecipe ? `Étape suivante de la recette : ${stepTitleOf(sameRecipe, 60)}` : null;
  if (ph) {
    const lastNoWait = !nxt && passiveMin(step) < 3;
    return {
      recipe,
      step,
      finished: ph.text,
      where,
      bowls: nxt ? bowlsIn(plan, nxt.text) : [],
      action: nxt ? nxt.text : `L’étape ${step.no} est finie : ${KIND_ACTION[step.kind]?.toLowerCase() ?? "vérifie et passe à la suite"}`,
      cue: !nxt ? step.cue : null,
      after: step.phases?.[n! + 2]?.text ?? thenStep,
      stop: nxt ? `Arrêter · passer à : ${clip(nxt.text, 26)}` : lastNoWait ? `Arrêter · étape ${step.no} finie` : "Arrêter la sonnerie",
    };
  }
  return {
    recipe,
    step,
    finished: `${cap(passiveLabel(step))} · ${stepTitleOf(step, 50)}`,
    where,
    bowls: [],
    action: KIND_ACTION[step.kind] ?? "Vérifie et passe à la suite",
    cue: step.cue,
    after: thenStep,
    stop: `Arrêter · étape ${step.no} finie`,
  };
}

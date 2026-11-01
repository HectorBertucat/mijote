// Séance en cours, partagée entre plusieurs écrans (MacBook + téléphones) : l'état complet tient dans
// un objet `Live`, et chaque geste est une `LiveAction` appliquée par `act` (pur). Le serveur garde
// l'état et un numéro de version ; un écran envoie l'état qu'il a calculé avec la version qu'il
// croyait à jour, et le premier arrivé gagne. Les gestes qui avancent la séance portent l'étape où
// ils ont été faits (`at`) : rejoués sur un état qui a déjà bougé, ils ne font rien.
// Toutes les heures sont celles du serveur (ms epoch) ; chaque écran corrige l'écart de son horloge.
// Le rythme guidé ne stocke que son heure de départ : la phase, le côté et le compte s'en déduisent.
// Il part après un décompte de mise en place (`opts.lead`) ; la pause fige toutes les horloges de l'étape
// (rythme, repos, finisher) et la reprise les décale d'autant. En mode automatique (`opts.auto`, réglé
// par personne), chaque série démarre seule après ce décompte, ou après `opts.change` secondes quand on
// change d'exercice : la séance s'enchaîne sans toucher l'écran, et reste pilotable à tout moment.
import { buildSteps, levelFor, withBonus, type LiveStep, type Program, type Workout } from "./program";

export const SWITCH_SEC = 5; // pause pour changer de côté
export const AUTO_NEXT_MS = 1200; // fin du rythme guidé → série notée toute seule

/** Réglages du rythme guidé d'une personne (gardés avec elle, copiés dans chaque séance). */
export interface GuideOpts {
  auto: boolean; // enchaîner seul : chaque série démarre après le décompte, se note à la fin
  lead: number; // secondes pour se mettre en place avant une série
  change: number; // secondes pour passer d'un exercice à un autre (matériel, position)
}
export const DEFAULT_OPTS: GuideOpts = { auto: false, lead: 5, change: 10 };
export const OPTS_BOUNDS = { lead: [0, 30], change: [0, 90] } as const;
const clampSec = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Réglages lus d'une valeur quelconque (base, requête), bornés ; les valeurs manquantes prennent le défaut. */
export function normOpts(x: unknown): GuideOpts {
  const o = (x && typeof x === "object" ? x : {}) as Partial<Record<keyof GuideOpts, unknown>>;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    auto: typeof o.auto === "boolean" ? o.auto : DEFAULT_OPTS.auto,
    lead: clampSec(n(o.lead, DEFAULT_OPTS.lead), OPTS_BOUNDS.lead),
    change: clampSec(n(o.change, DEFAULT_OPTS.change), OPTS_BOUNDS.change),
  };
}
export const optsOf = (l: Live) => normOpts(l.opts);

/** Ce qui ne vaut que pour l'étape affichée : remis à zéro quand on change d'étape. */
export interface Cur {
  reps?: number; // objectif choisi pour la série
  guide?: number; // départ du rythme guidé (après le décompte de mise en place : peut être dans le futur)
  restEnd?: number; // fin du repos
  emom?: number; // départ du finisher au bip
  paused?: number; // en pause depuis : les horloges de l'étape sont figées à cet instant
}

export interface Live {
  program: string;
  type: string;
  steps: LiveStep[];
  i: number;
  t0: number;
  log: Record<string, number[]>;
  levels: Record<string, number>;
  cur: Cur;
  pair?: string; // séance à deux : l'id de la séance de l'autre, affichée à côté sur le même écran
  opts?: GuideOpts; // réglages du rythme guidé de la personne (absents : DEFAULT_OPTS)
}

export type LiveAction =
  | { k: "go"; at: number; n: 1 | -1 }
  | { k: "record"; at: number; ex: string; set: number; value: number; level?: number }
  | { k: "correct"; ex: string; set: number; value: number }
  | { k: "level"; ex: string; level: number }
  | { k: "reps"; at: number; reps: number }
  | { k: "guide"; at: number; on: boolean; reps?: number; lead?: number }
  | { k: "pause"; at: number }
  | { k: "resume"; at: number }
  | { k: "lead+"; at: number; sec: number }
  | { k: "opts"; opts: Partial<GuideOpts> }
  | { k: "rest+"; at: number; sec: number }
  | { k: "emom"; at: number }
  | { k: "bonus"; at: number };

export function startLive(p: Program, type: string, now: number, opts?: GuideOpts): Live {
  return { program: p.id, type, steps: buildSteps(p, type), i: 0, t0: now, log: {}, levels: {}, cur: {}, ...(opts ? { opts: normOpts(opts) } : {}) };
}

/** Le travail (série ou finisher) d'avant l'étape `i`, s'il la précède directement (pas de repos entre). */
function workBefore(steps: LiveStep[], i: number): string | null {
  const s = steps[i - 1];
  return s && (s.k === "ex" || s.k === "emom") ? s.ex : null;
}

/** Secondes de mise en place avant l'étape `i` : `change` si on vient d'un autre exercice sans repos, sinon `lead`. */
export function leadFor(l: Live, i: number): number {
  const o = optsOf(l);
  const s = l.steps[i];
  const prev = workBefore(l.steps, i);
  return s && (s.k === "ex" || s.k === "emom") && prev && prev !== s.ex ? Math.max(o.lead, o.change) : o.lead;
}

/** L'état d'une étape quand on y arrive : le repos démarre tout seul ; en mode automatique, la série et le finisher aussi, après la mise en place. */
function enter(l: Live, i: number, now: number): Live {
  const s = l.steps[i];
  if (s?.k === "rest") return { ...l, i, cur: { restEnd: now + s.sec * 1000 } };
  if (optsOf(l).auto && s?.k === "ex") return { ...l, i, cur: { guide: now + leadFor(l, i) * 1000 } };
  if (optsOf(l).auto && s?.k === "emom") return { ...l, i, cur: { emom: now + leadFor(l, i) * 1000 } };
  return { ...l, i, cur: {} };
}

/** Décale les horloges de l'étape de `ms` (reprise après une pause, décompte allongé). */
function shift(c: Cur, ms: number): Cur {
  return { ...c, ...(c.guide != null ? { guide: c.guide + ms } : {}), ...(c.restEnd != null ? { restEnd: c.restEnd + ms } : {}), ...(c.emom != null ? { emom: c.emom + ms } : {}) };
}

export function act(p: Program, l: Live, a: LiveAction, now: number, workouts: Workout[] = []): Live {
  if ("at" in a && a.at !== l.i) return l; // geste fait sur une étape déjà passée
  const last = l.steps.length - 1;
  switch (a.k) {
    case "go":
      return enter(l, Math.max(0, Math.min(last, l.i + a.n)), now);
    case "record": {
      const sets = [...(l.log[a.ex] ?? [])];
      sets[a.set - 1] = a.value;
      const levels = { ...l.levels, [a.ex]: a.level ?? l.levels[a.ex] ?? levelFor(workouts, a.ex) };
      return enter({ ...l, log: { ...l.log, [a.ex]: sets }, levels }, Math.min(last, l.i + 1), now);
    }
    case "correct": {
      const sets = [...(l.log[a.ex] ?? [])];
      if (a.set < 1 || a.set > sets.length + 1) return l;
      sets[a.set - 1] = Math.max(0, Math.round(a.value));
      return { ...l, log: { ...l.log, [a.ex]: sets } };
    }
    case "level":
      return { ...l, levels: { ...l.levels, [a.ex]: a.level } };
    case "reps":
      return { ...l, cur: { ...l.cur, reps: Math.max(1, Math.round(a.reps)) } };
    case "guide": {
      const lead = a.lead ?? optsOf(l).lead;
      const { paused: _, ...cur } = l.cur;
      return { ...l, cur: { ...cur, guide: a.on ? now + Math.max(0, lead) * 1000 : undefined, reps: a.reps ?? l.cur.reps } };
    }
    case "pause":
      return l.cur.paused != null ? l : { ...l, cur: { ...l.cur, paused: now } };
    case "resume": {
      if (l.cur.paused == null) return l;
      const { paused, ...cur } = l.cur;
      return { ...l, cur: shift(cur, Math.max(0, now - paused)) };
    }
    case "lead+": {
      // Le décompte de mise en place s'allonge (ou part tout de suite avec sec < 0) ; rien une fois la série lancée.
      const start = l.cur.guide ?? l.cur.emom;
      const ref = l.cur.paused ?? now;
      if (start == null || start <= ref) return l;
      const next = Math.max(ref, start + a.sec * 1000);
      return { ...l, cur: l.cur.guide != null ? { ...l.cur, guide: next } : { ...l.cur, emom: next } };
    }
    case "opts": {
      const opts = normOpts({ ...optsOf(l), ...a.opts });
      const s = l.steps[l.i];
      // Passer en automatique sur une série pas encore lancée la lance (après la mise en place).
      const kick = opts.auto && !optsOf(l).auto && l.cur.paused == null;
      if (kick && s?.k === "ex" && l.cur.guide == null) return { ...l, opts, cur: { ...l.cur, guide: now + opts.lead * 1000 } };
      if (kick && s?.k === "emom" && l.cur.emom == null) return { ...l, opts, cur: { ...l.cur, emom: now + opts.lead * 1000 } };
      return { ...l, opts };
    }
    case "rest+":
      return l.cur.restEnd ? { ...l, cur: { ...l.cur, restEnd: l.cur.restEnd + a.sec * 1000 } } : l;
    case "emom":
      return { ...l, cur: { ...l.cur, emom: now + optsOf(l).lead * 1000 } };
    case "bonus":
      return { ...l, steps: withBonus(p, l.steps, l.i), cur: {} };
  }
}

/** Où en est le rythme guidé `t` secondes après son départ. `dur` = durée d'un côté (reps × cycle,
 * ou des secondes pour la planche). Avant le départ (t < 0) : la mise en place, `t` = secondes restantes
 * en négatif. Unilatéral : côté 1, pause de 5 s, côté 2. */
export function guideAt(t: number, dur: number, uni: boolean): { phase: "ready" | "run" | "switch" | "done"; side: 1 | 2; t: number } {
  if (t < 0) return { phase: "ready", side: 1, t };
  if (t < dur) return { phase: "run", side: 1, t };
  if (!uni) return { phase: "done", side: 1, t: dur };
  if (t < dur + SWITCH_SEC) return { phase: "switch", side: 1, t: t - dur };
  if (t < 2 * dur + SWITCH_SEC) return { phase: "run", side: 2, t: t - dur - SWITCH_SEC };
  return { phase: "done", side: 2, t: dur };
}

/** Objectif proposé pour une série : la série d'avant dans la séance, sinon la même la dernière fois, sinon le bas de la fourchette. */
export function suggestedReps(l: Live, workouts: Workout[], ex: string, set: number, low: number): number {
  const before = l.log[ex]?.[set - 2];
  if (before != null) return before;
  for (const w of workouts) {
    const e = w.entries.find((x) => x.ex === ex);
    if (e) return e.sets[set - 1] ?? e.sets.at(-1) ?? low;
  }
  return low;
}

/** L'heure qui fait avancer les horloges de l'étape : figée pendant une pause. */
export const clockOf = (l: Live, now: number) => l.cur.paused ?? now;

/** Les entrées du carnet à la fin de la séance. */
export const entriesOf = (l: Live) => Object.keys(l.log).map((ex) => ({ ex, sets: (l.log[ex] ?? []).filter((x) => x != null), level: l.levels[ex] ?? 0 }));

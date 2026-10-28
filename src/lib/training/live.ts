// Séance en cours, partagée entre plusieurs écrans (MacBook + téléphones) : l'état complet tient dans
// un objet `Live`, et chaque geste est une `LiveAction` appliquée par `act` (pur). Le serveur garde
// l'état et un numéro de version ; un écran envoie l'état qu'il a calculé avec la version qu'il
// croyait à jour, et le premier arrivé gagne. Les gestes qui avancent la séance portent l'étape où
// ils ont été faits (`at`) : rejoués sur un état qui a déjà bougé, ils ne font rien.
// Toutes les heures sont celles du serveur (ms epoch) ; chaque écran corrige l'écart de son horloge.
// Le rythme guidé ne stocke que son heure de départ : la phase, le côté et le compte s'en déduisent.
import { buildSteps, levelFor, withBonus, type LiveStep, type Program, type Workout } from "./program";

export const SWITCH_SEC = 5; // pause pour changer de côté
export const AUTO_NEXT_MS = 1200; // fin du rythme guidé → série notée toute seule

/** Ce qui ne vaut que pour l'étape affichée : remis à zéro quand on change d'étape. */
export interface Cur {
  reps?: number; // objectif choisi pour la série
  guide?: number; // départ du rythme guidé
  restEnd?: number; // fin du repos
  emom?: number; // départ du finisher au bip
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
}

export type LiveAction =
  | { k: "go"; at: number; n: 1 | -1 }
  | { k: "record"; at: number; ex: string; set: number; value: number; level?: number }
  | { k: "correct"; ex: string; set: number; value: number }
  | { k: "level"; ex: string; level: number }
  | { k: "reps"; at: number; reps: number }
  | { k: "guide"; at: number; on: boolean; reps?: number }
  | { k: "rest+"; at: number; sec: number }
  | { k: "emom"; at: number }
  | { k: "bonus"; at: number };

export function startLive(p: Program, type: string, now: number): Live {
  return { program: p.id, type, steps: buildSteps(p, type), i: 0, t0: now, log: {}, levels: {}, cur: {} };
}

/** L'état d'une étape quand on y arrive : le repos démarre tout seul. */
function enter(l: Live, i: number, now: number): Live {
  const s = l.steps[i];
  return { ...l, i, cur: s?.k === "rest" ? { restEnd: now + s.sec * 1000 } : {} };
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
    case "guide":
      return { ...l, cur: { ...l.cur, guide: a.on ? now : undefined, reps: a.reps ?? l.cur.reps } };
    case "rest+":
      return l.cur.restEnd ? { ...l, cur: { ...l.cur, restEnd: l.cur.restEnd + a.sec * 1000 } } : l;
    case "emom":
      return { ...l, cur: { ...l.cur, emom: now } };
    case "bonus":
      return { ...l, steps: withBonus(p, l.steps, l.i), cur: {} };
  }
}

/** Où en est le rythme guidé `t` secondes après son départ. `dur` = durée d'un côté (reps × cycle,
 * ou des secondes pour la planche). Unilatéral : côté 1, pause de 5 s, côté 2. */
export function guideAt(t: number, dur: number, uni: boolean): { phase: "run" | "switch" | "done"; side: 1 | 2; t: number } {
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

/** Les entrées du carnet à la fin de la séance. */
export const entriesOf = (l: Live) => Object.keys(l.log).map((ex) => ({ ex, sets: (l.log[ex] ?? []).filter((x) => x != null), level: l.levels[ex] ?? 0 }));

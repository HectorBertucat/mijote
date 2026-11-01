// Ce que l'app iPhone lit d'une séance sans refaire les calculs du site : la phase en cours et l'heure où
// elle finit (l'app décompte en local), et ses gestes nommés (`start`, `pause`, `next`…) traduits en gestes
// de live.ts. Plus le nettoyage des réponses (une valeur absente = clé absente). Module pur.
import { cycleDuration, type Motion } from "@/lib/training/motion";
import { AUTO_LATE_MS, AUTO_NEXT_MS, guideAt, optsOf, SWITCH_SEC, type Live, type LiveAction } from "@/lib/training/live";
import type { Exercise } from "@/lib/training/program";

export type Phase = "warmup" | "setup" | "work" | "switch" | "rest" | "bonus" | "paused" | "done";

export interface LiveState {
  revision: number;
  serverTime: number;
  phase: Phase;
  /** Phase interrompue par la pause. */
  pausedPhase?: Phase;
  /** Fin de la phase (ms epoch, heure du serveur) ; absente si elle attend un geste. */
  phaseEndsAt?: number;
  /** Série en cours : côté (unilatéral), objectif, durée d'un côté en secondes. */
  side?: 1 | 2;
  auto: boolean;
  /** Geste qu'un écran envoie seul à la fin de la phase (`record` d'une série guidée ou du finisher, `go` d'un
   * repos), à partir de `autoAt` et seulement avant `autoUntil` (ms, heure du serveur) : passé ce délai, la
   * séance a été oubliée, on attend un geste de la personne. */
  autoGesture?: "record" | "go";
  autoAt?: number;
  autoUntil?: number;
}

/** La phase d'une séance à l'instant `now` (heure du serveur). `ex`, `motion`, `reps` : l'exercice en cours. */
export function phaseOf(l: Live, ended: boolean, version: number, now: number, cur: { ex: Exercise; motion: Motion | null; reps: number } | null): LiveState {
  const base = { revision: version, serverTime: now, auto: optsOf(l).auto };
  const step = l.steps[l.i];
  if (ended || !step || step.k === "end") return { ...base, phase: "done" };
  const at = l.cur.paused ?? now;
  const auto = (gesture: "record" | "go", from: number) => ({ autoGesture: gesture, autoAt: from, autoUntil: from + AUTO_LATE_MS });
  const inner = ((): Omit<LiveState, "revision" | "serverTime" | "auto"> => {
    if (step.k === "warm") return { phase: "warmup" };
    if (step.k === "bonus") return { phase: "bonus" };
    if (step.k === "rest") return { phase: "rest", ...(l.cur.restEnd != null ? { phaseEndsAt: l.cur.restEnd, ...auto("go", l.cur.restEnd) } : {}) };
    if (step.k === "emom") {
      const t0 = l.cur.emom;
      if (t0 == null) return { phase: "work" };
      if (at < t0) return { phase: "setup", phaseEndsAt: t0 };
      const end = t0 + step.rounds * step.every * 1000;
      return { phase: "work", phaseEndsAt: end, ...auto("record", end) };
    }
    // Une série : sans rythme guidé, elle attend « Série faite ».
    const t0 = l.cur.guide;
    if (t0 == null || !cur) return { phase: "work" };
    const seconds = cur.ex.unit === "s";
    const dur = seconds ? cur.reps : cur.reps * (cur.motion ? cycleDuration(cur.motion) : 1);
    const g = guideAt((at - t0) / 1000, dur, cur.ex.uni);
    if (g.phase === "ready") return { phase: "setup", phaseEndsAt: t0 };
    if (g.phase === "switch") return { phase: "switch", side: 1, phaseEndsAt: t0 + (dur + SWITCH_SEC) * 1000 };
    const last = t0 + (cur.ex.uni ? 2 * dur + SWITCH_SEC : dur) * 1000;
    if (g.phase === "run") return { phase: "work", side: g.side, phaseEndsAt: t0 + (g.side === 1 ? dur : 2 * dur + SWITCH_SEC) * 1000, ...auto("record", last + AUTO_NEXT_MS) };
    return { phase: "work", side: g.side, phaseEndsAt: last, ...auto("record", last + AUTO_NEXT_MS) };
  })();
  if (l.cur.paused != null) {
    const { phaseEndsAt: _, autoGesture: _g, autoAt: _a, autoUntil: _u, ...rest } = inner;
    return { ...base, ...rest, phase: "paused", pausedPhase: inner.phase };
  }
  return { ...base, ...inner };
}

/** Gestes nommés de l'app → gestes de live.ts, sur l'étape en cours. `null` : rien à faire ici. */
export function actionOf(
  l: Live,
  a: { action: string; reps?: number; sec?: number },
  cur: { ex: string; set: number; reps: number; level: number } | null,
): LiveAction | null {
  const at = l.i;
  const step = l.steps[at];
  switch (a.action) {
    case "start":
      if (step?.k === "emom") return { k: "emom", at };
      return step?.k === "ex" ? { k: "guide", at, on: true, ...(a.reps ? { reps: a.reps } : {}) } : { k: "go", at, n: 1 };
    case "stop":
      return { k: "guide", at, on: false };
    case "start_now":
      return { k: "lead+", at, sec: -3600 };
    case "more_time":
      return step?.k === "rest" ? { k: "rest+", at, sec: a.sec ?? 15 } : { k: "lead+", at, sec: a.sec ?? 5 };
    case "pause":
      return { k: "pause", at };
    case "resume":
      return { k: "resume", at };
    case "next":
    case "skip":
      return { k: "go", at, n: 1 };
    case "previous":
      return { k: "go", at, n: -1 };
    case "auto_on":
      return { k: "opts", opts: { auto: true } };
    case "auto_off":
      return { k: "opts", opts: { auto: false } };
    case "log":
      if (step?.k === "ex" && cur) return { k: "record", at, ex: cur.ex, set: cur.set, value: Math.max(0, Math.round(a.reps ?? cur.reps)), level: cur.level };
      if (step?.k === "emom") return { k: "record", at, ex: step.ex, set: 1, value: Math.max(0, Math.round(a.reps ?? step.rounds * step.reps)) };
      return null;
  }
  return null;
}

export const ACTIONS = ["start", "stop", "start_now", "more_time", "pause", "resume", "next", "skip", "previous", "auto_on", "auto_off", "log"] as const;

/** Une valeur absente s'écrit clé absente : les `null` et `undefined` des objets disparaissent ; dans un tableau,
 * ils restent (un trou dans une série garde sa place). */
export function clean(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(clean);
  if (x instanceof Date) return x.toISOString();
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) if (v !== null && v !== undefined) out[k] = clean(v);
    return out;
  }
  return x;
}

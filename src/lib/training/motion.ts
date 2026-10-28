// Mouvement d'un exercice : des poses clés et une suite d'étapes chronométrées (le tempo).
// La même horloge pilote la figure, le libellé de phase (« Descends 3·2·1 », « Tiens »),
// les bips et le compteur de répétitions. Module pur.
import { mix, mixConstraints, solve, type Angles, type Constraints, type Pt, type Skeleton } from "./skeleton";

/** Kettlebell : tenue par une main (ou les deux, côté proche), centre décalé de la main. */
export interface Bell {
  hand: "handN" | "handF";
  dx: number;
  dy: number;
}

export interface Key {
  a: Angles;
  c: Constraints;
  bell?: Bell | null;
}

export interface Step {
  to: number; // index de la pose visée (= la pose actuelle pour un temps d'arrêt)
  dur: number; // secondes
  label: string; // ce que dit l'écran pendant l'étape
  count?: boolean; // afficher le décompte (secondes) pendant l'étape
}

export interface Motion {
  keys: Key[];
  steps: Step[];
  props?: { kind: "bench"; x: number; y: number; w: number; h: number }[];
}

export const cycleDuration = (m: Motion) => m.steps.reduce((s, x) => s + x.dur, 0);

/** Courbe d'accélération des figures (douce au départ et à l'arrivée) : partagée avec le guide du rythme. */
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface Frame {
  skel: Skeleton;
  bell: { at: Pt; handle: Pt } | null;
  step: number;
  label: string;
  remaining: number; // secondes restantes dans l'étape
  stepDur: number;
  rep: number; // répétitions terminées depuis t = 0
  count: boolean;
}

function bellAt(skel: Skeleton, b: Bell | null | undefined): Frame["bell"] {
  if (!b) return null;
  const h = skel[b.hand];
  return { handle: h, at: [h[0] + b.dx, h[1] + b.dy] };
}

function mixBell(a: Bell | null | undefined, b: Bell | null | undefined, t: number): Bell | null {
  if (!a || !b) return (t < 0.5 ? a : b) ?? null;
  return { hand: a.hand, dx: a.dx + (b.dx - a.dx) * t, dy: a.dy + (b.dy - a.dy) * t };
}

/** Pose à l'instant `t` (secondes depuis le départ). */
export function sample(m: Motion, t: number): Frame {
  const total = cycleDuration(m);
  const rep = Math.floor(t / total);
  let x = ((t % total) + total) % total;
  let from = 0;
  for (let i = 0; i < m.steps.length; i++) {
    const s = m.steps[i];
    if (x < s.dur || i === m.steps.length - 1) {
      const k = s.dur > 0 ? Math.min(1, x / s.dur) : 1;
      const e = ease(k);
      const A = m.keys[from];
      const B = m.keys[s.to];
      const skel = solve(mix(A.a, B.a, e), mixConstraints(A.c, B.c, e));
      return { skel, bell: bellAt(skel, mixBell(A.bell, B.bell, e)), step: i, label: s.label, remaining: Math.max(0, s.dur - x), stepDur: s.dur, rep, count: !!s.count };
    }
    x -= s.dur;
    from = s.to;
  }
  throw new Error("unreachable");
}

/** Tempo classique en 4 temps : descente, pause en bas, montée, pause en haut (pose 0 = haut, 1 = bas). */
export function tempo(down: number, bottom: number, upDur: number, top: number, words: { down: string; bottom?: string; up: string; top?: string }): Step[] {
  return [
    { to: 1, dur: down, label: words.down, count: down >= 2 },
    ...(bottom > 0 ? [{ to: 1, dur: bottom, label: words.bottom ?? "Tiens", count: true }] : []),
    { to: 0, dur: upDur, label: words.up, count: upDur >= 2 },
    ...(top > 0 ? [{ to: 0, dur: top, label: words.top ?? "Respire", count: top >= 1 }] : []),
  ];
}

/** Libellé court du tempo pour l'écran (« 3 s · 1 s en bas · 1 s »). */
export function tempoText(m: Motion): string {
  return m.steps.map((s) => `${String(s.dur).replace(".", ",")} s`).join(" · ");
}

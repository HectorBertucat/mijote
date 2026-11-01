// Figures animées pour l'app iPhone : l'app dessine le bonhomme en natif sans porter le solveur. Pour chaque
// exercice, une répétition échantillonnée (positions des 14 articulations à chaque image, la kettlebell s'il
// y en a une), le tempo, le matériel posé et tenu, le tapis, et les muscles. Le dessin (épaisseurs, ordre,
// couleurs) suit src/lib/training/draw.ts ; docs/api-app.md le décrit. Module pur.
import { BACK, BODY_LIMBS, BODY_SHAPES, BODY_VIEWBOX, FRONT } from "@/lib/training/body";
import { GROUND_Y, VIEWBOX } from "@/lib/training/draw";
import { cycleDuration, sample, type Motion } from "@/lib/training/motion";
import { MUSCLE_LABEL, musclesOf, ranked } from "@/lib/training/muscles";
import type { Exercise } from "@/lib/training/program";
import type { Joint } from "@/lib/training/skeleton";

/** Ordre des articulations dans `frames[].j` (x puis y pour chacune). */
export const JOINT_ORDER: Joint[] = ["hip", "shoulder", "neck", "head", "kneeN", "ankleN", "toeN", "kneeF", "ankleF", "toeF", "elbowN", "handN", "elbowF", "handF"];
export const FIGURE_FPS = 30;

const r1 = (n: number) => Math.round(n * 10) / 10;

export function figureData(m: Motion, fps = FIGURE_FPS) {
  const cycle = cycleDuration(m);
  const n = Math.max(2, Math.ceil(cycle * fps));
  const frames = Array.from({ length: n }, (_, i) => {
    const f = sample(m, (i / n) * cycle);
    return {
      j: JOINT_ORDER.flatMap((k) => [r1(f.skel[k][0]), r1(f.skel[k][1])]),
      ...(f.bell ? { bell: { hand: f.bell.hand, at: [r1(f.bell.at[0]), r1(f.bell.at[1])] } } : {}),
      step: f.step,
    };
  });
  return {
    cycle,
    fps,
    steps: m.steps.map((s) => ({ to: s.to, dur: s.dur, label: s.label, count: !!s.count })),
    frames,
    props: m.props ?? [],
    gear: m.gear ?? [],
  };
}

/** Les muscles d'un exercice, du plus sollicité au moins sollicité. */
export const musclesData = (id: string, ex?: Pick<Exercise, "muscles"> | null) => ranked(musclesOf(id, ex)).map((x) => ({ id: x.m, label: MUSCLE_LABEL[x.m], load: x.w }));

/** Ce qui ne change pas d'un exercice à l'autre : cadres, sol, silhouette et tracés des muscles. */
export const DRAWING = {
  figure: { viewBox: VIEWBOX, groundY: GROUND_Y, joints: JOINT_ORDER },
  body: { viewBox: BODY_VIEWBOX, mirrorX: 60, limbs: BODY_LIMBS, shapes: BODY_SHAPES, front: FRONT, back: BACK },
};

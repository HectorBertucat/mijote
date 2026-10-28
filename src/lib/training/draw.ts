// Géométrie à dessiner pour une image du mouvement (segments, tête, kettlebell, accessoires). Pur.
import type { Frame } from "./motion";
import type { Joint, Pt } from "./skeleton";

export interface Seg {
  a: Pt;
  b: Pt;
  far: boolean;
  w: number;
}

const SEGS: [Joint, Joint, boolean, number][] = [
  ["hip", "kneeF", true, 7],
  ["kneeF", "ankleF", true, 7],
  ["ankleF", "toeF", true, 5],
  ["shoulder", "elbowF", true, 6],
  ["elbowF", "handF", true, 6],
  ["hip", "shoulder", false, 11],
  ["shoulder", "neck", false, 7],
  ["hip", "kneeN", false, 7],
  ["kneeN", "ankleN", false, 7],
  ["ankleN", "toeN", false, 5],
  ["shoulder", "elbowN", false, 6],
  ["elbowN", "handN", false, 6],
];

/** Cadre commun : assez haut pour un bras tendu au-dessus de la tête. */
export const VIEWBOX = "0 -22 200 214";

export function figure(f: Frame) {
  const s = f.skel;
  const segs: Seg[] = SEGS.map(([a, b, far, w]) => ({ a: s[a], b: s[b], far, w }));
  return {
    back: segs.filter((x) => x.far),
    front: segs.filter((x) => !x.far),
    head: s.head,
    bell: f.bell,
  };
}

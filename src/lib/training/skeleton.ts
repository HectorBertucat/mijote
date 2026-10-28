// Bonhomme de profil pour les exercices : un squelette articulé (segments de longueur fixe), vu de côté,
// tourné vers la droite. Une pose = des angles absolus par segment + des contraintes :
// - `anchor` : l'articulation qui ne bouge pas (pied d'appui, orteils, bassin au sol), posée à `at` ;
// - `ik` : un membre dont l'extrémité est fixée (main sur le banc, pied sur le canapé, mains au sol) ;
//   le coude ou le genou est calculé (cinématique inverse à deux segments).
// On interpole les angles, jamais les points : les membres gardent leur longueur, les pieds restent posés.
// Module pur (sert au rendu SVG et aux tests).

export type Pt = [number, number];

/** Longueurs en unités du viewBox (200 de haut environ). */
export const BONES = { torso: 50, neck: 7, head: 11, thigh: 40, shin: 39, foot: 13, upper: 29, fore: 27 } as const;

/** Angles en degrés. Segments « vers le bas » (cuisse, tibia, bras, avant-bras) : 0 = vertical vers le bas,
 * positif = vers l'avant (la droite). Buste et cou : 0 = vertical vers le haut, positif = penché en avant. */
export interface Angles {
  torso: number;
  neck?: number; // relatif au buste
  thighN: number;
  shinN: number;
  thighF: number;
  shinF: number;
  upperN: number;
  foreN: number;
  upperF: number;
  foreF: number;
  footN?: number; // angle du pied par rapport à l'horizontale (pointe vers l'avant), 0 par défaut
  footF?: number;
}

export type Joint = "hip" | "shoulder" | "neck" | "head" | "kneeN" | "ankleN" | "toeN" | "kneeF" | "ankleF" | "toeF" | "elbowN" | "handN" | "elbowF" | "handF";
export type Skeleton = Record<Joint, Pt>;

export interface Constraints {
  anchor: Joint;
  at: Pt;
  /** Extrémité fixée : main ou cheville. `bend` : 1 = coude/genou vers l'avant, −1 vers l'arrière. */
  ik?: Partial<Record<"handN" | "handF" | "ankleN" | "ankleF", { at: Pt; bend: 1 | -1 }>>;
}

const rad = (d: number) => (d * Math.PI) / 180;
const down = (p: Pt, a: number, l: number): Pt => [p[0] + Math.sin(rad(a)) * l, p[1] + Math.cos(rad(a)) * l];
const up = (p: Pt, a: number, l: number): Pt => [p[0] + Math.sin(rad(a)) * l, p[1] - Math.cos(rad(a)) * l];

/** Point le plus proche de `end` que le membre atteint depuis `root` (bras tendu si la cible est trop loin). */
export function reach(root: Pt, end: Pt, len: number): Pt {
  const d = Math.hypot(end[0] - root[0], end[1] - root[1]);
  if (d <= len) return end;
  return [root[0] + ((end[0] - root[0]) * len) / d, root[1] + ((end[1] - root[1]) * len) / d];
}

/** Coude ou genou d'un membre à deux segments qui va de `root` à `end`. */
export function twoBone(root: Pt, end: Pt, l1: number, l2: number, bend: 1 | -1): Pt {
  const dx = end[0] - root[0];
  const dy = end[1] - root[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-6);
  const a = Math.atan2(dy, dx);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const b = Math.acos(Math.max(-1, Math.min(1, cos)));
  // bend = 1 : l'articulation part du côté « avant » du membre (sens horaire à l'écran, y vers le bas)
  const ang = a - bend * b;
  return [root[0] + Math.cos(ang) * l1, root[1] + Math.sin(ang) * l1];
}

export function forward(a: Angles): Skeleton {
  const B = BONES;
  const hip: Pt = [0, 0];
  const shoulder = up(hip, a.torso, B.torso);
  const neck = up(shoulder, a.torso + (a.neck ?? 0), B.neck);
  const head = up(neck, a.torso + (a.neck ?? 0), B.head);
  const kneeN = down(hip, a.thighN, B.thigh);
  const ankleN = down(kneeN, a.shinN, B.shin);
  const toeN: Pt = [ankleN[0] + Math.cos(rad(a.footN ?? 0)) * B.foot, ankleN[1] - Math.sin(rad(a.footN ?? 0)) * B.foot];
  const kneeF = down(hip, a.thighF, B.thigh);
  const ankleF = down(kneeF, a.shinF, B.shin);
  const toeF: Pt = [ankleF[0] + Math.cos(rad(a.footF ?? 0)) * B.foot, ankleF[1] - Math.sin(rad(a.footF ?? 0)) * B.foot];
  const elbowN = down(shoulder, a.upperN, B.upper);
  const handN = down(elbowN, a.foreN, B.fore);
  const elbowF = down(shoulder, a.upperF, B.upper);
  const handF = down(elbowF, a.foreF, B.fore);
  return { hip, shoulder, neck, head, kneeN, ankleN, toeN, kneeF, ankleF, toeF, elbowN, handN, elbowF, handF };
}

/** Squelette posé : ancré, puis membres contraints recalculés. */
export function solve(a: Angles, c: Constraints): Skeleton {
  const s = forward(a);
  const o = s[c.anchor];
  const dx = c.at[0] - o[0];
  const dy = c.at[1] - o[1];
  for (const k of Object.keys(s) as Joint[]) s[k] = [s[k][0] + dx, s[k][1] + dy];
  for (const [end, t] of Object.entries(c.ik ?? {}) as [keyof NonNullable<Constraints["ik"]>, { at: Pt; bend: 1 | -1 }][]) {
    if (end === "handN" || end === "handF") {
      const elbow = end === "handN" ? "elbowN" : "elbowF";
      const at = reach(s.shoulder, t.at, BONES.upper + BONES.fore);
      s[elbow] = twoBone(s.shoulder, at, BONES.upper, BONES.fore, t.bend);
      s[end] = at;
    } else {
      const side = end === "ankleN" ? "N" : "F";
      const knee = `knee${side}` as Joint;
      const toe = `toe${side}` as Joint;
      const foot: Pt = [s[toe][0] - s[end][0], s[toe][1] - s[end][1]];
      const at = reach(s.hip, t.at, BONES.thigh + BONES.shin);
      s[knee] = twoBone(s.hip, at, BONES.thigh, BONES.shin, t.bend);
      s[end] = at;
      s[toe] = [at[0] + foot[0], at[1] + foot[1]];
    }
  }
  return s;
}

/** Interpolation des angles (et des cibles) entre deux poses. */
export function mix(a: Angles, b: Angles, t: number): Angles {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof Angles)[]) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    (out as Record<string, number>)[k] = x + (y - x) * t;
  }
  return out;
}

export function mixConstraints(a: Constraints, b: Constraints, t: number): Constraints {
  const lerp = (p: Pt, q: Pt): Pt => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const ik: Constraints["ik"] = {};
  for (const k of Object.keys({ ...a.ik, ...b.ik }) as (keyof NonNullable<Constraints["ik"]>)[]) {
    const x = a.ik?.[k] ?? b.ik?.[k];
    const y = b.ik?.[k] ?? a.ik?.[k];
    if (x && y) ik[k] = { at: lerp(x.at, y.at), bend: (t < 0.5 ? x : y).bend };
  }
  return { anchor: a.anchor, at: lerp(a.at, b.at), ik };
}

export const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

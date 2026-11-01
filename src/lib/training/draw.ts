// Ce qu'il faut dessiner pour une image du mouvement : un bonhomme aux membres galbés (cuisses plus
// épaisses que les tibias, buste plus large aux épaules), le côté éloigné en retrait, une ombre au sol,
// un tapis pour les exercices au sol, et le matériel tenu ou posé : kettlebell, haltères, élastique,
// mini-bande, chaise, canapé, banc, plan de travail. Sortie : des tracés SVG (`d`) et leur « peinture »,
// que l'interface colore avec les jetons du thème (KbFigure) et que l'API de l'app peut reprendre. Pur.
import type { Frame, Motion, Prop } from "./motion";
import { solve, type Joint, type Pt } from "./skeleton";

/** Cadre commun : assez haut pour un bras tendu au-dessus de la tête. */
export const VIEWBOX = "0 -22 200 214";
/** Le sol (le trait) et le haut du tapis. */
export const GROUND_Y = 187;

export type Paint = "ground" | "mat" | "shadow" | "prop" | "propEdge" | "far" | "near" | "tool" | "toolFar";
export interface Prim {
  d: string;
  paint: Paint;
  /** Trait d'épaisseur donnée (sinon : forme pleine). */
  stroke?: number;
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const P = (p: Pt) => `${f1(p[0])} ${f1(p[1])}`;
const add = (p: Pt, q: Pt, k = 1): Pt => [p[0] + q[0] * k, p[1] + q[1] * k];

export function circle(c: Pt, r: number): string {
  return `M${f1(c[0] - r)} ${f1(c[1])}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0Z`;
}

/** Membre galbé : de `a` (rayon `ra`) à `b` (rayon `rb`), bouts arrondis. */
export function capsule(a: Pt, b: Pt, ra: number, rb: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return circle(a, Math.max(ra, rb));
  const n: Pt = [-dy / len, dx / len];
  return `M${P(add(a, n, ra))}L${P(add(b, n, rb))}A${f1(rb)} ${f1(rb)} 0 0 0 ${P(add(b, n, -rb))}L${P(add(a, n, -ra))}A${f1(ra)} ${f1(ra)} 0 0 0 ${P(add(a, n, ra))}Z`;
}

function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f1(x + k)} ${f1(y)}H${f1(x + w - k)}Q${f1(x + w)} ${f1(y)} ${f1(x + w)} ${f1(y + k)}V${f1(y + h - k)}Q${f1(x + w)} ${f1(y + h)} ${f1(x + w - k)} ${f1(y + h)}H${f1(x + k)}Q${f1(x)} ${f1(y + h)} ${f1(x)} ${f1(y + h - k)}V${f1(y + k)}Q${f1(x)} ${f1(y)} ${f1(x + k)} ${f1(y)}Z`;
}

// Rayons des membres (unités du repère), de l'articulation de départ à celle d'arrivée ; le côté (N, F) s'ajoute.
type Part = "hip" | "shoulder" | "knee" | "ankle" | "toe" | "elbow" | "hand";
const LIMBS: [Part, Part, number, number][] = [
  ["hip", "knee", 6.6, 5],
  ["knee", "ankle", 5, 3.6],
  ["ankle", "toe", 3.3, 2.4],
  ["shoulder", "elbow", 4.4, 3.6],
  ["elbow", "hand", 3.6, 3],
];
const joint = (p: Part, side: "N" | "F") => (p === "hip" || p === "shoulder" ? p : (`${p}${side}` as Joint));

function limbs(s: Frame["skel"], side: "N" | "F"): string[] {
  return LIMBS.map(([a, b, ra, rb]) => capsule(s[joint(a, side)], s[joint(b, side)], ra, rb)).concat(circle(s[joint("hand", side)], 3.5));
}

/** Le matériel posé (banc, chaise, canapé, plan de travail), dessiné dans son rectangle. */
function prop(p: Prop): Prim[] {
  const { x, y, w, h } = p;
  const back = p.back ?? "left";
  switch (p.kind) {
    case "chair": {
      const bx = back === "left" ? x : x + w - 4;
      return [
        { d: roundRect(bx, y - 36, 4, 40, 2), paint: "propEdge" },
        { d: roundRect(x + 2, y + 4, 3, h - 4, 1.2), paint: "propEdge" },
        { d: roundRect(x + w - 5, y + 4, 3, h - 4, 1.2), paint: "propEdge" },
        { d: roundRect(x, y, w, 6, 2.5), paint: "prop" },
      ];
    }
    case "sofa": {
      const bx = back === "left" ? x : x + w - 12;
      return [
        { d: roundRect(x + 3, y + h - 3, 4, 3, 1), paint: "propEdge" },
        { d: roundRect(x + w - 7, y + h - 3, 4, 3, 1), paint: "propEdge" },
        { d: roundRect(bx, y - 22, 12, h + 19, 5), paint: "propEdge" },
        { d: roundRect(x, y + 7, w, h - 10, 4), paint: "prop" },
        { d: roundRect(x + (back === "left" ? 9 : 1), y, w - 10, 10, 4.5), paint: "prop" },
      ];
    }
    case "counter":
      return [
        { d: roundRect(x, y + 5, w, h - 5, 2), paint: "prop" },
        { d: roundRect(x + 5, y + 14, 2.5, 12, 1.2), paint: "propEdge" },
        { d: roundRect(x - 3, y, w + 3, 5, 1.5), paint: "propEdge" },
      ];
    default:
      // Banc (ou boîte) : un plateau rembourré sur deux pieds.
      return [
        { d: roundRect(x + 4, y + 6, 4, h - 6, 1.5), paint: "propEdge" },
        { d: roundRect(x + w - 8, y + 6, 4, h - 6, 1.5), paint: "propEdge" },
        { d: roundRect(x, y, w, 8, 3.5), paint: "prop" },
      ];
  }
}

/** Kettlebell : l'anse dans la main, la boule à `at`, un petit socle plat. */
function kettlebell(handle: Pt, at: Pt, paint: Paint): Prim[] {
  const v: Pt = [at[0] - handle[0], at[1] - handle[1]];
  const len = Math.hypot(v[0], v[1]) || 1;
  const u: Pt = [v[0] / len, v[1] / len]; // de la main vers la boule
  const n: Pt = [-u[1], u[0]];
  const loc = (x: number, y: number): Pt => [handle[0] + n[0] * x + u[0] * y, handle[1] + n[1] * x + u[1] * y];
  const r = 7.6;
  const c = loc(0, Math.max(len, 8));
  const arch = `M${P(loc(-5.2, 4))}C${P(loc(-5.6, -5))} ${P(loc(5.6, -5))} ${P(loc(5.2, 4))}`;
  const base = `M${P(loc(-4.6, Math.max(len, 8) + r - 1.2))}L${P(loc(4.6, Math.max(len, 8) + r - 1.2))}`;
  return [
    { d: arch, paint, stroke: 2.6 },
    { d: circle(c, r), paint },
    { d: base, paint, stroke: 2.4 },
  ];
}

/** Haltère tenu dans la main : la barre en travers de l'avant-bras, un disque de chaque côté. */
function dumbbell(s: Frame["skel"], side: "N" | "F", paint: Paint): Prim[] {
  const h = s[`hand${side}` as Joint];
  const e = s[`elbow${side}` as Joint];
  const len = Math.hypot(h[0] - e[0], h[1] - e[1]) || 1;
  const u: Pt = [(h[0] - e[0]) / len, (h[1] - e[1]) / len];
  const n: Pt = [-u[1], u[0]];
  const c = add(h, u, 1);
  const a = add(c, n, -8);
  const b = add(c, n, 8);
  return [
    { d: capsule(a, b, 1.6, 1.6), paint },
    { d: capsule(add(a, u, -5.5), add(a, u, 5.5), 2.8, 2.8), paint },
    { d: capsule(add(b, u, -5.5), add(b, u, 5.5), 2.8, 2.8), paint },
  ];
}

/** Ce qui ne bouge pas d'une image à l'autre : le tapis des exercices au sol (calculé une fois par figure). */
const matCache = new WeakMap<Motion, [number, number] | null>();
function matOf(m: Motion): [number, number] | null {
  if (matCache.has(m)) return matCache.get(m)!;
  let lo = Infinity;
  let hi = -Infinity;
  let floor = false;
  for (const k of m.keys) {
    const s = solve(k.a, k.c);
    // Au sol : le bassin bas (allongé, assis par terre) ou les deux mains posées (pompes, planche).
    if (s.hip[1] > 140 || (s.handN[1] > 176 && s.handF[1] > 176)) floor = true;
    for (const p of Object.values(s)) {
      if (p[1] <= 160) continue;
      lo = Math.min(lo, p[0]);
      hi = Math.max(hi, p[0]);
    }
  }
  const out: [number, number] | null = floor && Number.isFinite(lo) ? [Math.max(2, lo - 12), Math.min(198, hi + 12)] : null;
  matCache.set(m, out);
  return out;
}

/** Les tracés d'une image, du fond vers l'avant. */
export function drawFigure(f: Frame, m: Motion): Prim[] {
  const s = f.skel;
  const out: Prim[] = [{ d: `M4 ${GROUND_Y}H196`, paint: "ground", stroke: 3 }];
  const mat = matOf(m);
  if (mat) out.push({ d: roundRect(mat[0], GROUND_Y - 4, mat[1] - mat[0], 5, 2.5), paint: "mat" });

  // Ombre : sous ce qui touche le sol à cet instant.
  const low = Object.values(s).filter((p) => p[1] > GROUND_Y - 18);
  if (low.length) {
    const xs = low.map((p) => p[0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 9;
    out.push({ d: `M${f1(cx - rx)} ${GROUND_Y - 1}a${f1(rx)} 2.6 0 1 0 ${f1(2 * rx)} 0a${f1(rx)} 2.6 0 1 0 ${f1(-2 * rx)} 0Z`, paint: "shadow" });
  }

  for (const p of m.props ?? []) out.push(...prop(p));
  const gear = m.gear ?? [];
  const band = gear.find((g) => g.kind === "band");
  const dumb = gear.find((g) => g.kind === "dumbbell");

  // Côté éloigné, en retrait.
  if (band?.kind === "band" && band.to.includes("handF")) out.push({ d: `M${P(s[band.from])}L${P(s.handF)}`, paint: "toolFar", stroke: 2 });
  out.push(...limbs(s, "F").map((d): Prim => ({ d, paint: "far" })));
  if (dumb?.kind === "dumbbell" && dumb.hands.includes("handF")) out.push(...dumbbell(s, "F", "toolFar"));
  if (f.bell?.hand === "handF" && !dumb) out.push(...kettlebell(f.bell.handle, f.bell.at, "tool"));

  // Buste, cou, tête, puis le côté proche.
  out.push({ d: capsule(s.hip, s.shoulder, 7.8, 9.2), paint: "near" });
  out.push({ d: capsule(s.shoulder, s.neck, 3.8, 3.6), paint: "near" });
  out.push({ d: circle(s.head, 11), paint: "near" });
  const mini = gear.find((g) => g.kind === "miniband");
  out.push(...limbs(s, "N").map((d): Prim => ({ d, paint: "near" })));
  if (mini) out.push({ d: `M${P(add(s.kneeN, [0, 5]))}L${P(add(s.kneeF, [0, 5]))}`, paint: "tool", stroke: 3.2 });
  if (band?.kind === "band" && band.to.includes("handN")) out.push({ d: `M${P(s[band.from])}L${P(s.handN)}`, paint: "tool", stroke: 2.4 });
  if (dumb?.kind === "dumbbell" && dumb.hands.includes("handN")) out.push(...dumbbell(s, "N", "tool"));
  if (f.bell && f.bell.hand !== "handF" && !dumb) out.push(...kettlebell(f.bell.handle, f.bell.at, "tool"));
  return out;
}

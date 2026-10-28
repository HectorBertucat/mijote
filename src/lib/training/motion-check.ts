// Vérification d'une figure animée proposée par l'IA (un exercice inventé) : la forme des données,
// puis chaque pose résolue par le squelette (skeleton.ts). On refuse une figure qui passe sous le sol,
// sort du cadre, flotte (aucun appui), ou dont un membre « fixé » n'atteint pas sa cible ; et un
// tempo absurde. La liste d'erreurs repart à l'IA pour une seconde tentative. Module pur.
import { cycleDuration, type Motion } from "./motion";
import { BONES, dist, solve, type Angles, type Joint } from "./skeleton";

/** Sol des figures : les chevilles et les mains posées sont à y = 183, les orteils à 186. */
export const FLOOR = 186;
const FLOOR_TOL = 4;
const SUPPORT_Y = 170; // au-dessous (y plus grand), une articulation compte comme appui (corps allongé : y ≈ 174, le trait touche le sol)
const VIEW = { xMin: -10, xMax: 210, yMin: -22 };

const ANGLE_KEYS: (keyof Angles)[] = ["torso", "neck", "thighN", "shinN", "thighF", "shinF", "upperN", "foreN", "upperF", "foreF", "footN", "footF"];
const REQUIRED: (keyof Angles)[] = ["torso", "thighN", "shinN", "thighF", "shinF", "upperN", "foreN", "upperF", "foreF"];
const JOINTS: Joint[] = ["hip", "shoulder", "neck", "head", "kneeN", "ankleN", "toeN", "kneeF", "ankleF", "toeF", "elbowN", "handN", "elbowF", "handF"];

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isPt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]);

export function checkMotion(m: Motion): string[] {
  const errors: string[] = [];
  if (!m || !Array.isArray(m.keys) || !Array.isArray(m.steps)) return ["figure illisible : il faut keys[] et steps[]"];
  if (m.keys.length < 2 || m.keys.length > 6) errors.push(`il faut 2 à 6 poses clés (${m.keys.length})`);
  if (m.steps.length < 2 || m.steps.length > 10) errors.push(`il faut 2 à 10 étapes de tempo (${m.steps.length})`);

  m.keys.forEach((k, i) => {
    const a = k?.a as Partial<Record<keyof Angles, unknown>> | undefined;
    if (!a) return void errors.push(`pose ${i} : angles manquants`);
    for (const key of REQUIRED) if (!num(a[key])) errors.push(`pose ${i} : angle « ${key} » manquant`);
    for (const key of ANGLE_KEYS) if (a[key] != null && (!num(a[key]) || Math.abs(a[key] as number) > 400)) errors.push(`pose ${i} : angle « ${key} » hors bornes`);
    if (!k.c || !JOINTS.includes(k.c.anchor) || !isPt(k.c.at)) errors.push(`pose ${i} : ancrage invalide`);
    for (const [end, t] of Object.entries(k.c?.ik ?? {})) if (!t || !isPt(t.at) || (t.bend !== 1 && t.bend !== -1)) errors.push(`pose ${i} : cible ${end} invalide`);
  });
  if (errors.length) return errors;
  const anchors = new Set(m.keys.map((k) => k.c.anchor));
  if (anchors.size > 1) errors.push("toutes les poses doivent garder le même point d'ancrage");

  m.steps.forEach((s, i) => {
    if (!Number.isInteger(s.to) || s.to < 0 || s.to >= m.keys.length) errors.push(`étape ${i} : pose visée ${s.to} inconnue`);
    if (!num(s.dur) || s.dur < 0.1 || s.dur > 6) errors.push(`étape ${i} : durée ${s.dur} s hors de 0,1 à 6 s`);
    if (!s.label || s.label.length > 40) errors.push(`étape ${i} : libellé vide ou trop long`);
  });
  if (!errors.length) {
    const total = cycleDuration(m);
    if (total < 1 || total > 15) errors.push(`une répétition dure ${total.toFixed(1)} s (attendu 1 à 15 s)`);
    if (!m.steps.some((s) => s.to !== 0)) errors.push("le mouvement ne quitte jamais la pose de départ");
  }

  // Chaque pose, résolue : dans le cadre, rien sous le sol, au moins un appui, cibles atteintes.
  m.keys.forEach((k, i) => {
    const s = solve(k.a, k.c);
    const pts = JOINTS.map((j) => s[j]);
    if (pts.some((p) => !num(p[0]) || !num(p[1]))) return void errors.push(`pose ${i} : squelette impossible`);
    const low = JOINTS.filter((j) => s[j][1] > FLOOR + FLOOR_TOL);
    if (low.length) errors.push(`pose ${i} : ${low.join(", ")} sous le sol (y > ${FLOOR})`);
    if (pts.some((p) => p[0] < VIEW.xMin || p[0] > VIEW.xMax || p[1] < VIEW.yMin)) errors.push(`pose ${i} : la figure sort du cadre (x de ${VIEW.xMin} à ${VIEW.xMax}, y ≥ ${VIEW.yMin})`);
    if (!pts.some((p) => p[1] >= SUPPORT_Y)) errors.push(`pose ${i} : aucun appui au sol (la figure flotte)`);
    for (const [end, t] of Object.entries(k.c.ik ?? {}) as [Joint, { at: [number, number] }][]) {
      if (dist(s[end], t.at) > 4) errors.push(`pose ${i} : ${end} n'atteint pas sa cible (membre trop court : ${BONES.upper + BONES.fore} pour un bras, ${BONES.thigh + BONES.shin} pour une jambe)`);
    }
    if (k.bell && !["handN", "handF"].includes(k.bell.hand)) errors.push(`pose ${i} : charge tenue par une main inconnue`);
  });
  return errors;
}

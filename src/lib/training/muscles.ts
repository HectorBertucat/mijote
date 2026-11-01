// Muscles travaillés par chaque exercice, pour la carte du corps de la séance guidée (MuscleMap) et l'app :
// 3 = le muscle cible, 2 = il aide beaucoup, 1 = il stabilise. Les exercices de la bibliothèque ont leur
// liste écrite à la main ; un exercice inventé par l'IA (ou d'un ancien programme) la tire de son texte
// « muscles » (« Cuisses, fessiers, gainage »), le premier cité comptant comme cible. Module pur.
import type { Exercise } from "./program";

export type Muscle =
  | "pectoraux"
  | "epaules"
  | "biceps"
  | "triceps"
  | "avantBras"
  | "abdos"
  | "obliques"
  | "quadriceps"
  | "adducteurs"
  | "trapezes"
  | "dorsaux"
  | "lombaires"
  | "fessiers"
  | "moyenFessier"
  | "ischios"
  | "mollets";

export const MUSCLE_LABEL: Record<Muscle, string> = {
  pectoraux: "Pectoraux",
  epaules: "Épaules",
  biceps: "Biceps",
  triceps: "Triceps",
  avantBras: "Avant-bras",
  abdos: "Abdominaux",
  obliques: "Obliques",
  quadriceps: "Quadriceps",
  adducteurs: "Adducteurs",
  trapezes: "Trapèzes",
  dorsaux: "Dos (grand dorsal)",
  lombaires: "Lombaires",
  fessiers: "Fessiers",
  moyenFessier: "Moyen fessier",
  ischios: "Ischio-jambiers",
  mollets: "Mollets",
};
export const MUSCLES_ALL = Object.keys(MUSCLE_LABEL) as Muscle[];

export type Load = 1 | 2 | 3;
export type MuscleLoad = Partial<Record<Muscle, Load>>;

/** Les exercices de la bibliothèque (program.ts, renfo.ts). */
export const EXERCISE_MUSCLES: Record<string, MuscleLoad> = {
  goblet: { quadriceps: 3, fessiers: 3, adducteurs: 2, abdos: 1, lombaires: 1, avantBras: 1 },
  bulgare: { quadriceps: 3, fessiers: 3, adducteurs: 2, ischios: 1, moyenFessier: 1 },
  rdl: { ischios: 3, fessiers: 3, lombaires: 2, moyenFessier: 2, avantBras: 1 },
  swing: { fessiers: 3, ischios: 3, lombaires: 2, abdos: 1, epaules: 1, avantBras: 1 },
  row: { dorsaux: 3, trapezes: 2, epaules: 2, biceps: 2, avantBras: 1 },
  rowPause: { dorsaux: 3, trapezes: 2, epaules: 2, biceps: 2, avantBras: 1 },
  pushup: { pectoraux: 3, triceps: 2, epaules: 2, abdos: 1 },
  floorpress: { pectoraux: 3, triceps: 3, epaules: 1 },
  press: { epaules: 3, triceps: 2, trapezes: 1, abdos: 1 },
  curl: { biceps: 3, avantBras: 2 },
  triceps: { triceps: 3, epaules: 1 },
  deadbug: { abdos: 3, obliques: 2, lombaires: 1 },
  plank: { obliques: 3, abdos: 2, moyenFessier: 2, epaules: 1 },
  jBridge: { fessiers: 3, ischios: 2, lombaires: 1 },
  jBandRow: { dorsaux: 3, trapezes: 2, biceps: 2, epaules: 1 },
  jBoxSquat: { quadriceps: 3, fessiers: 3, adducteurs: 1, abdos: 1 },
  jInclinePush: { pectoraux: 3, triceps: 2, epaules: 2, abdos: 1 },
  jLatWalk: { moyenFessier: 3, fessiers: 2, quadriceps: 1 },
  jPlank: { obliques: 3, abdos: 2, moyenFessier: 2, epaules: 1 },
  jRevLunge: { quadriceps: 3, fessiers: 3, ischios: 1, adducteurs: 1 },
  jSeatedPress: { epaules: 3, triceps: 2, trapezes: 1 },
  jRdl: { ischios: 3, fessiers: 3, lombaires: 2, avantBras: 1 },
  jRow: { dorsaux: 3, trapezes: 2, epaules: 2, biceps: 2, avantBras: 1 },
  jDeadbug: { abdos: 3, obliques: 2, lombaires: 1 },
  jSideLeg: { moyenFessier: 3, fessiers: 1, obliques: 1 },
};

// Mots d'un texte libre → muscles (minuscules, sans accents). « gainage » allume le tronc.
const WORDS: [RegExp, Muscle[]][] = [
  [/pector|poitrine/, ["pectoraux"]],
  [/epaule|deltoid/, ["epaules"]],
  [/biceps/, ["biceps"]],
  [/triceps/, ["triceps"]],
  [/avant-bras|poigne|grip/, ["avantBras"]],
  [/abdo|ventre|sangle/, ["abdos"]],
  [/oblique|taille/, ["obliques"]],
  [/gainage|tronc|core/, ["abdos", "obliques"]],
  [/quadri|cuisse/, ["quadriceps"]],
  [/adducteur|interieur/, ["adducteurs"]],
  [/trapez|omoplate/, ["trapezes"]],
  [/dorsa|dos\b|dos /, ["dorsaux"]],
  [/lombaire|bas du dos/, ["lombaires"]],
  [/moyen fessier|abducteur|hanche/, ["moyenFessier"]],
  [/fessier|glute/, ["fessiers"]],
  [/ischio/, ["ischios"]],
  [/mollet/, ["mollets"]],
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Muscles d'un texte libre : le premier groupe cité est la cible (3), les suivants aident (2). */
export function musclesFromText(text: string): MuscleLoad {
  const out: MuscleLoad = {};
  fold(text)
    .split(/[,;·(]|\bet\b/)
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((part, i) => {
      for (const [re, ms] of WORDS) {
        if (!re.test(part)) continue;
        for (const m of ms) out[m] = Math.max(out[m] ?? 0, i === 0 ? 3 : 2) as Load;
      }
    });
  return out;
}

/** Les muscles d'un exercice : sa liste écrite, sinon tirée de son texte. */
export function musclesOf(id: string, ex?: Pick<Exercise, "muscles"> | null): MuscleLoad {
  return EXERCISE_MUSCLES[id] ?? (ex ? musclesFromText(ex.muscles) : {});
}

/** Les muscles rangés du plus sollicité au moins sollicité (ordre de MUSCLES_ALL à égalité). */
export function ranked(load: MuscleLoad): { m: Muscle; w: Load }[] {
  return MUSCLES_ALL.filter((m) => load[m]).map((m) => ({ m, w: load[m]! })).sort((a, b) => b.w - a.w);
}

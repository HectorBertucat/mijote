// Bibliothèque d'exercices animés : tous les exercices des modèles, chacun avec sa figure (figures.ts),
// le matériel qu'il demande et le mouvement qu'il travaille. Le générateur de programmes (generate.ts)
// et l'IA (ai.ts) piochent ici ; un exercice inventé par l'IA apporte sa propre figure (motion), vérifiée
// par le code (motion-check.ts). Module pur.
import { EXERCISES, type Exercise } from "./program";
import { RENFO_EXERCISES } from "./renfo";

/** Matériel : « aucun » = poids du corps sur un tapis. */
export type Gear = "aucun" | "kettlebell" | "halteres" | "bande" | "miniBande" | "chaise" | "canape";
export const GEAR_LABEL: Record<Gear, string> = {
  aucun: "Poids du corps",
  kettlebell: "Kettlebell",
  halteres: "Haltères",
  bande: "Grande bande élastique",
  miniBande: "Mini-bandes",
  chaise: "Chaise",
  canape: "Canapé ou banc",
};
export const GEARS = Object.keys(GEAR_LABEL) as Gear[];

/** Familles de mouvement : une séance équilibrée en prend une de chaque côté du corps. */
export type Pattern = "squat" | "fente" | "charniere" | "fessiers" | "tirage" | "poussee" | "epaules" | "bras" | "gainage" | "cardio";
export const PATTERN_LABEL: Record<Pattern, string> = {
  squat: "Squat",
  fente: "Fente",
  charniere: "Charnière de hanche",
  fessiers: "Fessiers et hanches",
  tirage: "Tirage (dos)",
  poussee: "Poussée (pectoraux)",
  epaules: "Épaules",
  bras: "Bras",
  gainage: "Gainage",
  cardio: "Cardio",
};
export const PATTERNS = Object.keys(PATTERN_LABEL) as Pattern[];

export interface LibraryMeta {
  /** Il faut tout ce matériel (vide = rien). */
  gear: Gear[];
  pattern: Pattern;
  /** 1 = pour débuter, 2 = intermédiaire, 3 = exigeant. */
  level: 1 | 2 | 3;
}

export const META: Record<string, LibraryMeta> = {
  goblet: { gear: ["kettlebell"], pattern: "squat", level: 2 },
  bulgare: { gear: ["kettlebell", "canape"], pattern: "fente", level: 3 },
  rdl: { gear: ["kettlebell"], pattern: "charniere", level: 3 },
  swing: { gear: ["kettlebell"], pattern: "cardio", level: 2 },
  row: { gear: ["kettlebell", "canape"], pattern: "tirage", level: 2 },
  rowPause: { gear: ["kettlebell", "canape"], pattern: "tirage", level: 2 },
  pushup: { gear: [], pattern: "poussee", level: 2 },
  floorpress: { gear: ["kettlebell"], pattern: "poussee", level: 2 },
  press: { gear: ["kettlebell"], pattern: "epaules", level: 2 },
  curl: { gear: ["kettlebell"], pattern: "bras", level: 1 },
  triceps: { gear: ["kettlebell"], pattern: "bras", level: 2 },
  deadbug: { gear: [], pattern: "gainage", level: 1 },
  plank: { gear: [], pattern: "gainage", level: 2 },
  jBridge: { gear: [], pattern: "fessiers", level: 1 },
  jBandRow: { gear: ["bande"], pattern: "tirage", level: 1 },
  jBoxSquat: { gear: ["chaise"], pattern: "squat", level: 1 },
  jInclinePush: { gear: [], pattern: "poussee", level: 1 },
  jLatWalk: { gear: ["miniBande"], pattern: "fessiers", level: 1 },
  jPlank: { gear: [], pattern: "gainage", level: 1 },
  jRevLunge: { gear: [], pattern: "fente", level: 1 },
  jSeatedPress: { gear: ["halteres", "chaise"], pattern: "epaules", level: 1 },
  jRdl: { gear: ["kettlebell"], pattern: "charniere", level: 1 },
  jRow: { gear: ["halteres", "canape"], pattern: "tirage", level: 1 },
  jDeadbug: { gear: [], pattern: "gainage", level: 1 },
  jSideLeg: { gear: [], pattern: "fessiers", level: 1 },
};

export const LIBRARY: Record<string, Exercise> = { ...EXERCISES, ...RENFO_EXERCISES };

/** Exercices faisables avec ce matériel (le poids du corps est toujours là). */
export function available(gear: Gear[]): string[] {
  const have = new Set<Gear>([...gear, "aucun"]);
  return Object.keys(META).filter((id) => META[id].gear.every((g) => have.has(g)));
}

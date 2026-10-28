// Programmes d'entraînement : le type Program, le modèle kettlebell (exercices,
// séances A/B, échauffement), le déroulé d'une séance et le carnet. Repris de l'artifact « Kettlebell »
// de septembre 2026. Les mouvements animés et leur tempo exact sont dans figures.ts (même clé).
// Module pur : la page, la séance guidée et les tests s'en servent. Qui suit quoi : programs.ts.

import type { Motion } from "./motion";

export type ExId = "goblet" | "row" | "rowPause" | "pushup" | "rdl" | "curl" | "triceps" | "bulgare" | "floorpress" | "press" | "swing" | "deadbug" | "plank";

export interface Exercise {
  name: string;
  short: string;
  muscles: string;
  reps: [number, number]; // fourchette de la double progression
  uni: boolean; // un côté à la fois : le compte est « par côté »
  unit?: "s"; // planche : des secondes, pas des répétitions
  tempo: string;
  cues: string[];
  errors: string[];
  ladder: string[]; // échelle de progression, cran 0 = départ
  /** Consignes pas à pas, pour qui découvre le geste (toutes facultatives). */
  guide?: {
    position?: string;
    movement?: string;
    feel?: string; // où on doit sentir l'effort
    breathing?: string;
    easier?: string; // version plus facile en cas de gêne
  };
}

export const EXERCISES: Record<ExId, Exercise> = {
  goblet: {
    name: "Goblet squat tempo", short: "Goblet squat", muscles: "Cuisses, fessiers, gainage", reps: [12, 20], uni: false, tempo: "3 s en bas · 1 s pause",
    cues: [
      "Kettlebell tenue par les cornes, collée au sternum",
      "Pieds largeur d'épaules, pointes un peu ouvertes",
      "Descends en 3 secondes, coudes entre les genoux",
      "1 seconde arrêté en bas, puis remonte fort",
    ],
    errors: [
      "Talons qui décollent : écarte un peu plus les pieds",
      "Dos qui s'arrondit en bas : descends un peu moins bas",
    ],
    ladder: [
      "Goblet squat tempo 3-1-1",
      "Goblet squat pause 3 s en bas",
      "Goblet squat « 1,5 rep »",
      "Passe à la fente bulgare (séance B) en séance A aussi",
    ],
  },
  row: {
    name: "Rowing un bras", short: "Rowing", muscles: "Dos (grand dorsal), arrière d'épaule, biceps", reps: [10, 15], uni: true, tempo: "pause 1 s en haut",
    cues: [
      "Main libre en appui sur le canapé, dos plat",
      "Tire le coude vers la hanche, pas vers l'épaule",
      "Serre l'omoplate 1 seconde en haut",
      "Redescends lentement, bras tendu en bas",
    ],
    errors: [
      "Tourner le buste pour tricher : garde les épaules parallèles au sol",
      "Tirer avec la main : pense « coude »",
    ],
    ladder: [
      "Rowing pause 1 s",
      "Rowing pause 2 s + descente 3 s",
      "Rowing « 1,5 rep »",
      "Rowing sans appui (buste penché, gainage)",
    ],
  },
  rowPause: {
    name: "Rowing un bras, pause 2 s", short: "Rowing pause", muscles: "Dos (grand dorsal), arrière d'épaule, biceps", reps: [10, 15], uni: true, tempo: "pause 2 s en haut",
    cues: [
      "Même exercice qu'en séance A, mais plus lent",
      "Pause de 2 secondes en haut, omoplate serrée",
      "Descente en 3 secondes",
    ],
    errors: [
      "Tourner le buste pour tricher : garde les épaules parallèles au sol",
      "Tirer avec la main : pense « coude »",
    ],
    ladder: [
      "Rowing pause 1 s",
      "Rowing pause 2 s + descente 3 s",
      "Rowing « 1,5 rep »",
      "Rowing sans appui (buste penché, gainage)",
    ],
  },
  pushup: {
    name: "Pompes", short: "Pompes", muscles: "Pectoraux, triceps, épaules, gainage", reps: [8, 20], uni: false, tempo: "descente 2 s",
    cues: [
      "Mains un peu plus larges que les épaules",
      "Corps gainé en planche : fesses et abdos serrés",
      "Poitrine jusqu'à 5 cm du sol",
      "Coudes à 45° du corps, pas à l'horizontale",
    ],
    errors: [
      "Hanches qui s'affaissent : serre les fessiers",
      "Amplitude à moitié : mieux vaut 8 complètes que 15 courtes",
    ],
    ladder: [
      "Pompes au sol",
      "Pompes tempo : 3 s de descente",
      "Pompes pause 1 s en bas",
      "Pompes pieds sur le canapé",
      "Pompes pieds surélevés + tempo",
    ],
  },
  rdl: {
    name: "Soulevé de terre roumain une jambe", short: "RDL une jambe", muscles: "Ischios, fessiers, équilibre", reps: [8, 12], uni: true, tempo: "descente 3 s",
    cues: [
      "Kettlebell dans la main opposée à la jambe d'appui",
      "Pousse la hanche vers l'arrière, genou d'appui légèrement fléchi",
      "Dos plat, la jambe libre part en arrière dans l'alignement du buste",
      "Remonte en serrant le fessier de la jambe d'appui",
    ],
    errors: [
      "Dos rond : descends moins bas",
      "Hanche qui s'ouvre sur le côté : garde les deux hanches face au sol",
    ],
    ladder: [
      "RDL une jambe, orteil de la jambe libre au sol pour l'équilibre",
      "RDL une jambe libre",
      "RDL une jambe tempo 3 s + pause 1 s en bas",
      "RDL une jambe « 1,5 rep »",
    ],
  },
  curl: {
    name: "Curl biceps", short: "Curl", muscles: "Biceps, avant-bras", reps: [12, 20], uni: false, tempo: "descente 2 s",
    cues: [
      "Kettlebell tenue par les cornes, à deux mains",
      "Coudes collés au corps, ils ne bougent pas",
      "Monte sans élan, redescends en 2 secondes",
    ],
    errors: [
      "Balancer le buste : appuie le dos contre un mur",
    ],
    ladder: [
      "Curl deux mains",
      "Curl un bras (par la poignée)",
      "Curl un bras tempo 3 s",
    ],
  },
  triceps: {
    name: "Extension triceps au-dessus de la tête", short: "Triceps", muscles: "Triceps", reps: [12, 20], uni: false, tempo: "descente 2 s",
    cues: [
      "Kettlebell tenue par les cornes, derrière la tête",
      "Coudes pointés vers le plafond, ils restent fixes",
      "Tends les bras complètement, redescends lentement",
    ],
    errors: [
      "Coudes qui s'écartent : resserre-les",
      "Dos qui se cambre : serre les fessiers et les abdos",
    ],
    ladder: [
      "Extension debout deux mains",
      "Extension assis (moins de triche)",
      "Extension tempo 3 s",
      "Extension un bras",
    ],
  },
  bulgare: {
    name: "Fente bulgare", short: "Fente bulgare", muscles: "Cuisses, fessiers (une jambe à la fois)", reps: [8, 12], uni: true, tempo: "descente 2 s",
    cues: [
      "Pied arrière posé sur le canapé, lacets vers le bas",
      "Pied avant assez loin pour que le genou reste au-dessus du pied",
      "Descends droit, le genou arrière vers le sol",
      "Pousse dans le talon avant pour remonter",
    ],
    errors: [
      "Équilibre instable : fais la 1re semaine sans kettlebell",
      "Genou avant qui rentre vers l'intérieur : pousse-le vers l'extérieur",
    ],
    ladder: [
      "Fente bulgare sans kettlebell",
      "Fente bulgare goblet",
      "Fente bulgare tempo 3 s",
      "Fente bulgare « 1,5 rep »",
      "Squat pistol assisté (en tenant le cadre d'une porte)",
    ],
  },
  floorpress: {
    name: "Développé couché au sol un bras", short: "Floor press", muscles: "Pectoraux, triceps", reps: [10, 15], uni: true, tempo: "pause 1 s coude au sol",
    cues: [
      "Allongé sur le tapis, genoux pliés, pieds au sol",
      "Kettlebell tenue par la poignée, le poids repose sur l'avant-bras",
      "Le coude touche le sol, 1 seconde d'arrêt",
      "Pousse vers le plafond, bras tendu",
    ],
    errors: [
      "Coude trop écarté du corps : garde-le à 45°",
    ],
    ladder: [
      "Floor press pause 1 s",
      "Floor press tempo 3 s",
      "Floor press « 1,5 rep »",
      "Floor press pont fessier (hanches levées)",
    ],
  },
  press: {
    name: "Développé militaire un bras", short: "Développé militaire", muscles: "Épaules, triceps, gainage", reps: [8, 12], uni: true, tempo: "descente 2 s",
    cues: [
      "Kettlebell en position rack : poignée dans la main, boule sur l'avant-bras",
      "Fesses et abdos serrés, pas de cambrure",
      "Pousse vers le plafond, biceps près de l'oreille",
      "Redescends en 2 secondes jusqu'au rack",
    ],
    errors: [
      "Se pencher en arrière : serre les fessiers plus fort",
    ],
    ladder: [
      "Développé militaire debout",
      "Développé à genoux (moins de triche)",
      "Développé tempo 3 s",
      "Développé bottom-up (kettlebell à l'envers)",
    ],
  },
  swing: {
    name: "Swings", short: "Swings", muscles: "Fessiers, ischios, lombaires, cardio", reps: [10, 10], uni: false, tempo: "10 reps toutes les 30 s",
    cues: [
      "C'est la hanche qui propulse, pas les bras",
      "Kettlebell entre les cuisses, hanche en arrière",
      "Hanche en avant d'un coup sec, fessiers serrés",
      "Les bras suivent jusqu'à hauteur de poitrine",
    ],
    errors: [
      "Squatter au lieu de plier la hanche : les genoux bougent peu",
      "Tirer avec les bras : ils restent détendus",
    ],
    ladder: [
      "80 swings en 4 min",
      "Swings un bras",
      "Swings un bras alternés",
      "5 min au lieu de 4",
    ],
  },
  deadbug: {
    name: "Dead bug", short: "Dead bug", muscles: "Abdominaux profonds", reps: [8, 12], uni: true, tempo: "lent, dos collé au sol",
    cues: [
      "Sur le dos, bras vers le plafond, genoux à 90° au-dessus des hanches",
      "Tends lentement un bras et la jambe opposée",
      "Le bas du dos reste collé au tapis",
      "Reviens, change de côté",
    ],
    errors: [
      "Le dos décolle : réduis l'amplitude",
    ],
    ladder: [
      "Dead bug",
      "Dead bug kettlebell tenue bras tendus",
      "Dead bug tempo 4 s",
    ],
  },
  plank: {
    name: "Planche latérale", short: "Planche latérale", muscles: "Obliques, gainage", reps: [20, 45], uni: true, unit: "s", tempo: "secondes par côté",
    cues: [
      "En appui sur l'avant-bras, coude sous l'épaule",
      "Corps aligné des chevilles à la tête",
      "Pousse la hanche vers le plafond",
    ],
    errors: [
      "Hanche qui tombe : raccourcis la durée",
    ],
    ladder: [
      "Planche latérale genoux au sol",
      "Planche latérale 30 s",
      "45 s",
      "Planche latérale jambe du dessus levée",
    ],
  },
};

/** Ordre de la bibliothèque : jambes, tirages, poussées, bras, gainage. */
export const ORDER: ExId[] = ["goblet", "bulgare", "rdl", "swing", "row", "rowPause", "pushup", "floorpress", "press", "curl", "triceps", "deadbug", "plank"];

export type SessionType = "A" | "B";

export interface Block {
  label: string;
  items: string[]; // ids d'exercices du programme
  sets?: number;
  rest?: number; // secondes entre les tours
  emom?: { rounds: number; every: number; reps: number }; // swings : `reps` au bip, toutes les `every` s
}

export interface SessionDef {
  name: string;
  sub: string;
  blocks: Block[];
}

export const SESSIONS: Record<SessionType, SessionDef> = {
  A: {
    name: "Séance A",
    sub: "Squat · dos · pompes · ischios · bras",
    blocks: [
      { label: "Bloc 1", sets: 3, items: ["goblet", "row"], rest: 60 },
      { label: "Bloc 2", sets: 3, items: ["pushup", "rdl"], rest: 60 },
      { label: "Finisher bras", sets: 2, items: ["curl", "triceps"], rest: 45 },
    ],
  },
  B: {
    name: "Séance B",
    sub: "Fente bulgare · pecs · dos · épaules · swings",
    blocks: [
      { label: "Bloc 1", sets: 3, items: ["bulgare", "floorpress"], rest: 60 },
      { label: "Bloc 2", sets: 3, items: ["rowPause", "press"], rest: 60 },
      { label: "Finisher swings", items: ["swing"], emom: { rounds: 8, every: 30, reps: 10 } },
    ],
  },
};

export const BONUS: Block = { label: "Bonus gainage", sets: 2, items: ["deadbug", "plank"], rest: 30 };
export const WARMUP = ["10 swings légers", "10 goblet squats lents", "10 pompes", "5 halos de chaque côté (la kettlebell tourne autour de la tête)", "10 rotations de hanches"];
/** Repos après le dernier tour d'un bloc, avant le suivant. */
export const BLOCK_REST = 90;

/** Semaine type sur deux semaines (lundi → dimanche). */
export const WEEK_PLAN: string[][] = [
  ["KB · A", "Repos", "KB · B", "Repos", "KB · A", "Repos", "Bonus"],
  ["KB · B", "Repos", "KB · A", "Repos", "KB · B", "Repos", "Bonus"],
];

// ---------- Programme ----------

/** Un programme complet : ses exercices, ses séances (alternées dans l'ordre des clés), l'échauffement,
 * le gainage proposé en fin de séance et la semaine type. Les figures animées sont dans figures.ts,
 * sous la même clé que l'exercice. Le registre (qui suit quel programme) est dans programs.ts. */
export interface Program {
  id: string;
  name: string; // « Kettlebell maison »
  people: string[]; // ids des personnes qui le suivent
  exercises: Record<string, Exercise>;
  order: string[]; // ordre de la bibliothèque
  sessions: Record<string, SessionDef>;
  bonus: Block | null;
  warmup: string[];
  blockRest: number;
  weekPlan: string[][];
  checkpoint: string | null;
  /** Nom court des séances du programme (« Kettlebell », « Renfo ») : pastille, carnet. */
  short: string;
  /** Séances visées par semaine. */
  perWeek: number;
  /** L'autre sport suivi à côté, compté depuis Apple Santé (nom affiché, séances visées, icône du kit). */
  alsoTrack: { sport: string; target: number; icon: string } | null;
  /** Sous le tableau de la semaine. */
  weekNote: string;
  /** Cartes de l'onglet Programme ; `wide` prend toute la largeur. */
  principles: { title: string; text: string; wide?: boolean }[];
  /** Figures des exercices inventés pour ce programme (IA), vérifiées par motion-check.ts ; les autres sont dans figures.ts. */
  motions?: Record<string, Motion>;
  /** D'où vient le programme : un modèle, le générateur, l'IA. */
  source?: "modele" | "generateur" | "ia";
}

export const KB_TEMPLATE: Program = {
  id: "modele-kettlebell",
  name: "Kettlebell maison",
  people: [],
  exercises: EXERCISES,
  order: ORDER,
  sessions: SESSIONS,
  bonus: BONUS,
  warmup: WARMUP,
  blockRest: BLOCK_REST,
  weekPlan: WEEK_PLAN,
  checkpoint: null,
  short: "Kettlebell",
  perWeek: 3,
  alsoTrack: null,
  weekNote: "3 séances d'environ 30 min, jamais deux jours de suite ; le dimanche en bonus. Les séances kettlebell sont 100 % muscle : le cardio se fait à côté (marche, vélo, natation). L'onglet Séance propose automatiquement la bonne.",
  principles: [
    { title: "Près de l'échec", text: "Une charge légère fait grossir le muscle autant qu'une lourde si la série se termine à 1 ou 2 répétitions de l'échec." },
    { title: "Double progression", text: "Haut de la fourchette sur toutes les séries : cran suivant de l'échelle, et tu repars du bas. Le carnet le signale." },
    { title: "Rendre une kettlebell plus lourde", text: "Unilatéral (la charge double), tempo lent (3 s pour descendre), pause de 2 s dans la position dure, « 1,5 rep », moins de repos (90 s → 60 s).", wide: true },
    { title: "Quand la kettlebell ne suffira plus", text: "D'ici 3 à 4 mois, les jambes auront fait le tour de l'échelle : prends la taille au-dessus (+4 à +8 kg), lourde pour les jambes et le rowing, encore gérable pour les swings.", wide: true },
  ],
};

export type LiveStep =
  | { k: "warm" }
  | { k: "ex"; ex: string; set: number; sets: number; block: string }
  | { k: "rest"; sec: number }
  | { k: "emom"; ex: string; rounds: number; every: number; reps: number; block: string }
  | { k: "bonus" }
  | { k: "end" };

/** Déroulé d'une séance : échauffement, séries en superset, repos, finisher, proposition de gainage, fin. */
export function buildSteps(p: Program, type: string, withBonus = false): LiveStep[] {
  const blocks = [...p.sessions[type].blocks, ...(withBonus && p.bonus ? [p.bonus] : [])];
  const out: LiveStep[] = [{ k: "warm" }];
  blocks.forEach((b, bi) => {
    if (b.emom) {
      out.push({ k: "emom", ex: b.items[0], ...b.emom, block: b.label });
      return;
    }
    const sets = b.sets ?? 1;
    for (let s = 1; s <= sets; s++) {
      b.items.forEach((ex, i) => {
        out.push({ k: "ex", ex, set: s, sets, block: b.label });
        const lastOfAll = s === sets && bi === blocks.length - 1;
        if (i === b.items.length - 1 && !lastOfAll) out.push({ k: "rest", sec: s === sets ? p.blockRest : (b.rest ?? 60) });
      });
    }
  });
  if (!withBonus && p.bonus) out.push({ k: "bonus" });
  out.push({ k: "end" });
  return out;
}

/** Ajoute le gainage à une séance en cours, juste avant la fin (à la place de la proposition). */
export function withBonus(p: Program, steps: LiveStep[], at: number): LiveStep[] {
  const bonus = p.bonus;
  if (!bonus) return steps;
  const extra: LiveStep[] = [{ k: "rest", sec: bonus.rest ?? 30 }];
  const sets = bonus.sets ?? 2;
  for (let s = 1; s <= sets; s++)
    bonus.items.forEach((ex, i) => {
      extra.push({ k: "ex", ex, set: s, sets, block: bonus.label });
      if (i === bonus.items.length - 1 && s < sets) extra.push({ k: "rest", sec: bonus.rest ?? 30 });
    });
  return [...steps.slice(0, at), ...extra, { k: "end" }];
}

// ---------- Carnet ----------

export interface WorkoutEntry {
  ex: string;
  sets: number[]; // répétitions (ou secondes) par tour ; swings : total
  level: number; // cran de l'échelle
}

export interface Workout {
  id: string;
  date: string; // AAAA-MM-JJ
  ts: number;
  type: string; // "A", "B"
  minutes: number | null;
  note: string | null;
  entries: WorkoutEntry[];
}

/** Dernière fois qu'un exercice a été fait (séances triées de la plus récente à la plus ancienne). */
export function lastFor(workouts: Workout[], ex: string): (WorkoutEntry & { date: string }) | null {
  for (const w of workouts) {
    const e = w.entries.find((x) => x.ex === ex);
    if (e) return { ...e, date: w.date };
  }
  return null;
}

/** Double progression : haut de la fourchette sur au moins deux tours, tous les tours → cran suivant.
 * Rien pour un exercice minuté au bip (swings). */
export function ready(p: Program, workouts: Workout[], ex: string): boolean {
  const l = lastFor(workouts, ex);
  const e = p.exercises[ex];
  if (!l || !e || isEmom(p, ex)) return false;
  return l.sets.length >= 2 && l.sets.every((r) => r >= e.reps[1]);
}

const isEmom = (p: Program, ex: string) => Object.values(p.sessions).some((s) => s.blocks.some((b) => b.emom && b.items.includes(ex)));

export const levelFor = (workouts: Workout[], ex: string) => lastFor(workouts, ex)?.level ?? 0;

/** Les séances alternent dans l'ordre de leurs clés (A, B…) ; on commence par la première. */
export function nextType(p: Program, workouts: Workout[]): string {
  const keys = Object.keys(p.sessions);
  const i = keys.indexOf(workouts.find((w) => w.type in p.sessions)?.type ?? "");
  return keys[(i + 1) % keys.length];
}

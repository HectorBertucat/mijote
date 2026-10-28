// Générateur de programmes sans IA : à partir du matériel, du temps et du niveau, deux séances A/B
// en supersets (une famille de mouvement du bas avec une du haut), un échauffement et les principes.
// Tout vient de la bibliothèque (library.ts) : chaque exercice a déjà sa figure animée. Module pur
// (tests/training.test.ts). La version IA (ai.ts) part de la même demande et peut inventer des exercices.
import { available, LIBRARY, META, type Gear, type Pattern } from "./library";
import type { Block, Program, SessionDef } from "./program";

export type Focus = "equilibre" | "bas" | "haut" | "gainage";
export const FOCUS_LABEL: Record<Focus, string> = { equilibre: "Tout le corps", bas: "Plutôt le bas (jambes, fessiers)", haut: "Plutôt le haut (dos, bras, épaules)", gainage: "Ventre et dos (gainage)" };

export interface ProgramRequest {
  name?: string;
  gear: Gear[];
  /** Séances par semaine (2 à 4). */
  perWeek: number;
  /** Durée visée d'une séance, en minutes (20 à 60). */
  minutes: number;
  level: 1 | 2 | 3;
  focus: Focus;
  /** Contraintes en clair (douleurs, envies) : lues par l'IA seulement. */
  notes?: string;
}

/** Durée estimée d'une séance : échauffement, séries (≈ 45 s chacune), repos. */
export function sessionMinutes(p: Pick<Program, "blockRest">, s: SessionDef): number {
  let sec = 5 * 60; // échauffement
  s.blocks.forEach((b, i) => {
    if (b.emom) return void (sec += b.emom.rounds * b.emom.every);
    const sets = b.sets ?? 1;
    sec += sets * b.items.length * 45 + (sets - 1) * (b.rest ?? 60);
    if (i < s.blocks.length - 1) sec += p.blockRest;
  });
  return Math.round(sec / 60);
}

// Familles de chaque superset, séance A puis B. Le dernier bloc est la fin de séance (gainage).
const PLAN: Record<Focus, Pattern[][][]> = {
  equilibre: [
    [["squat", "tirage"], ["poussee", "charniere"], ["fessiers", "bras"]],
    [["fente", "epaules"], ["tirage", "fessiers"], ["poussee", "charniere"]],
  ],
  bas: [
    [["squat", "tirage"], ["charniere", "poussee"], ["fessiers", "fente"]],
    [["fente", "epaules"], ["fessiers", "tirage"], ["squat", "charniere"]],
  ],
  haut: [
    [["tirage", "squat"], ["poussee", "charniere"], ["epaules", "bras"]],
    [["poussee", "fente"], ["tirage", "fessiers"], ["bras", "epaules"]],
  ],
  gainage: [
    [["squat", "tirage"], ["poussee", "gainage"], ["fessiers", "charniere"]],
    [["fente", "gainage"], ["tirage", "fessiers"], ["poussee", "charniere"]],
  ],
};

// Quand une famille n'a aucun exercice possible avec ce matériel, on prend la suivante.
const FALLBACK: Record<Pattern, Pattern[]> = {
  squat: ["fente", "fessiers"],
  fente: ["squat", "fessiers"],
  charniere: ["fessiers", "fente"],
  fessiers: ["charniere", "squat"],
  tirage: ["epaules", "gainage"],
  poussee: ["epaules", "bras"],
  epaules: ["poussee", "bras"],
  bras: ["epaules", "poussee"],
  gainage: ["fessiers"],
  cardio: ["gainage"],
};

const WEEK: Record<number, string[][]> = {
  2: [["A", "Repos", "Repos", "B", "Repos", "Repos", "Repos"]],
  3: [
    ["A", "Repos", "B", "Repos", "A", "Repos", "Repos"],
    ["B", "Repos", "A", "Repos", "B", "Repos", "Repos"],
  ],
  4: [["A", "B", "Repos", "A", "B", "Repos", "Repos"]],
};

export const PRINCIPLES: Program["principles"] = [
  { title: "Le geste d'abord", text: "Les deux premières semaines, arrête chaque série quand il te reste 3 répétitions en réserve. La figure animée montre le tempo : suis-la." },
  { title: "Près de l'échec", text: "Ensuite, finis chaque série à 1 ou 2 répétitions de l'échec : une charge légère fait progresser autant qu'une lourde si la série est dure." },
  { title: "Double progression", text: "Haut de la fourchette sur toutes les séries : passe au cran suivant de l'échelle et repars du bas. Le carnet le signale." },
  { title: "Brûlure ou douleur", text: "Une brûlure dans le muscle, c'est voulu. Une douleur dans une articulation : arrête l'exercice et prends la version plus facile.", wide: true },
];

/** Exercices d'une famille, du plus proche du niveau au plus loin ; on évite ceux déjà pris. */
function pick(pattern: Pattern, pool: string[], level: number, taken: Set<string>, avoid: Set<string>): string | null {
  const order = [pattern, ...FALLBACK[pattern]];
  for (const pat of order) {
    const c = pool
      .filter((id) => META[id].pattern === pat && !taken.has(id) && META[id].level <= level + 1)
      .sort((a, b) => Number(avoid.has(a)) - Number(avoid.has(b)) || Math.abs(META[a].level - level) - Math.abs(META[b].level - level) || a.localeCompare(b));
    if (c.length) return c[0];
  }
  return null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

export function generateProgram(req: ProgramRequest, id: string): Program {
  const level = req.level;
  const pool = available(req.gear);
  const sets = level === 1 ? 2 : 3;
  const rest = level === 1 ? 75 : 60;
  // Supersets de ≈ 8 min (3 tours) ; le reste du temps va à l'échauffement et à la fin de séance.
  const supersets = clamp((req.minutes - 10) / (sets === 3 ? 8 : 6), 1, 4);
  const used = new Set<string>();
  const sessions: Record<string, SessionDef> = {};
  const plan = PLAN[req.focus] ?? PLAN.equilibre;

  (["A", "B"] as const).forEach((key, si) => {
    const taken = new Set<string>();
    const blocks: Block[] = [];
    const pairs = plan[si];
    for (let b = 0; b < supersets; b++) {
      const pats = pairs[b % pairs.length];
      const items = pats.map((p) => pick(p, pool, level, taken, used)).filter((x): x is string => Boolean(x));
      items.forEach((x) => taken.add(x));
      if (items.length) blocks.push({ label: `Bloc ${blocks.length + 1}`, sets, items, rest });
    }
    // Fin de séance : gainage (2 tours courts), et des swings si une kettlebell est là, en séance B.
    if (key === "B" && pool.includes("swing") && level >= 2) blocks.push({ label: "Finisher swings", items: ["swing"], emom: { rounds: 6, every: 30, reps: 10 } });
    else {
      const items: string[] = [];
      for (let k = 0; k < 2; k++) {
        const x = pick("gainage", pool, level, taken, used);
        if (x) {
          items.push(x);
          taken.add(x);
        }
      }
      if (items.length) blocks.push({ label: "Fin : gainage", sets: 2, items, rest: 30 });
    }
    taken.forEach((x) => used.add(x));
    const muscles = [...new Set(blocks.flatMap((bl) => bl.items).map((x) => LIBRARY[x].short))];
    sessions[key] = { name: `Séance ${key}`, sub: muscles.slice(0, 5).join(" · "), blocks };
  });

  const ids = [...new Set(Object.values(sessions).flatMap((s) => s.blocks.flatMap((b) => b.items)))];
  const exercises = Object.fromEntries(ids.map((x) => [x, LIBRARY[x]]));
  const first = sessions.A.blocks.flatMap((b) => b.items).slice(0, 3);
  const warmup = [
    "1 min de marche sur place, en montant les genoux",
    ...first.map((x) => `8 ${LIBRARY[x].short.toLowerCase()} lents, sans charge`),
    "10 rotations de hanches, 10 cercles de bras",
  ];
  const perWeek = clamp(req.perWeek, 2, 4);
  const program: Program = {
    id,
    name: req.name?.trim() || `Programme ${perWeek} × ${clamp(req.minutes, 15, 90)} min`,
    people: [],
    exercises,
    order: Object.keys(META).filter((x) => ids.includes(x)),
    sessions,
    bonus: null,
    warmup,
    blockRest: 90,
    weekPlan: WEEK[perWeek],
    checkpoint: null,
    short: "Séance",
    perWeek,
    alsoTrack: null,
    weekNote: `${perWeek} séances d'environ ${clamp(req.minutes, 15, 90)} min par semaine, jamais deux jours de suite quand c'est possible. L'onglet Séance propose automatiquement la bonne.`,
    principles: PRINCIPLES,
  };
  return program;
}

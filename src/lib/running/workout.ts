// Les séances (docs/course.md § 4.10) : une structure en blocs, la même pour l'écran de Mijote et pour la
// montre ; les types de séance, leurs constructeurs, les bornes vérifiées pour tout ce que produit le
// générateur ou l'IA, et la traduction en `WorkoutSpec` du contrat de l'app (v2.1). Pur.
import { SESSION_BOUNDS, WALK_RUN_LEVEL8_NEXT_S, WALK_RUN_LEVELS, WALK_RUN_WARMUP_S } from "./constants";
import { alertRanges, type Zones } from "./zones";

export const SESSION_KINDS = ["marche_course", "footing", "footing_lignes", "sortie_longue", "test_aerobie", "fartlek", "cotes", "tempo", "test_friel"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const KIND_LABEL: Record<SessionKind, string> = {
  marche_course: "Marche-course",
  footing: "Footing",
  footing_lignes: "Footing et lignes droites",
  sortie_longue: "Sortie longue",
  test_aerobie: "Test aérobie",
  fartlek: "Fartlek léger",
  cotes: "Côtes courtes",
  tempo: "Tempo",
  test_friel: "Test de Friel",
};

/** Première phase où chaque type est permis (§ 4.10). Le test aérobie arrive avec la phase 2 (§ 4.5). */
export const KIND_MIN_PHASE: Record<SessionKind, number> = { marche_course: 0, footing: 1, footing_lignes: 1, sortie_longue: 1, test_aerobie: 2, fartlek: 2, cotes: 2, tempo: 3, test_friel: 3 };
/** La marche-course est la séance de la phase 0, et reste permise ensuite (séance plus facile). */
export const kindAllowed = (k: SessionKind, phase: number) => phase >= KIND_MIN_PHASE[k] && (phase > 0 || k === "marche_course");

/** Séances de qualité (une par semaine en phase 2, deux en phase 3). */
export const QUALITY = new Set<SessionKind>(["fartlek", "cotes", "tempo", "test_friel"]);
/** Difficulté croissante : remplacer une séance ne peut que descendre (§ 6). */
export const DIFFICULTY: Record<SessionKind, number> = { marche_course: 1, footing: 2, footing_lignes: 3, sortie_longue: 3, test_aerobie: 3, fartlek: 4, cotes: 5, tempo: 6, test_friel: 7 };
/** Effort perçu prévu (pour « 2 points au-dessus du prévu », § 4.8). */
export const PLANNED_EFFORT: Record<SessionKind, number> = { marche_course: 4, footing: 4, footing_lignes: 4, sortie_longue: 4, test_aerobie: 4, fartlek: 6, cotes: 7, tempo: 7, test_friel: 9 };

export type Goal = { time: number } | { distance: number } | "open";
/** `hr` : plage en bpm ; `pace` : [plus rapide, plus lente] en s/km. Jamais `zone` : les zones de la montre ne sont pas les nôtres. */
export type Alert = null | { hr: [number, number] } | { pace: [number, number] };

export interface Step {
  goal: Goal;
  alert: Alert;
  label: string;
}
export interface IntervalStep extends Step {
  purpose: "work" | "recovery";
}
export interface Block {
  iterations: number;
  steps: IntervalStep[];
}

export interface RunSession {
  kind: SessionKind;
  title: string;
  warmup: Step;
  blocks: Block[];
  cooldown: Step;
  /** Consignes affichées et envoyées à la montre (« Tu dois pouvoir parler en courant. »). */
  notes: string;
  /** Niveau de marche-course (phase 0). */
  level?: number;
}

const t = (s: number): Goal => ({ time: Math.round(s) });
const secOf = (g: Goal) => (typeof g === "object" && "time" in g ? g.time : 0);

/** Durée totale en secondes (objectifs en temps ; une distance ou un objectif libre compte 0). */
export function sessionSeconds(s: RunSession): number {
  return secOf(s.warmup.goal) + secOf(s.cooldown.goal) + s.blocks.reduce((sum, b) => sum + b.iterations * b.steps.reduce((x, st) => x + secOf(st.goal), 0), 0);
}
export const sessionMinutes = (s: RunSession) => Math.round(sessionSeconds(s) / 60);

/** Temps de course prévu (hors marche) : ce que compte la règle des 30 jours pendant la marche-course. */
export function runSeconds(s: RunSession): number {
  if (s.kind !== "marche_course") return sessionSeconds(s) - secOf(s.warmup.goal) - secOf(s.cooldown.goal);
  return s.blocks.reduce((sum, b) => sum + b.iterations * b.steps.filter((st) => st.purpose === "work").reduce((x, st) => x + secOf(st.goal), 0), 0);
}

const EDGE_EASY = { warmup: "Marche rapide puis trot", cooldown: "Marche" };
const NOTE_EASY = "Tu dois pouvoir parler en phrases complètes. Si la FC dépasse la plage, ralentis, marche si besoin : c’est prévu.";

/** Un pas de travail découpé en morceaux de 90 min au plus (borne d'un pas). */
function longWork(seconds: number, label: string, alert: Alert): Block {
  const parts = Math.ceil(seconds / SESSION_BOUNDS.workMaxS);
  const each = Math.round(seconds / parts);
  return { iterations: 1, steps: Array.from({ length: parts }, (_, i) => ({ purpose: "work" as const, goal: t(i === parts - 1 ? seconds - each * (parts - 1) : each), alert, label: parts > 1 ? `${label} (${i + 1}/${parts})` : label })) };
}

/** Phase 0 : niveau 1 à 8 ; au niveau 8, 25 min la première fois puis 30 (`again`). */
export function walkRun(level: number, z: Zones, again = false): RunSession {
  const L = WALK_RUN_LEVELS[Math.min(8, Math.max(1, level)) - 1];
  const easy = alertRanges(z).easy;
  const run = L.level === 8 && again ? WALK_RUN_LEVEL8_NEXT_S : L.run;
  const steps: IntervalStep[] = [{ purpose: "work", goal: t(run), alert: { hr: easy }, label: "Course facile" }];
  if (L.walk) steps.push({ purpose: "recovery", goal: t(L.walk), alert: null, label: "Marche" });
  const s: RunSession = {
    kind: "marche_course",
    title: "",
    level: L.level,
    warmup: { goal: t(WALK_RUN_WARMUP_S), alert: null, label: "Marche rapide" },
    blocks: [{ iterations: L.reps, steps }],
    cooldown: { goal: t(WALK_RUN_WARMUP_S), alert: null, label: "Marche" },
    notes: "Course en endurance (effort 3 à 4, on peut parler). Si la FC dépasse la plage, ralentis, et marche si besoin : c’est prévu, pas un échec.",
  };
  const runMin = Math.round(runSeconds(s) / 60);
  s.title = L.walk ? `Marche-course niveau ${L.level} : ${L.reps} × ${fmtS(L.run)} de course` : `Marche-course niveau ${L.level} : ${runMin} min de course continue`;
  return s;
}

/** Footing de `minutes` en tout (échauffement et retour compris), avec ou sans lignes droites. */
export function footing(minutes: number, z: Zones, strides = 0): RunSession {
  const easy = alertRanges(z).easy;
  const stridesS = strides * (20 + 75);
  const work = minutes * 60 - 600 - stridesS;
  const blocks: Block[] = [longWork(work, "Footing en endurance", { hr: easy })];
  if (strides)
    blocks.push({
      iterations: strides,
      steps: [
        { purpose: "work", goal: t(20), alert: null, label: "Ligne droite : vite et relâché" },
        { purpose: "recovery", goal: t(75), alert: null, label: "Marche" },
      ],
    });
  return {
    kind: strides ? "footing_lignes" : "footing",
    title: strides ? `Footing ${minutes} min et ${strides} lignes droites` : `Footing facile ${minutes} min`,
    warmup: { goal: t(300), alert: null, label: EDGE_EASY.warmup },
    blocks,
    cooldown: { goal: t(300), alert: null, label: EDGE_EASY.cooldown },
    notes: strides ? `${NOTE_EASY} Les lignes droites : 20 s vite et relâché, pas un sprint.` : NOTE_EASY,
  };
}

export function longRun(minutes: number, z: Zones): RunSession {
  return {
    kind: "sortie_longue",
    title: `Sortie longue ${minutes} min`,
    warmup: { goal: t(300), alert: null, label: EDGE_EASY.warmup },
    blocks: [longWork(minutes * 60 - 600, "Sortie longue en endurance", { hr: alertRanges(z).easy })],
    cooldown: { goal: t(300), alert: null, label: EDGE_EASY.cooldown },
    notes: `${NOTE_EASY} Les 10 dernières minutes peuvent finir en haut de la plage.`,
  };
}

export function aerobicTest(z: Zones): RunSession {
  return {
    kind: "test_aerobie",
    title: "Test aérobie : 30 min à FC fixe",
    warmup: { goal: t(600), alert: null, label: EDGE_EASY.warmup },
    blocks: [{ iterations: 1, steps: [{ purpose: "work", goal: t(1800), alert: { hr: alertRanges(z).z2mid }, label: "FC fixe, milieu de l’endurance" }] }],
    cooldown: { goal: t(300), alert: null, label: EDGE_EASY.cooldown },
    notes: "Garde la FC au milieu de la plage, sur le plat si possible : l’allure obtenue se compare de test en test.",
  };
}

export function fartlek(reps: number, z: Zones): RunSession {
  const r = alertRanges(z);
  return {
    kind: "fartlek",
    title: `Fartlek léger : ${reps} × 1 min soutenue`,
    warmup: { goal: t(600), alert: null, label: EDGE_EASY.warmup },
    blocks: [
      {
        iterations: reps,
        steps: [
          { purpose: "work", goal: t(60), alert: { hr: r.steady }, label: "Soutenu" },
          { purpose: "recovery", goal: t(120), alert: { hr: r.easy }, label: "Footing" },
        ],
      },
    ],
    cooldown: { goal: t(600), alert: null, label: "Footing lent puis marche" },
    notes: "Soutenu : effort 6 à 7, on dit quelques mots. Le footing entre deux reste facile.",
  };
}

export function hills(reps: number): RunSession {
  return {
    kind: "cotes",
    title: `Côtes courtes : ${reps} × 45 s`,
    warmup: { goal: t(900), alert: null, label: "Footing facile" },
    blocks: [
      {
        iterations: reps,
        steps: [
          { purpose: "work", goal: t(45), alert: null, label: "Montée (5 à 8 %)" },
          { purpose: "recovery", goal: t(90), alert: null, label: "Descente en marchant ou trottinant" },
        ],
      },
    ],
    cooldown: { goal: t(600), alert: null, label: "Footing lent puis marche" },
    notes: "Effort 7 à 8 en montée, sans alerte de FC (elle arrive après l’effort). Redescends tranquillement.",
  };
}

export function tempo(reps: number, z: Zones): RunSession {
  const r = alertRanges(z);
  return {
    kind: "tempo",
    title: `Tempo : ${reps} × 8 min`,
    warmup: { goal: t(900), alert: null, label: "Footing facile" },
    blocks: [
      {
        iterations: reps,
        steps: [
          { purpose: "work", goal: t(480), alert: { hr: r.tempo }, label: "Tempo" },
          { purpose: "recovery", goal: t(150), alert: { hr: r.easy }, label: "Footing" },
        ],
      },
    ],
    cooldown: { goal: t(600), alert: null, label: "Footing lent puis marche" },
    notes: "« Confortablement difficile » : effort 6 à 7.",
  };
}

export function frielTest(): RunSession {
  return {
    kind: "test_friel",
    title: "Test de Friel : 30 min à fond régulier",
    warmup: { goal: t(900), alert: null, label: "Footing facile" },
    blocks: [{ iterations: 1, steps: [{ purpose: "work", goal: t(1800), alert: null, label: "À fond, régulier" }] }],
    cooldown: { goal: t(600), alert: null, label: "Footing lent puis marche" },
    notes: "Seul, sur un parcours plat. La FC moyenne des 20 dernières minutes donne ta FC au seuil.",
  };
}

/** Une séance de `kind` à environ `minutes` (pour un remplacement : le code compose, l'IA ne fait que choisir). */
export function sessionOf(kind: SessionKind, minutes: number, z: Zones, level = 1): RunSession {
  switch (kind) {
    case "marche_course":
      return walkRun(level, z);
    case "footing":
      return footing(minutes, z);
    case "footing_lignes":
      return footing(minutes, z, 4);
    case "sortie_longue":
      return longRun(minutes, z);
    case "test_aerobie":
      return aerobicTest(z);
    case "fartlek":
      return fartlek(6, z);
    case "cotes":
      return hills(6);
    case "tempo":
      return tempo(2, z);
    case "test_friel":
      return frielTest();
  }
}

/** Raccourcit une séance à `minutes` en tout : seul le pas principal raccourcit (le reste ne bouge pas). */
export function shorten(s: RunSession, minutes: number, z: Zones): RunSession {
  if (s.kind === "footing" || s.kind === "footing_lignes") return footing(minutes, z, s.kind === "footing_lignes" && minutes >= 25 ? 4 : 0);
  if (s.kind === "sortie_longue") return { ...longRun(minutes, z), notes: s.notes };
  // Les autres : moins de répétitions jusqu'à tenir dans la durée.
  const target = minutes * 60;
  const out: RunSession = structuredClone(s);
  for (const b of out.blocks) while (b.iterations > 1 && sessionSeconds(out) > target) b.iterations--;
  if (sessionSeconds(out) > target) return footing(Math.max(20, minutes), z);
  out.title = `${s.title} (raccourcie)`;
  return out;
}

const fmtS = (s: number) => (s % 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}` : `${s / 60} min`);

// ─── Bornes (§ 4.10) ───

/** Les erreurs d'une séance (vide si elle est valide) : durées, répétitions, alertes dans la table de zones. */
export function checkSession(s: RunSession, z: Zones | null): string[] {
  const B = SESSION_BOUNDS;
  const err: string[] = [];
  if (!SESSION_KINDS.includes(s.kind)) err.push(`type inconnu : ${String(s.kind)}`);
  const total = sessionSeconds(s);
  if (total < B.totalMin * 60 || total > B.totalMax * 60) err.push(`durée ${Math.round(total / 60)} min hors de ${B.totalMin}–${B.totalMax} min`);
  for (const [name, st] of [
    ["échauffement", s.warmup],
    ["retour au calme", s.cooldown],
  ] as const) {
    const sec = secOf(st.goal);
    if (sec < B.edgeMinS || sec > B.edgeMaxS) err.push(`${name} de ${Math.round(sec / 60)} min hors de 3–20 min`);
  }
  if (!s.blocks.length) err.push("aucun bloc");
  for (const b of s.blocks) {
    if (!Number.isInteger(b.iterations) || b.iterations < 1 || b.iterations > B.iterationsMax) err.push(`${b.iterations} répétitions hors de 1–${B.iterationsMax}`);
    if (!b.steps.length) err.push("bloc vide");
    for (const st of b.steps) {
      const sec = secOf(st.goal);
      if (st.goal !== "open" && !sec) continue;
      if (st.purpose === "work" && st.goal !== "open" && (sec < B.workMinS || sec > B.workMaxS)) err.push(`pas « ${st.label} » de ${sec} s hors de 10 s–90 min`);
      if (st.purpose === "recovery" && (sec < B.recoveryMinS || sec > B.recoveryMaxS)) err.push(`récupération « ${st.label} » de ${sec} s hors de 30 s–10 min`);
    }
  }
  for (const st of [s.warmup, s.cooldown, ...s.blocks.flatMap((b) => b.steps)]) {
    const a = st.alert;
    if (!a) continue;
    if ("hr" in a) {
      const [lo, hi] = a.hr;
      if (!(hi - lo >= 8)) err.push(`plage de FC ${lo}–${hi} de moins de 8 bpm`);
      if (z && (lo < z.lows[0] || hi > z.max)) err.push(`plage de FC ${lo}–${hi} hors des zones (${z.lows[0]}–${z.max})`);
    } else if ("pace" in a) {
      const [fast, slow] = a.pace;
      if (!(fast < slow) || fast < 120 || slow > 1200) err.push(`plage d’allure ${fast}–${slow} s/km invalide`);
    } else err.push("alerte inconnue");
  }
  return err;
}

// ─── Vers la montre : WorkoutSpec (contrat de l'app, v2.1) ───

export type SpecGoal = { type: "open" } | { type: "time"; value: number; unit: "seconds" | "minutes" } | { type: "distance"; value: number; unit: "meters" };
export type SpecAlert = { type: "heartRate"; range_min: number; range_max: number; unit: "bpm" } | { type: "pace"; range_min: number; range_max: number; unit: "min/km" };
export interface SpecStep {
  goal: SpecGoal;
  alert?: SpecAlert;
  display_name?: string;
}
export interface WorkoutSpec {
  name: string;
  activity: "running";
  location: "outdoor";
  warmup: SpecStep;
  blocks: { iterations: number; steps: (SpecStep & { type: "work" | "recovery" })[] }[];
  cooldown: SpecStep;
}

const specGoal = (g: Goal): SpecGoal => {
  if (g === "open") return { type: "open" };
  if ("distance" in g) return { type: "distance", value: Math.round(g.distance), unit: "meters" };
  return g.time % 60 === 0 ? { type: "time", value: g.time / 60, unit: "minutes" } : { type: "time", value: g.time, unit: "seconds" };
};
const specAlert = (a: Alert): SpecAlert | undefined => {
  if (!a) return undefined;
  if ("hr" in a) return { type: "heartRate", range_min: a.hr[0], range_max: a.hr[1], unit: "bpm" };
  return { type: "pace", range_min: Math.round((a.pace[0] / 60) * 100) / 100, range_max: Math.round((a.pace[1] / 60) * 100) / 100, unit: "min/km" };
};
const specStep = (s: Step): SpecStep => {
  const a = specAlert(s.alert);
  return { goal: specGoal(s.goal), ...(a ? { alert: a } : {}), display_name: s.label.slice(0, 60) };
};

/** La séance telle que l'app la programme avec WorkoutKit (`CustomWorkout`, alertes en plage de bpm). */
export function toWorkoutSpec(s: RunSession): WorkoutSpec {
  return {
    name: s.title.slice(0, 60),
    activity: "running",
    location: "outdoor",
    warmup: specStep(s.warmup),
    blocks: s.blocks.map((b) => ({ iterations: b.iterations, steps: b.steps.map((st) => ({ type: st.purpose, ...specStep(st) })) })),
    cooldown: specStep(s.cooldown),
  };
}

/** Une séance en lignes de texte (page minimale, contexte de l'assistant). */
export function describe(s: RunSession): string[] {
  const alert = (a: Alert) => (!a ? "" : "hr" in a ? ` (${a.hr[0]}–${a.hr[1]} bpm)` : ` (${fmtS(a.pace[0])}–${fmtS(a.pace[1])}/km)`);
  const goal = (g: Goal) => (g === "open" ? "libre" : "time" in g ? fmtS(g.time) : `${g.distance} m`);
  return [
    `${s.warmup.label} ${goal(s.warmup.goal)}${alert(s.warmup.alert)}`,
    ...s.blocks.map((b) => `${b.iterations > 1 ? `${b.iterations} × ` : ""}${b.steps.map((st) => `${st.label} ${goal(st.goal)}${alert(st.alert)}`).join(", ")}`),
    `${s.cooldown.label} ${goal(s.cooldown.goal)}${alert(s.cooldown.alert)}`,
  ];
}

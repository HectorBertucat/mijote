// Programme d'entraînement créé par l'IA (Sonnet, sortie structurée), vérifié par le code :
// - les séances piochent dans la bibliothèque (exercices faisables avec le matériel dit) ;
// - l'IA peut inventer un exercice qui manque, avec sa figure animée (poses clés du squelette) ;
// - le code vérifie tout (ids, matériel, séries, figures : motion-check.ts) ; une figure refusée
//   repart une fois à l'IA avec la liste des erreurs, puis, si elle reste fausse, l'exercice est
//   remplacé par un exercice de la bibliothèque de la même famille.
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { MODELS, structured } from "@/lib/ai";
import { generateProgram, FOCUS_LABEL, PRINCIPLES, sessionMinutes, type ProgramRequest } from "./generate";
import { MOTIONS } from "./figures";
import { available, GEAR_LABEL, GEARS, LIBRARY, META, PATTERN_LABEL, PATTERNS, type Gear, type Pattern } from "./library";
import { checkMotion } from "./motion-check";
import type { Key, Motion } from "./motion";
import type { Block, Exercise, Program, SessionDef } from "./program";
import type { Joint } from "./skeleton";

const JOINTS = ["hip", "shoulder", "neck", "head", "kneeN", "ankleN", "toeN", "kneeF", "ankleF", "toeF", "elbowN", "handN", "elbowF", "handF"] as const;

// ─── Ce que l'IA rend ───

const AiAngles = z.object({
  torso: z.number(),
  neck: z.number(),
  thighN: z.number(),
  shinN: z.number(),
  thighF: z.number(),
  shinF: z.number(),
  upperN: z.number(),
  foreN: z.number(),
  upperF: z.number(),
  foreF: z.number(),
  footN: z.number(),
  footF: z.number(),
});
const AiKey = z.object({
  angles: AiAngles,
  anchor: z.enum(JOINTS).describe("L'articulation immobile, posée à (anchorX, anchorY)"),
  anchorX: z.number(),
  anchorY: z.number(),
  ik: z.array(z.object({ end: z.enum(["handN", "handF", "ankleN", "ankleF"]), x: z.number(), y: z.number(), bend: z.enum(["avant", "arriere"]) })).describe("Extrémités fixées (main ou cheville posée) ; [] sinon"),
  bell: z.object({ hand: z.enum(["handN", "handF"]), dx: z.number(), dy: z.number() }).nullable().describe("Charge tenue (kettlebell, haltère) ; null sinon"),
});
const AiMotion = z.object({
  keys: z.array(AiKey).describe("2 à 4 poses clés ; la pose 0 est la position de départ"),
  steps: z.array(z.object({ to: z.number().int(), dur: z.number(), label: z.string(), count: z.boolean() })).describe("Le tempo d'une répétition : chaque étape va vers une pose en `dur` secondes ; libellé court à l'impératif"),
});
const AiExercise = z.object({
  id: z.string().describe("Identifiant court en minuscules, sans espace (ex. « pont-une-jambe »)"),
  name: z.string(),
  short: z.string(),
  muscles: z.string(),
  repsMin: z.number().int(),
  repsMax: z.number().int(),
  uni: z.boolean().describe("Un côté à la fois : le compte est par côté"),
  seconds: z.boolean().describe("Tenue en secondes (gainage) plutôt que des répétitions"),
  tempo: z.string(),
  cues: z.array(z.string()),
  errors: z.array(z.string()),
  ladder: z.array(z.string()).describe("Échelle de progression, 3 à 5 crans, du plus facile au plus dur"),
  position: z.string(),
  movement: z.string(),
  feel: z.string(),
  breathing: z.string(),
  easier: z.string(),
  gear: z.array(z.enum(GEARS as [Gear, ...Gear[]])),
  pattern: z.enum(PATTERNS as [Pattern, ...Pattern[]]),
});
const AiBlock = z.object({
  label: z.string(),
  sets: z.number().int(),
  rest: z.number().int().describe("Secondes de repos entre les tours"),
  items: z.array(z.string()).describe("Ids d'exercices (bibliothèque ou newExercises), 1 à 3 en superset"),
  emom: z.object({ rounds: z.number().int(), every: z.number().int(), reps: z.number().int() }).nullable(),
});
/** Ce que rend le premier appel : le programme, exercices inventés sans leur figure (le schéma complet, figures
 * comprises, dépasse la taille de grammaire permise par l'API : les figures viennent d'un second appel). */
export const AiPlanOutput = z.object({
  name: z.string(),
  explanation: z.string().describe("2 ou 3 phrases : pourquoi ce programme pour cette personne"),
  sessions: z.array(z.object({ name: z.string(), sub: z.string(), blocks: z.array(AiBlock) })).describe("2 ou 3 séances alternées (A, B, C)"),
  warmup: z.array(z.string()),
  principles: z.array(z.object({ title: z.string(), text: z.string() })),
  weekNote: z.string(),
  newExercises: z.array(AiExercise).describe("Exercices inventés quand la bibliothèque n'a rien qui convient ; [] sinon"),
});
/** Le programme complet, figures comprises, tel que le code le vérifie. */
export type AiProgramOutput = Omit<z.infer<typeof AiPlanOutput>, "newExercises"> & { newExercises: (z.infer<typeof AiExercise> & { motion: z.infer<typeof AiMotion> })[] };
type AiOut = AiProgramOutput;
type AiEx = AiOut["newExercises"][number];

/** Second appel (et correction) : la figure de chaque exercice inventé. */
const AiFigures = z.object({ exercises: z.array(z.object({ id: z.string(), motion: AiMotion })) });

// ─── Conversions ───

export function fromAiMotion(m: z.infer<typeof AiMotion>): Motion {
  return {
    keys: m.keys.map((k): Key => ({
      a: { ...k.angles },
      c: {
        anchor: k.anchor as Joint,
        at: [k.anchorX, k.anchorY],
        ...(k.ik.length ? { ik: Object.fromEntries(k.ik.map((t) => [t.end, { at: [t.x, t.y] as [number, number], bend: t.bend === "avant" ? (1 as const) : (-1 as const) }])) } : {}),
      },
      bell: k.bell,
    })),
    steps: m.steps.map((s) => ({ to: s.to, dur: s.dur, label: s.label, ...(s.count ? { count: true } : {}) })),
  };
}

function toAiMotion(m: Motion): z.infer<typeof AiMotion> {
  return {
    keys: m.keys.map((k) => ({
      angles: { neck: 0, footN: 0, footF: 0, ...k.a },
      anchor: k.c.anchor,
      anchorX: k.c.at[0],
      anchorY: k.c.at[1],
      ik: Object.entries(k.c.ik ?? {}).map(([end, t]) => ({ end: end as "handN", x: t.at[0], y: t.at[1], bend: t.bend === 1 ? ("avant" as const) : ("arriere" as const) })),
      bell: k.bell ?? null,
    })),
    steps: m.steps.map((s) => ({ to: s.to, dur: s.dur, label: s.label, count: !!s.count })),
  };
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "exercice";

function toExercise(x: AiEx): Exercise {
  const lo = Math.max(1, Math.min(x.repsMin, x.repsMax));
  return {
    name: x.name,
    short: x.short || x.name,
    muscles: x.muscles,
    reps: [lo, Math.max(lo, x.repsMax)],
    uni: x.uni,
    ...(x.seconds ? { unit: "s" as const } : {}),
    tempo: x.tempo,
    cues: x.cues.slice(0, 6),
    errors: x.errors.slice(0, 4),
    ladder: x.ladder.length ? x.ladder.slice(0, 6) : [x.name],
    guide: { position: x.position, movement: x.movement, feel: x.feel, breathing: x.breathing, easier: x.easier },
  };
}

// ─── Prompt ───

const REFERENCES = ["goblet", "jBridge", "pushup"];

export function programSystem(): string {
  const lib = Object.keys(META)
    .map((id) => `${id} : ${LIBRARY[id].name} — ${PATTERN_LABEL[META[id].pattern]}, matériel ${META[id].gear.map((g) => GEAR_LABEL[g]).join(" + ") || "aucun"}, niveau ${META[id].level}, ${LIBRARY[id].reps[0]}-${LIBRARY[id].reps[1]}${LIBRARY[id].unit === "s" ? " s" : " reps"}`)
    .join("\n");
  const refs = REFERENCES.map((id) => `${id} (${LIBRARY[id].name}) :\n${JSON.stringify(toAiMotion(MOTIONS[id]))}`).join("\n\n");
  return `Tu es coach de renforcement musculaire à la maison. Tu écris des programmes en français, au format JSON demandé, qu'un programme vérifie ensuite. Chaque exercice a une figure animée (un bonhomme de profil) qui montre le geste et son tempo.

Règles du programme :
- 2 ou 3 séances alternées (A, B, éventuellement C) ; chaque séance : 2 à 4 blocs en superset (un exercice du bas du corps avec un du haut, 2 à 4 tours, 45 à 90 s de repos), puis une fin courte (gainage ou finisher).
- La durée d'une séance doit tenir dans le temps demandé (échauffement 5 min ; une série ≈ 45 s).
- N'utilise que le matériel de la personne. Respecte ses contraintes (douleurs, envies) : un exercice qui gêne est remplacé, pas ignoré.
- Utilise d'abord la bibliothèque ci-dessous (ids exacts). N'invente un exercice (newExercises) que si rien ne convient ; 3 au plus.
- Débutant : exercices de niveau 1, 2 tours ; intermédiaire : niveaux 1-2, 3 tours ; avancé : niveaux 2-3.

Bibliothèque (id : nom — famille, matériel, niveau, fourchette) :
${lib}

Figure d'un exercice inventé (motion) — un squelette de profil, tourné vers la droite, sol à y = 186 (y vers le bas) :
- Segments : buste 50, cou 7, tête 11, cuisse 40, tibia 39, pied 13, bras 29, avant-bras 27. Bras tendu = 56, jambe tendue = 79.
- Angles en degrés. Cuisse, tibia, bras, avant-bras : 0 = vertical vers le bas, positif = vers l'avant (la droite). Buste : 0 = vertical vers le haut, positif = penché en avant, 90 = allongé (tête à droite). Cou relatif au buste. Pied : angle avec l'horizontale (0 = à plat, pointe vers l'avant). Suffixe N = côté proche, F = côté éloigné.
- anchor : l'articulation qui ne bouge pas (cheville d'appui, hanche au sol, épaule…), posée en (anchorX, anchorY) ; chevilles et mains posées au sol : y = 183. Garde le même anchor dans toutes les poses.
- ik : une main ou une cheville fixée (mains au sol pour une planche, pieds à plat pour un pont) ; le coude ou le genou est calculé. bend « avant » = articulation vers l'avant. La cible doit être à portée (≤ 56 de l'épaule, ≤ 79 de la hanche).
- Rien sous le sol, au moins un appui au sol dans chaque pose, la figure tient dans x de 0 à 200.
- steps : le tempo d'une répétition (2 à 6 étapes, 0,3 à 5 s chacune), libellés courts à l'impératif (« Descends », « Tiens », « Remonte »), count = true pour afficher le décompte.

Figures de référence (même format) :
${refs}`;
}

const LEVEL_LABEL = { 1: "débutant", 2: "intermédiaire", 3: "avancé" } as const;

export function programPrompt(req: ProgramRequest, person: { name: string; sex?: string | null; age?: number | null }): string {
  const gear = req.gear.length ? req.gear.map((g) => GEAR_LABEL[g]).join(", ") : "aucun (poids du corps)";
  return `Personne : ${person.name}${person.sex === "f" ? ", femme" : person.sex === "m" ? ", homme" : ""}${person.age ? `, ${person.age} ans` : ""}.
Niveau : ${LEVEL_LABEL[req.level]}.
Matériel : ${gear}. Exercices de la bibliothèque possibles avec ce matériel : ${available(req.gear).join(", ")}.
Séances : ${req.perWeek} par semaine, ${req.minutes} min chacune.
Objectif : ${FOCUS_LABEL[req.focus]}.
${req.notes?.trim() ? `Contraintes et envies : ${req.notes.trim().slice(0, 800)}` : "Pas de contrainte particulière."}

Écris le programme.`;
}

// ─── Vérification ───

export interface AiProgramResult {
  program: Program;
  explanation: string;
  warnings: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Transforme la sortie de l'IA en programme vérifié (pur, testé). */
export function verifyAiProgram(out: AiOut, req: ProgramRequest, id: string, fixed: Record<string, Motion> = {}): AiProgramResult & { badMotions: { id: string; errors: string[] }[] } {
  const warnings: string[] = [];
  const pool = new Set(available(req.gear));
  const have = new Set<Gear>([...req.gear, "aucun"]);
  const exercises: Record<string, Exercise> = {};
  const motions: Record<string, Motion> = {};
  const badMotions: { id: string; errors: string[] }[] = [];
  const patternOf: Record<string, Pattern> = {};
  const rename = new Map<string, string>();

  for (const x of out.newExercises.slice(0, 3)) {
    let nid = `ia-${slug(x.id || x.name)}`;
    while (exercises[nid] || LIBRARY[nid]) nid += "-2";
    rename.set(x.id, nid);
    const missing = x.gear.filter((g) => !have.has(g));
    if (missing.length) {
      warnings.push(`« ${x.name} » demande ${missing.map((g) => GEAR_LABEL[g].toLowerCase()).join(", ")} : retiré.`);
      rename.set(x.id, "");
      continue;
    }
    const motion = fixed[nid] ?? fromAiMotion(x.motion);
    const errors = checkMotion(motion);
    if (errors.length) badMotions.push({ id: nid, errors });
    exercises[nid] = toExercise(x);
    motions[nid] = motion;
    patternOf[nid] = x.pattern;
  }

  const resolveItem = (raw: string): string | null => {
    const r = rename.get(raw);
    if (r !== undefined) return r || null;
    if (pool.has(raw)) return raw;
    if (LIBRARY[raw]) warnings.push(`« ${LIBRARY[raw].name} » demande un matériel absent : retiré.`);
    else warnings.push(`Exercice inconnu « ${raw} » : retiré.`);
    return null;
  };

  const keys = ["A", "B", "C"];
  const sessions: Record<string, SessionDef> = {};
  out.sessions.slice(0, 3).forEach((s, i) => {
    const blocks: Block[] = [];
    for (const b of s.blocks.slice(0, 6)) {
      const items = [...new Set(b.items.map(resolveItem).filter((x): x is string => Boolean(x)))].slice(0, 3);
      if (!items.length) continue;
      if (b.emom) blocks.push({ label: b.label, items: [items[0]], emom: { rounds: clamp(b.emom.rounds, 2, 15), every: clamp(b.emom.every, 20, 90), reps: clamp(b.emom.reps, 3, 30) } });
      else blocks.push({ label: b.label, items, sets: clamp(b.sets, 1, 5), rest: clamp(b.rest, 15, 180) });
    }
    if (blocks.length) sessions[keys[Object.keys(sessions).length]] = { name: `Séance ${keys[Object.keys(sessions).length]}`, sub: s.sub || s.name, blocks };
    else warnings.push(`Séance ${keys[i]} vide après vérification : retirée.`);
  });
  if (Object.keys(sessions).length < 2) throw new Error("Le programme proposé n'a pas deux séances faisables avec ce matériel.");

  const used = new Set(Object.values(sessions).flatMap((s) => s.blocks.flatMap((b) => b.items)));
  for (const idx of Object.keys(exercises)) if (!used.has(idx)) delete exercises[idx], delete motions[idx];
  for (const x of used) if (!exercises[x]) exercises[x] = LIBRARY[x];

  const blockRest = 90;
  for (const [k, s] of Object.entries(sessions)) {
    const min = sessionMinutes({ blockRest }, s);
    if (min > req.minutes * 1.35) warnings.push(`Séance ${k} : environ ${min} min, plus que les ${req.minutes} prévues.`);
  }
  const perWeek = clamp(req.perWeek, 2, 4);
  const base = generateProgram(req, id);
  return {
    program: {
      ...base,
      name: out.name.trim().slice(0, 60) || base.name,
      exercises,
      order: [...used],
      sessions,
      warmup: out.warmup.length ? out.warmup.slice(0, 8) : base.warmup,
      perWeek,
      weekNote: out.weekNote || base.weekNote,
      principles: out.principles.length ? out.principles.slice(0, 6).map((p, i) => ({ ...p, ...(i >= 4 ? { wide: true } : {}) })) : PRINCIPLES,
      motions,
      source: "ia",
    },
    explanation: out.explanation,
    warnings,
    badMotions: badMotions.filter((b) => used.has(b.id)),
  };
}

/** Remplace un exercice inventé dont la figure reste fausse par un exercice de la bibliothèque de la même famille. */
export function replaceBad(p: Program, bad: string, req: ProgramRequest, pattern: Pattern | undefined): { program: Program; with: string | null } {
  const pool = available(req.gear).filter((x) => !Object.values(p.sessions).some((s) => s.blocks.some((b) => b.items.includes(x))));
  const sub = pool.find((x) => META[x].pattern === pattern) ?? pool.find((x) => META[x].pattern === "gainage") ?? null;
  const sessions = Object.fromEntries(
    Object.entries(p.sessions).map(([k, s]) => [k, { ...s, blocks: s.blocks.map((b) => ({ ...b, items: b.items.flatMap((x) => (x === bad ? (sub ? [sub] : []) : [x])) })).filter((b) => b.items.length) }])
  );
  const exercises = { ...p.exercises };
  const motions = { ...p.motions };
  delete exercises[bad];
  delete motions[bad];
  if (sub) exercises[sub] = LIBRARY[sub];
  return { program: { ...p, sessions, exercises, motions, order: p.order.map((x) => (x === bad ? sub : x)).filter((x): x is string => Boolean(x)) }, with: sub };
}

// ─── Appel ───

function mockProgram(req: ProgramRequest): AiOut {
  const g = generateProgram(req, "mock");
  const sessions = Object.values(g.sessions).map((s) => ({ name: s.name, sub: s.sub, blocks: s.blocks.map((b) => ({ label: b.label, sets: b.sets ?? 2, rest: b.rest ?? 60, items: b.items, emom: b.emom ?? null })) }));
  const bridge = LIBRARY.jBridge;
  sessions[0].blocks.push({ label: "Bonus IA", sets: 2, rest: 30, items: ["pont-tenu"], emom: null });
  return {
    name: "Programme simulé",
    explanation: "Réponse simulée (MIJOTE_AI_MOCK) : le générateur, plus un exercice « inventé » qui reprend la figure du pont fessier.",
    sessions,
    warmup: g.warmup,
    principles: [],
    weekNote: g.weekNote,
    newExercises: [
      {
        id: "pont-tenu",
        name: "Pont fessier tenu",
        short: "Pont tenu",
        muscles: bridge.muscles,
        repsMin: 20,
        repsMax: 40,
        uni: false,
        seconds: true,
        tempo: "tenue",
        cues: bridge.cues,
        errors: bridge.errors,
        ladder: ["20 s", "30 s", "40 s", "Une jambe"],
        position: bridge.guide?.position ?? "",
        movement: "Monte le bassin et tiens.",
        feel: "Les fesses.",
        breathing: "Respire calmement.",
        easier: "Moins haut.",
        gear: [],
        pattern: "fessiers",
        motion: toAiMotion(MOTIONS.jBridge),
      },
    ],
  };
}

/** Consigne du second appel : dessiner la figure des exercices inventés. */
function figuresPrompt(list: z.infer<typeof AiExercise>[]): string {
  return `Dessine la figure animée (motion) de chacun de ces exercices inventés, au format des figures de référence, avec le même id :\n${list
    .map((x) => `- ${x.id} : ${x.name}. Position : ${x.position} Mouvement : ${x.movement} Tempo : ${x.tempo}. ${x.uni ? "Un côté à la fois." : ""}${x.seconds ? " Tenue en secondes." : ""}`)
    .join("\n")}`;
}

export async function aiProgram(db: Db, req: ProgramRequest, person: { name: string; sex?: string | null; age?: number | null }, id: string): Promise<AiProgramResult> {
  const system = programSystem();
  const mock = mockProgram(req);
  const plan = await structured({
    db,
    screen: "programme",
    model: MODELS.plan,
    effort: "medium",
    maxTokens: 12000,
    system,
    prompt: programPrompt(req, person),
    schema: AiPlanOutput,
    devMock: () => ({ ...mock, newExercises: mock.newExercises.map(({ motion: _m, ...x }) => x) }),
  });
  const invented = plan.newExercises.slice(0, 3);
  const drawn = new Map<string, z.infer<typeof AiMotion>>();
  if (invented.length) {
    const f = await structured({
      db,
      screen: "programme",
      model: MODELS.plan,
      effort: "medium",
      maxTokens: 12000,
      system,
      prompt: figuresPrompt(invented),
      schema: AiFigures,
      devMock: () => ({ exercises: mock.newExercises.map((x) => ({ id: x.id, motion: x.motion })) }),
    });
    for (const e of f.exercises) drawn.set(e.id, e.motion);
  }
  // Un exercice sans figure garde une figure vide : refusée par la vérification, elle passe par la correction.
  const out: AiOut = { ...plan, newExercises: invented.map((x) => ({ ...x, motion: drawn.get(x.id) ?? drawn.get(`ia-${slug(x.id)}`) ?? { keys: [], steps: [] } })) };
  let res = verifyAiProgram(out, req, id);
  // Une seconde chance pour les figures refusées, avec les erreurs précises.
  if (res.badMotions.length) {
    const fix = await structured({
      db,
      screen: "programme",
      model: MODELS.plan,
      effort: "medium",
      maxTokens: 12000,
      system,
      prompt: `Ces figures ont été refusées par le programme de vérification. Corrige-les (même format, mêmes ids) :\n${res.badMotions
        .map((b) => `- ${b.id} (${res.program.exercises[b.id]?.name}) :\n  ${b.errors.join("\n  ")}\n  figure actuelle : ${JSON.stringify(toAiMotion(res.program.motions![b.id]))}`)
        .join("\n")}`,
      schema: AiFigures,
      devMock: () => ({ exercises: [] }),
    });
    const fixed: Record<string, Motion> = {};
    for (const f of fix.exercises) {
      const m = fromAiMotion(f.motion);
      const nid = f.id.startsWith("ia-") ? f.id : `ia-${slug(f.id)}`;
      if (!checkMotion(m).length) fixed[nid] = m;
    }
    res = verifyAiProgram(out, req, id, fixed);
  }
  let program = res.program;
  const warnings = [...res.warnings];
  for (const b of res.badMotions) {
    const name = program.exercises[b.id]?.name ?? b.id;
    const pattern = out.newExercises.find((x) => `ia-${slug(x.id || x.name)}` === b.id)?.pattern;
    const r = replaceBad(program, b.id, req, pattern);
    program = r.program;
    warnings.push(`La figure de « ${name} » ne tenait pas debout : ${r.with ? `remplacé par « ${LIBRARY[r.with].name} »` : "retiré"}.`);
  }
  return { program, explanation: res.explanation, warnings };
}

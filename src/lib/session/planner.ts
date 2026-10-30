// Planificateur de session, déterministe (docs/vision.md §4.4). Pas d'IA ici.
//
// Entrée : les recettes choisies (étapes typées, durées, temps actif, récipient, niveau
// d'induction, four, bols) et les ressources de la cuisine (foyers, four, récipients et
// leurs foyers compatibles, table equipment_fit, ustensiles).
// Sortie : une phase prep (bols re-lettrés sur toute la session, gestes regroupés), puis
// un fil de cuisson ordonné où chaque étape a son heure de début, son foyer et son
// niveau, ou le four et sa température.
//
// Trois modes (étape 7) :
// - « seul » : la prep d'abord, puis la cuisson ; une personne, les temps actifs ne se
//   chevauchent pas. Les heures du fil partent du début de la cuisson.
// - « prep la veille » : le même plan, avec pour chaque geste et chaque bol s'il se fait
//   la veille (au frigo) ou le jour même (src/lib/session/gestures.ts, prepAhead).
// - « à deux » : personnes A et B, démarrage ensemble. Les gestes de prep deviennent des
//   tâches du fil (un grand couteau et une planche chacun), placées avec la cuisson ; une
//   étape attend les gestes qui remplissent ses bols. Les heures partent du début de la
//   session. Passages de relais quand un récipient change de mains.
//
// Contraintes : 3 foyers, un récipient par foyer ; un four, une seule température à la
// fois (plusieurs niveaux) ; chaque récipient sert une recette à la fois ; la poêle
// prend 500 g par fournée ; un braisage qui continue (même récipient) garde son foyer ou
// le four chaud, sans nouveau préchauffage. Option « braiser sur la plaque » : quand deux
// recettes veulent le four à deux températures, un braisage au four peut rester sur le
// foyer (cocotte, couvercle, niveau 2-3) si ça raccourcit la session ; le plan le dit.
// validatePlan() vérifie un plan (le nôtre ou un plan proposé ailleurs) et renvoie des
// erreurs explicites.
import { activeOf } from "./estimate";
import { gestureMinutes, isMeat, otherAhead, parseGesture, prepAhead, WEIGH_MIN } from "./gestures";
import { BOWL_COLORS, recipeColor } from "@/lib/ui";
import { STEP_LABELS } from "@/lib/recipes/format";

export type StepKind = "prep" | "sear" | "braise" | "boil" | "bake" | "rest" | "cool";
export type SessionMode = "solo" | "duo" | "veille";
export type Person = "A" | "B";
export const MODE_LABELS: Record<SessionMode, string> = { solo: "Seul", duo: "À deux", veille: "Prep la veille" };
export const modeOf = (plan: { mode?: SessionMode | null }): SessionMode => plan.mode ?? "solo";

/** Ce qui a été réellement commandé pour un ingrédient (fourni par les courses validées). */
export interface OrderedIngredient {
  recipeIngredientId: string;
  productName: string;
  brand: string | null;
  packLabel: string | null; // « 500 g »
  packs: number;
  gramsBought: number | null;
  gramsNeeded: number | null;
}
/** Fournisseur optionnel : pour une liste de courses, les ingrédients commandés. */
export type OrderedIngredientsProvider = (listId: string) => OrderedIngredient[];

export interface PlannerIngredient {
  id?: string;
  item: string;
  grams?: number | null;
  units?: number | null;
  group?: string | null;
  optional?: boolean;
  pantry?: boolean;
  foodId?: string | null;
}

/** À incrémenter quand un changement du planificateur doit refaire le plan des sessions ouvertes (réimport des fiches au démarrage). */
export const PLAN_VERSION = 4;

export interface PlannerStep {
  kind: StepKind;
  text: string;
  durationMin?: number | null;
  activeMin?: number | null;
  equipmentId?: string | null;
  hobId?: string | null; // imposé (sinon choisi par le planificateur)
  hobLevel?: number | null;
  ovenTemp?: number | null;
  bowls?: string[];
  cue?: string | null;
  phases?: StepPhase[] | null;
  /** Récipients de rechange (« faitout ») : le planificateur peut y faire toutes les étapes de ce récipient si c'est plus court. */
  equipmentAlt?: string[] | null;
}

/** Sous-étape chronométrée d'une étape (sa propre minuterie, la suivante démarre quand elle sonne). */
export interface StepPhase {
  text: string;
  min: number;
  hobLevel?: number | null;
  /** Fournée (l'étape se répète faute de place). */
  batch?: number | null;
  /** Attente sans geste : l'écran passe à autre chose, la fin sonne. */
  wait?: boolean | null;
}

export interface PlannerRecipe {
  slug: string;
  name: string;
  ingredients: PlannerIngredient[];
  steps: PlannerStep[];
  /** Facteur appliqué aux quantités (1 = la fiche). Les durées ne changent pas. */
  scale?: number;
}

export interface PlannerEquipment {
  id: string;
  kind: string;
  name: string;
  maxBatchG?: number | null;
  dimsJson?: Record<string, number | string> | null;
  count?: number | null;
}
export interface PlannerResources {
  equipment: PlannerEquipment[];
  fits: { equipmentId: string; hobId: string; preferred?: boolean | null }[];
}

export interface PlanOptions {
  ordered?: OrderedIngredient[];
  mode?: SessionMode;
  /** Braiser sur la plaque quand le four est demandé à deux températures : "auto" (si plus court, par défaut), ou jamais. */
  braiseOnHob?: "auto" | false;
  /**
   * Prep la veille, reprise à deux le jour J : ce que la veille a laissé (journal). Le plan
   * ne garde que le reste de la prep et la cuisson ; les bols prêts restent « au frigo ».
   */
  eve?: EveDone;
  /** Durées réelles des sessions terminées (src/lib/session/durations.ts) : facteur par geste et par étape. */
  durations?: DurationInput;
  /** Seul : glisser des gestes de prep dans les temps morts de la cuisson (par défaut). false = toute la prep avant. */
  interleave?: boolean;
}

export interface EveDone {
  doneTasks: string[]; // gestes cochés la veille (ids de tâche)
  readyBowls: string[]; // bols cochés (lettres de session)
}
export interface DurationFactor {
  factor: number; // réel / référence, déjà amorti et plafonné
  n: number; // mesures retenues
  sessions: string[]; // sessions d'où viennent les mesures
  label?: string;
}
export interface DurationInput {
  factors: Record<string, DurationFactor>;
  /** Sessions terminées regardées (fenêtre), même si aucune ne touche ce plan. */
  sessions: number;
}
/** Clés des durées apprises : un geste par aliment, la pesée, une étape de recette. */
export const gestureKey = (taskId: string) => (taskId.startsWith("cut-") ? `cut:${taskId.slice(4).replace(/-veille$/, "")}` : taskId.startsWith("other-") ? `other:${taskId.slice(6)}` : taskId.startsWith("weigh-") ? "weigh" : taskId);
export const stepKey = (slug: string, order: number) => `step:${slug}#${order}`;

// ─── Sortie ───

export interface PlanBowlItem {
  item: string;
  qty: string | null;
  optional: boolean;
  ordered: string | null; // « 4 × Sauté de porc LR Auchan 500 g »
  food?: string | null; // aliment de la table nutritionnelle : choisit son dessin (src/lib/illus/)
  eve?: boolean; // prep la veille : se prépare la veille
}
export interface PlanBowl {
  letter: string;
  original: string;
  recipeSlug: string;
  color: string;
  items: PlanBowlItem[];
  usedBy: { stepId: string; no: number } | null;
  /** Prep la veille : le bol se fait la veille et passe la nuit au frigo. */
  fridge?: boolean;
  /** À deux : les tâches de prep qui le remplissent. */
  tasks?: string[];
  /** Seul : gestes qui le finissent pendant la cuisson (étapes « geste »). */
  during?: { stepId: string; no: number }[];
}
export interface PrepItem {
  recipeSlug: string;
  item: string;
  gesture: string;
  qty: string | null;
  bowl: string | null; // lettre de session, null = sur le plateau (viande pour la saisie)
  eve?: boolean;
  eveReason?: string;
  grams?: number | null; // quantités en nombres (durées réelles au kilo ou à la pièce)
  units?: number | null;
  food?: string | null; // aliment de la table nutritionnelle : choisit son dessin
}
export interface PrepTask {
  id: string;
  title: string; // « Oignons »
  total: string | null; // « 4 · 600 g »
  minutes: number;
  items: PrepItem[];
  kind: "cut" | "other" | "weigh";
  text?: string; // pour les gestes « autres » (tamponner la viande…) et les pesées
  recipeSlug?: string;
  /** Prep la veille : le geste se fait la veille. */
  eve?: boolean;
  eveReason?: string;
  /** À deux : qui, quand (minutes depuis le début de la session), avec quoi. */
  person?: Person;
  startMin?: number;
  endMin?: number;
  tools?: string[];
  bowls?: string[];
  notes?: string[];
  /** Quantités du geste, en nombres (absentes dans les plans d'avant le 20/10). */
  grams?: number | null;
  units?: number | null;
  /** Temps de référence quand `minutes` a été corrigé par les durées réelles. */
  refMinutes?: number;
}
export interface PlanStep {
  id: string; // `${slug}#${ordre}` ou `four#n`
  no: number;
  recipeSlug: string | null; // null : action commune (préchauffer le four)
  order: number;
  kind: StepKind | "preheat";
  text: string;
  cue: string | null;
  durationMin: number;
  activeMin: number;
  startMin: number; // seul : depuis le début de la cuisson ; à deux : depuis le début de la session
  endMin: number;
  equipmentId: string | null;
  equipmentName: string | null;
  hobId: string | null;
  hobLevel: number | null;
  hobLevelLabel?: string | null; // « 8 puis 2-3 » (braisage sur la plaque)
  hobUntilMin: number | null;
  oven: { temp: number; levels: number[]; fromMin: number; untilMin: number; preheatFromMin: number } | null;
  bowls: string[];
  /** Sous-étapes chronométrées de la partie active (absentes : un seul geste). */
  phases?: StepPhase[];
  batches: number | null; // fournées à la poêle
  notes: string[];
  person?: Person | null; // à deux
  /** Durée de la fiche quand `durationMin` a été corrigée par les durées réelles. */
  refDurationMin?: number;
  /** Seul : gestes de prep glissés dans la cuisson (« pendant que ça cuit »), une sous-étape chacun ; id `geste:<première tâche>`. */
  tasks?: PrepTask[];
}
export interface Handoff {
  atMin: number;
  from: Person;
  to: Person;
  equipmentId: string;
  fromStepId: string;
  toStepId: string;
  text: string; // « B libère le faitout pour A »
}
export interface PlanIssue {
  kind: "oven_temp" | "hob_fit" | "hob_shared" | "vessel_shared" | "unknown_equipment" | "unschedulable" | "person_busy" | "tool_shared";
  message: string;
  stepIds: string[];
}
export interface Shortage {
  recipeSlug: string;
  recipeIngredientId: string;
  item: string;
  gramsNeeded: number;
  gramsBought: number;
  ratio: number;
}
export interface SessionPlan {
  version: 1;
  /** Absent dans les plans d'avant l'étape 7 : « seul ». */
  mode?: SessionMode;
  persons?: Person[];
  recipes: { slug: string; name: string; color: string; scale: number }[];
  hobs: { id: string; name: string; diameterCm: number | null }[];
  bowls: PlanBowl[];
  prep: {
    tasks: PrepTask[];
    minutes: number; // seul : la prep avant la cuisson ; veille : la prep du jour même ; à deux : minutes de gestes cumulées
    notes: string[];
    sources: { recipeSlug: string; texts: string[] }[];
    eveMin?: number; // veille : la prep de la veille
  };
  steps: PlanStep[];
  cookingMin: number;
  activeMin: number;
  totalMin: number;
  errors: PlanIssue[];
  warnings: string[];
  /** Choix du planificateur à dire (braisage sur la plaque…). */
  decisions?: string[];
  handoffs?: Handoff[];
  shortages: Shortage[];
  /** Facteur proposé par recette quand il manque un ingrédient commandé (au prorata). */
  scaleSuggestions: { recipeSlug: string; factor: number }[];
  /**
   * Prep la veille reprise à deux : la soirée (gestes faits, bols au frigo). Le plan est
   * alors en mode « à deux » et ne contient que le jour J.
   */
  eve?: { minutes: number; tasks: PrepTask[]; bowls: string[]; doneTasks: string[] };
  /** Origine des durées : corrections tirées des sessions terminées. */
  durations?: PlanDurations;
  /** Grammes ajoutés à des ingrédients (recipe_ingredient_id → g), pour refaire le plan à l'identique. */
  extras?: Record<string, number>;
}

export interface DurationApplied {
  key: string;
  label: string;
  kind: "gesture" | "weigh" | "step";
  refMin: number;
  min: number;
  factor: number;
  n: number;
}
export interface PlanDurations {
  /** Sessions terminées regardées, et celles dont viennent les corrections de ce plan. */
  window: number;
  sessions: number;
  applied: DurationApplied[];
}

// ─── Réglages ───
export const PREHEAT_MIN = 10;
export const WASH_MIN = 3;
const EPS = 1e-6;
const HOB_BRAISE_LEVEL = "2-3";

const SHORT_NAMES: Record<string, string> = {
  "poele-28": "Poêle",
  cocotte: "Cocotte",
  faitout: "Faitout",
  "casserole-14": "Petite casserole",
  "casserole-16": "Casserole moyenne",
  "casserole-18": "Grande casserole",
  "plat-grand": "Grand plat",
  "plat-moyen": "Plat moyen",
  "plat-four": "Plat à four",
  oven: "Four",
  "air-fryer": "Air fryer",
};

/**
 * Appareils qui cuisent comme un récipient (une recette à la fois, leur propre température, ni foyer
 * ni four). L'air fryer est un petit four ventilé : environ 20 °C et 20 % de temps de moins qu'au four.
 */
export const COOK_APPLIANCES = new Set(["air-fryer"]);
export const AIR_FRYER = { tempDelta: -20, timeFactor: 0.8, minTemp: 140, maxTemp: 220 };
const isVessel = (e: { id: string; kind: string } | undefined) => Boolean(e && (["pan", "pot", "dish"].includes(e.kind) || (e.kind === "appliance" && COOK_APPLIANCES.has(e.id))));
export const shortName = (id: string | null, fallback?: string | null) => (id ? (SHORT_NAMES[id] ?? fallback ?? id) : null);

export function formatQty(grams: number | null | undefined, units: number | null | undefined): string | null {
  const g = grams == null ? null : grams >= 1000 ? `${(Math.round(grams / 10) / 100).toLocaleString("fr-FR")} kg` : `${Math.round(grams)} g`;
  const u = units == null ? null : (Math.round(units * 10) / 10).toLocaleString("fr-FR");
  if (g && u) return `${u} · ${g}`;
  return g ?? u;
}

export function sessionLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

/** « (bol B) » → « (bol H) » selon la correspondance de la recette. */
export function relabelBowls(text: string, map: Map<string, string>): string {
  return text.replace(/\b([Bb]ols?) ([A-Z])\b/g, (m, word: string, l: string) => (map.has(l) ? `${word} ${map.get(l)}` : m));
}

const fmtMin = (min: number) => {
  const r = Math.round(min);
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};

interface Work {
  id: string;
  r: number;
  order: number;
  src: PlannerStep | null; // null : tâche de prep (à deux)
  prep?: PrepTask;
  dur: number;
  act: number;
  vessel: string | null;
  hobCandidates: string[];
  needsHob: boolean;
  hobDur: number;
  usesOven: boolean;
  ovenTemp: number | null;
  ovenLevels: number[];
  deps: { w: Work; type: "end" | "active" }[];
  tail: number;
  prio: number;
  side: boolean; // « pendant le braisage » : à côté du fil principal de la recette
  cont?: { w: Work; type: "hob" | "oven" }; // l'étape suivante continue dans le même récipient, sur place
  contOf?: { w: Work; type: "hob" | "oven" };
  hobBraise?: boolean;
  needsTools?: boolean;
  meat?: boolean;
  start?: number;
  hobId?: string | null;
  oven?: PlanStep["oven"];
  notes: string[];
  person?: Person;
  tools?: string[];
  refDur?: number;
}

/** Un essai du planificateur : choix du foyer, priorités légèrement perturbées (graine fixe, donc reproductible). */
interface Try {
  smartHob?: boolean;
  seed?: number;
}
/** Essais par plan : le premier est le plan de base, les autres cherchent plus court. */
const TRIES: Try[] = [{}, { smartHob: true }, ...Array.from({ length: 10 }, (_, i) => ({ smartHob: i % 2 === 1, seed: i + 1 }))];

/** Récipient de rechange : la recette passe toutes ses étapes de `from` dans `to`. */
interface Swap {
  r: number;
  from: string;
  to: string;
}

/** Les rechanges possibles d'une recette : chaque récipient dont toutes les étapes acceptent le même autre. */
function swapsOf(r: PlannerRecipe, ri: number, res: PlannerResources): Swap[] {
  const out: Swap[] = [];
  const known = new Set(res.equipment.map((e) => e.id));
  for (const from of new Set(r.steps.map((s) => s.equipmentId).filter((x): x is string => Boolean(x)))) {
    const mine = r.steps.filter((s) => s.equipmentId === from);
    const common = (mine[0].equipmentAlt ?? []).filter((to) => to !== from && known.has(to) && mine.every((s) => s.equipmentAlt?.includes(to)));
    for (const to of common) {
      // Un appareil (air fryer) ne prend que ce qui tient dans son panier, en une fournée.
      const max = COOK_APPLIANCES.has(to) ? res.equipment.find((e) => e.id === to)?.maxBatchG : null;
      if (max && mine.some((s) => gramsOf(r, s.bowls) > max)) continue;
      out.push({ r: ri, from, to });
    }
  }
  return out;
}

/** Grammes que cuit une étape : ses bols, sinon tout ce qui n'est ni en bol ni au placard. */
function gramsOf(r: PlannerRecipe, bowls: string[] | undefined): number {
  const ofBowls = r.ingredients.filter((i) => i.group && (bowls ?? []).includes(i.group));
  const pool = ofBowls.length ? ofBowls : r.ingredients.filter((i) => !i.group && !i.pantry);
  return pool.reduce((s, i) => s + (i.grams ?? 0), 0) * (r.scale ?? 1);
}

/**
 * Une étape passée du four (plat ou four) à l'air fryer, ou l'inverse : température et durée
 * converties, et les « 200 °C », « 25 min » du texte avec. Les autres rechanges ne changent rien.
 */
export function convertForSwap(s: PlannerStep, from: string, to: string): PlannerStep {
  const toFryer = COOK_APPLIANCES.has(to) && !COOK_APPLIANCES.has(from);
  const fromFryer = COOK_APPLIANCES.has(from) && !COOK_APPLIANCES.has(to);
  if ((!toFryer && !fromFryer) || s.ovenTemp == null) return s;
  const round5 = (n: number) => Math.round(n / 5) * 5;
  const temp = toFryer ? Math.max(AIR_FRYER.minTemp, Math.min(AIR_FRYER.maxTemp, round5(s.ovenTemp + AIR_FRYER.tempDelta))) : round5(s.ovenTemp - AIR_FRYER.tempDelta);
  const f = toFryer ? AIR_FRYER.timeFactor : 1 / AIR_FRYER.timeFactor;
  const min = (n: number) => Math.max(1, Math.round(n * f));
  const text = s.text
    .replace(new RegExp(`(?<!\\d)${s.ovenTemp}(\\s?°C)`, "g"), `${temp}$1`)
    .replace(/(?<![\d,])(\d+)(?: (à) (\d+))? min\b/g, (_m, a: string, w?: string, b?: string) => (b ? `${min(Number(a))} ${w} ${min(Number(b))} min` : `${min(Number(a))} min`));
  return {
    ...s,
    text,
    ovenTemp: temp,
    durationMin: s.durationMin != null ? min(s.durationMin) : s.durationMin,
    activeMin: s.activeMin != null ? Math.min(s.activeMin, min(s.durationMin ?? s.activeMin)) : s.activeMin,
  };
}

/** « la cocotte » → « le faitout » dans le texte d'une étape. */
export function swapVesselText(text: string, from: string, to: string): string {
  const f = shortName(from)!;
  const t = shortName(to)!;
  const art = (n: string) => article(n).toLowerCase();
  const masc = art(t).startsWith("le ");
  const fl = f.toLowerCase();
  const tl = t.toLowerCase();
  let out = text;
  const fMasc = art(f).startsWith("le ");
  const pairs: [string, string][] = [
    [fMasc ? `du ${fl}` : `de ${art(f)}`, masc ? `du ${tl}` : `de ${art(t)}`],
    [fMasc ? `au ${fl}` : `à ${art(f)}`, masc ? `au ${tl}` : `à ${art(t)}`],
    [art(f), art(t)],
  ];
  // « Enfourne le plat » ne se dit pas d'un air fryer.
  if (COOK_APPLIANCES.has(to)) pairs.unshift([`enfourne ${art(f)}`, `mets le tout dans ${art(t)}`]);
  for (const [a, b] of pairs) {
    out = out.replace(new RegExp(`(?<!\\p{L})${a}(?!\\p{L})`, "gu"), b);
    out = out.replace(new RegExp(`(?<!\\p{L})${a[0].toUpperCase()}${a.slice(1)}(?!\\p{L})`, "gu"), b[0].toUpperCase() + b.slice(1));
  }
  out = out.replace(new RegExp(`(?<!\\p{L})${fl}(?!\\p{L})`, "giu"), (m) => (m[0] === m[0].toUpperCase() ? t : tl));
  // « Faitout préchauffée » : l'accord suit le nouveau récipient.
  if (masc && !art(f).startsWith("le ")) out = out.replace(new RegExp(`(?<!\\p{L})(${t}|${tl}) (\\p{L}+é)e(s?)(?!\\p{L})`, "gu"), "$1 $2$3");
  return out;
}

function applySwaps(input: PlannerRecipe[], swaps: Swap[]): PlannerRecipe[] {
  return input.map((r, ri) => {
    const mine = swaps.filter((x) => x.r === ri);
    if (!mine.length) return r;
    return {
      ...r,
      steps: r.steps.map((s) => {
        const sw = mine.find((x) => x.from === s.equipmentId);
        if (!sw) return s;
        const c = convertForSwap(s, sw.from, sw.to);
        return { ...c, equipmentId: sw.to, text: swapVesselText(c.text, sw.from, sw.to), equipmentAlt: null };
      }),
    };
  });
}

/**
 * Planifie une session. Le plan de base (tel quel) est un essai parmi d'autres : récipients de
 * rechange des fiches, braisage sur la plaque quand le four est demandé à deux températures (« auto »),
 * choix des foyers et priorités. Le plus court sans erreur gagne ; à égalité, le premier.
 */
export function planSession(input: PlannerRecipe[], res: PlannerResources, opts: PlanOptions = {}): SessionPlan {
  // Combinaisons de rechanges : aucune, puis chaque rechange seule, puis par paires (4 recettes au plus).
  const all = input.flatMap((r, ri) => swapsOf(r, ri, res));
  const swapSets: Swap[][] = [[], ...all.map((x) => [x])];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].r !== all[j].r) swapSets.push([all[i], all[j]]);
  const hobFits = new Set(res.fits.filter((f) => res.equipment.some((e) => e.id === f.hobId && e.kind === "hob")).map((f) => f.equipmentId));

  let base: SessionPlan | null = null;
  let best: { plan: SessionPlan; swaps: Swap[]; braise: number | null } | null = null;
  const better = (p: SessionPlan) => !best || (p.errors.length === 0 && (best.plan.errors.length > 0 || p.totalMin < best.plan.totalMin - 0.5));
  // Moins d'essais quand la session est grosse (la page Composer calcule trois plans).
  const tries = input.length <= 2 ? TRIES : TRIES.slice(0, input.length === 3 ? 6 : 3);
  for (const swaps of swapSets) {
    const rs = applySwaps(input, swaps);
    const braises: (number | null)[] = [null];
    if (opts.braiseOnHob !== false) {
      const temps = new Map<number, number[]>();
      rs.forEach((r, ri) => {
        for (const s of r.steps) if (s.kind !== "prep" && s.ovenTemp != null && !COOK_APPLIANCES.has(s.equipmentId ?? "")) temps.set(s.ovenTemp, [...new Set([...(temps.get(s.ovenTemp) ?? []), ri])]);
      });
      if (temps.size >= 2 && new Set([...temps.values()].flat()).size >= 2)
        rs.forEach((r, ri) => {
          if (r.steps.some((s) => s.kind === "braise" && s.ovenTemp != null && s.equipmentId && hobFits.has(s.equipmentId))) braises.push(ri);
        });
    }
    // Seul : avec et sans gestes glissés dans la cuisson (glisser ne doit jamais rallonger).
    const variants: PlanOptions[] = (opts.mode ?? "solo") === "solo" && !opts.eve && opts.interleave !== false ? [{ ...opts, interleave: false }, opts] : [opts];
    for (const braise of braises)
      for (const o of variants)
        for (const t of tries) {
          const p = planOnce(rs, res, o, new Set(braise == null ? [] : [rs[braise].slug]), t);
          base ??= p;
          if (better(p)) best = { plan: p, swaps, braise };
        }
  }
  const { plan, swaps, braise } = best!;
  const decisions: string[] = [];
  for (const sw of swaps) {
    const others = input.filter((_, i) => i !== sw.r && input[i].steps.some((s) => s.equipmentId === sw.from)).map((r) => r.name);
    decisions.push(`${input[sw.r].name} se fait dans ${article(shortName(sw.to)!).toLowerCase()} au lieu de ${article(shortName(sw.from)!).toLowerCase()}${others.length ? ` (${article(shortName(sw.from)!).toLowerCase()} sert à : ${others.join(", ")})` : ""}.`);
  }
  if (braise != null) {
    const r = input[braise];
    const temps = new Map<number, string[]>();
    input.forEach((x, xi) => {
      if (xi === braise) return;
      for (const s of x.steps) if (s.kind !== "prep" && s.ovenTemp != null && !COOK_APPLIANCES.has(s.equipmentId ?? "")) temps.set(s.ovenTemp, [...new Set([...(temps.get(s.ovenTemp) ?? []), x.name])]);
    });
    const others = [...temps.entries()].map(([t, names]) => `${names.join(", ")} à ${t} °C`);
    decisions.push(`${r.name} braise sur la plaque : cocotte couverte sur le grand foyer, niveau ${HOB_BRAISE_LEVEL}, au lieu du four. Le four reste libre pour ${others.join(" et ")}.`);
  }
  if (base && plan !== base && plan.errors.length === 0 && plan.totalMin < base.totalMin - 0.5) {
    if (!decisions.length) decisions.push(plan.steps.some((s) => s.tasks) ? "Une partie de la prep se fait pendant la cuisson, quand tu attends." : "Ordre des étapes et choix des foyers ajustés pour gagner du temps.");
    decisions[decisions.length - 1] += ` La session passe de ${fmtMin(base.totalMin)} à ${fmtMin(plan.totalMin)}.`;
  }
  if (decisions.length) plan.decisions = [...decisions, ...(plan.decisions ?? [])];
  return plan;
}

/** Seul : un moment de gestes glissés dans la cuisson plus court que ça repasse avant la cuisson (pas d'étape pour 2 min). */
const MIN_BLOCK = 5;

/** Un plan ; seul, les gestes glissés par moments trop courts sont remis avant la cuisson, puis on refait le fil. */
function planOnce(input: PlannerRecipe[], res: PlannerResources, opts: PlanOptions, hobBraise: Set<string>, tr: Try = {}): SessionPlan {
  let before = new Set<string>();
  for (let i = 0; ; i++) {
    const { plan, small } = planCore(input, res, opts, hobBraise, tr, before);
    if (!small.length || i >= 5) return plan;
    before = new Set([...before, ...small]);
  }
}

function planCore(input: PlannerRecipe[], res: PlannerResources, opts: PlanOptions, hobBraise: Set<string>, tr: Try, before: Set<string>): { plan: SessionPlan; small: string[] } {
  const mode: SessionMode = opts.mode ?? "solo";
  const duo = mode === "duo";
  // Seul, gestes glissés dans la cuisson : le même fil qu'à deux, avec une personne.
  const interleave = mode === "solo" && !opts.eve && opts.interleave !== false;
  const thread = duo || interleave;
  const persons: Person[] = duo ? ["A", "B"] : ["A"];
  const eq = new Map(res.equipment.map((e) => [e.id, e]));
  const hobs = res.equipment.filter((e) => e.kind === "hob");
  const diam = (e: PlannerEquipment | undefined) => {
    const d = e?.dimsJson ?? {};
    const v = d.diameterCm ?? d.baseCm ?? d.lengthCm;
    return typeof v === "number" ? v : null;
  };
  const hobsBySize = [...hobs].sort((a, b) => (diam(b) ?? 0) - (diam(a) ?? 0));
  const hint = (text: string): string | null => {
    const t = text.toLowerCase();
    const hits: [number, string | undefined][] = [
      [t.indexOf("grand foyer"), hobsBySize[0]?.id],
      [t.indexOf("foyer moyen"), hobsBySize[1]?.id],
      [t.indexOf("petit foyer"), hobsBySize[hobsBySize.length - 1]?.id],
    ];
    const first = hits.filter(([i, id]) => i >= 0 && id).sort((a, b) => a[0] - b[0])[0];
    return first?.[1] ?? null;
  };
  const errors: PlanIssue[] = [];
  const warnings: string[] = [];
  // Les règles de la veille servent aussi au jour J d'une prep la veille reprise à deux.
  const eveRules = mode === "veille" || Boolean(opts.eve);

  // Durées réelles : facteur par clé, et trace de ce qui a été corrigé.
  const applied = new Map<string, DurationApplied & { sessions: string[] }>();
  const factorOf = (key: string, kind: DurationApplied["kind"], label: string) => {
    const f = opts.durations?.factors[key];
    if (!f || Math.abs(f.factor - 1) < 0.005) return null;
    return {
      f: f.factor,
      note: (refMin: number, min: number) => {
        const a = applied.get(key) ?? { key, label, kind, refMin: 0, min: 0, factor: f.factor, n: f.n, sessions: f.sessions };
        a.refMin += refMin;
        a.min += min;
        applied.set(key, a);
      },
    };
  };
  const weighF = factorOf("weigh", "weigh", "Pesées (par ingrédient)");
  const weighOne = WEIGH_MIN * (weighF?.f ?? 1);

  // Couleurs : une par recette, distinctes.
  const used = new Set<string>();
  const recipes = input.map((r) => {
    let color = recipeColor(r.slug);
    if (used.has(color)) color = BOWL_COLORS.find((c) => !used.has(c)) ?? color;
    used.add(color);
    return { slug: r.slug, name: r.name, color, scale: r.scale ?? 1 };
  });

  // Commandes : par id d'ingrédient.
  const ordered = new Map((opts.ordered ?? []).map((o) => [o.recipeIngredientId, o]));
  const orderedLabel = (o: OrderedIngredient) => `${o.packs} × ${o.productName}${o.brand ? ` ${o.brand}` : ""}${o.packLabel ? ` ${o.packLabel}` : ""}`;

  // ─── Bols : re-lettrés recette par recette ───
  const letterMaps: Map<string, string>[] = [];
  const bowls: PlanBowl[] = [];
  let next = 0;
  input.forEach((r, ri) => {
    const map = new Map<string, string>();
    const scale = r.scale ?? 1;
    const groups = [...new Set(r.ingredients.map((i) => i.group).filter((g): g is string => Boolean(g)))].sort();
    for (const g of groups) {
      const letter = sessionLetter(next++);
      map.set(g, letter);
      bowls.push({
        letter,
        original: g,
        recipeSlug: r.slug,
        color: recipes[ri].color,
        items: r.ingredients
          .filter((i) => i.group === g)
          .map((i) => {
            const o = i.id ? ordered.get(i.id) : undefined;
            const item: PlanBowlItem = {
              item: i.item,
              qty: formatQty(i.grams != null ? i.grams * scale : null, i.units != null ? i.units * scale : null),
              optional: Boolean(i.optional),
              ordered: o ? orderedLabel(o) : null,
              food: i.foodId ?? null,
            };
            if (eveRules) item.eve = prepAhead(i, parseGesture(i.item).gesture).eve;
            return item;
          }),
        usedBy: null,
      });
    }
    letterMaps.push(map);
  });
  if (eveRules) for (const b of bowls) b.fridge = b.items.every((i) => i.eve);

  // ─── Prep : gestes regroupés par ingrédient ───
  const cuts = new Map<string, PrepTask>();
  const acc = new Map<string, { grams: number; units: number; noUnits: number }>();
  const weighMin = { v: 0, eve: 0 };
  const weighItems = new Map<string, string[]>(); // bol → ingrédients à peser
  input.forEach((r, ri) => {
    const scale = r.scale ?? 1;
    for (const ing of r.ingredients) {
      const { base, gesture } = parseGesture(ing.item);
      const grams = ing.grams != null ? ing.grams * scale : null;
      const units = ing.units != null ? ing.units * scale : null;
      const bowl = ing.group ? (letterMaps[ri].get(ing.group) ?? null) : null;
      const ahead = prepAhead(ing, gesture);
      if (!gesture) {
        if (bowl) {
          weighMin.v += weighOne;
          if (ahead.eve) weighMin.eve += weighOne;
          weighF?.note(WEIGH_MIN, weighOne);
          weighItems.set(bowl, [...(weighItems.get(bowl) ?? []), base]);
        }
        continue;
      }
      const key = ing.foodId && ing.foodId !== "zero" ? ing.foodId : base.toLowerCase();
      const task =
        cuts.get(key) ??
        ({ id: `cut-${key}`, title: base, total: null, minutes: 1, items: [], kind: "cut" } satisfies PrepTask);
      const item: PrepItem = { recipeSlug: r.slug, item: base, gesture, qty: formatQty(grams, units), bowl, grams, units, food: ing.foodId ?? null };
      if (eveRules) {
        item.eve = ahead.eve;
        item.eveReason = ahead.reason;
      }
      task.items.push(item);
      task.minutes += gestureMinutes(ing.foodId ?? null, grams, units);
      const a = acc.get(key) ?? { grams: 0, units: 0, noUnits: 0 };
      a.grams += grams ?? 0;
      a.units += units ?? 0;
      a.noUnits += units == null ? 1 : 0;
      acc.set(key, a);
      cuts.set(key, task);
    }
  });
  const half = (x: number) => Math.round(x * 2) / 2;
  let cutTasks = [...cuts.entries()]
    .map(([key, t]) => {
      const a = acc.get(key)!;
      t.total = formatQty(a.grams || null, a.noUnits === 0 ? a.units : null);
      t.grams = a.grams || null;
      t.units = a.noUnits === 0 ? a.units : null;
      const ref = half(t.minutes);
      const label = `${t.title} (${[...new Set(t.items.map((i) => i.gesture))].join(", ")})`;
      const f = factorOf(gestureKey(t.id), "gesture", label);
      t.minutes = f ? Math.max(0.5, half(ref * f.f)) : ref;
      if (f) {
        t.refMinutes = ref;
        f.note(ref, t.minutes);
      }
      return { key, t };
    })
    // Légumes d'abord, viande en dernier.
    .sort((a, b) => Number(isMeat(a.key, a.t.title)) - Number(isMeat(b.key, b.t.title)))
    .map(({ t }) => t);

  if (eveRules) {
    // Un geste mêlé (veille et jour même) se coupe en deux tâches.
    cutTasks = cutTasks.flatMap((t) => {
      const eve = t.items.filter((i) => i.eve);
      const day = t.items.filter((i) => !i.eve);
      if (!eve.length || !day.length) {
        const all = eve.length > 0;
        return [{ ...t, eve: all, eveReason: (all ? eve : day)[0]?.eveReason }];
      }
      const share = (m: number, items: PrepItem[]) => Math.round(((m * items.length) / t.items.length) * 2) / 2;
      const part = (items: PrepItem[], eveSide: boolean): PrepTask => {
        const p: PrepTask = { ...t, items, minutes: share(t.minutes, items), total: null, eve: eveSide, eveReason: items[0].eveReason };
        if (eveSide) p.id = `${t.id}-veille`;
        const g = items.reduce((x, i) => x + (i.grams ?? 0), 0);
        p.grams = g || null;
        p.units = items.every((i) => i.units != null) ? items.reduce((x, i) => x + (i.units ?? 0), 0) : null;
        if (t.refMinutes != null) p.refMinutes = share(t.refMinutes, items);
        return p;
      };
      return [part(eve, true), part(day, false)];
    });
  }

  const otherTasks: PrepTask[] = [];
  const sources: { recipeSlug: string; texts: string[] }[] = [];
  let authoredPrep = 0;
  input.forEach((r, ri) => {
    const texts: string[] = [];
    r.steps.forEach((s, si) => {
      if (s.kind !== "prep") return;
      authoredPrep += activeOf(stepLike(s));
      texts.push(relabelBowls(s.text, letterMaps[ri]));
      if (!s.bowls?.length) {
        const id = `other-${r.slug}-${si + 1}`;
        const ref = half(activeOf(stepLike(s)));
        const f = factorOf(gestureKey(id), "gesture", `${recipes[ri].name} · ${s.text.split(/[.,:;]/)[0].slice(0, 60)}`);
        const t: PrepTask = {
          id,
          title: recipes[ri].name,
          total: null,
          minutes: f ? Math.max(0.5, half(ref * f.f)) : ref,
          items: [],
          kind: "other",
          text: s.text,
          recipeSlug: r.slug,
        };
        if (f) {
          t.refMinutes = ref;
          f.note(ref, t.minutes);
        }
        if (eveRules) {
          const a = otherAhead(s.text);
          t.eve = a.eve;
          t.eveReason = a.reason;
        }
        otherTasks.push(t);
      }
    });
    if (texts.length) sources.push({ recipeSlug: r.slug, texts });
  });

  // Prep la veille reprise à deux : la soirée est faite. Un bol coché reste au frigo ; un
  // bol « veille » pas coché se refait le jour J. Un geste de la veille compte comme fait
  // s'il est coché, si un de ses bols du frigo est coché, ou s'il n'en remplit aucun (la
  // soirée s'est finie par « C'est au frigo »). Les autres repassent dans le jour J.
  let eveTasks: PrepTask[] = [];
  let eveDoneMin = 0;
  if (opts.eve) {
    const ready = new Set(opts.eve.readyBowls);
    const doneIds = new Set(opts.eve.doneTasks);
    const wasFridge = new Set(bowls.filter((b) => b.fridge).map((b) => b.letter));
    for (const b of bowls) if (b.fridge && !ready.has(b.letter)) b.fridge = false;
    const doneEve = (t: PrepTask) => {
      if (!t.eve) return false;
      if (doneIds.has(t.id)) return true;
      const fl = [...new Set(t.items.map((i) => i.bowl).filter((l): l is string => Boolean(l && wasFridge.has(l))))];
      return fl.length === 0 || fl.some((l) => ready.has(l));
    };
    const redo = (t: PrepTask): PrepTask => (t.eve ? { ...t, eve: false, eveReason: "pas fait la veille : à faire le jour J" } : t);
    eveTasks = [...cutTasks, ...otherTasks].filter(doneEve);
    cutTasks = cutTasks.filter((t) => !doneEve(t)).map(redo);
    otherTasks.splice(0, otherTasks.length, ...otherTasks.filter((t) => !doneEve(t)).map(redo));
    const fridgeWeigh = bowls.filter((b) => b.fridge).reduce((x, b) => x + (weighItems.get(b.letter)?.length ?? 0), 0) * weighOne;
    eveDoneMin = Math.ceil(eveTasks.reduce((x, t) => x + t.minutes, 0) + fridgeWeigh);
  }

  // À deux : une pesée par bol (ce qui n'a pas de geste), pour la placer dans le fil.
  const weighTasks: PrepTask[] = thread
    ? bowls
        .filter((b) => weighItems.has(b.letter) && !(opts.eve && b.fridge))
        .map((b) => {
          const items = weighItems.get(b.letter)!;
          const t: PrepTask = {
            id: `weigh-${b.letter}`,
            title: `Bol ${b.letter}`,
            total: null,
            minutes: Math.max(1, half(items.length * weighOne)),
            items: [],
            kind: "weigh" as const,
            text: `Pèse et verse : ${items.join(", ")}.`,
            recipeSlug: b.recipeSlug,
            bowls: [b.letter],
            units: items.length,
          };
          if (weighF) t.refMinutes = Math.max(1, half(items.length * WEIGH_MIN));
          return t;
        })
    : [];

  const prepTasks = [...cutTasks, ...otherTasks, ...weighTasks];
  const gestureSum = [...cutTasks, ...otherTasks].reduce((s, t) => s + t.minutes, 0) + weighMin.v;
  // On garde le plus long des deux : la prep était sous-estimée jusqu'ici.
  let prepMin = Math.ceil(Math.max(gestureSum, authoredPrep));
  let eveMin: number | undefined;
  if (mode === "veille") {
    const eveSum = [...cutTasks, ...otherTasks].filter((t) => t.eve).reduce((s, t) => s + t.minutes, 0) + weighMin.eve;
    // Au prorata si la fiche annonçait plus que nos gestes.
    const k = gestureSum > 0 ? prepMin / gestureSum : 1;
    eveMin = Math.ceil(eveSum * k);
    prepMin = Math.max(0, prepMin - eveMin);
  }
  if (duo) prepMin = Math.ceil(prepTasks.reduce((s, t) => s + t.minutes, 0));
  const prepNotes: string[] = [];

  // ─── Étapes de cuisson ───
  const works: Work[] = [];
  const hobFitsOf = (vessel: string) => res.fits.filter((f) => f.equipmentId === vessel && hobs.some((h) => h.id === f.hobId));
  input.forEach((r, ri) => {
    const mine: Work[] = [];
    const braiseHere = hobBraise.has(r.slug);
    r.steps.forEach((s, si) => {
      if (s.kind === "prep") return;
      const id = `${r.slug}#${si + 1}`;
      // Durée de la fiche, corrigée par les durées réelles. Une étape tout en action garde
      // son temps actif égal à sa durée ; sinon, c'est l'attente qui s'allonge ou raccourcit.
      const refDur = Math.max(0, s.durationMin ?? 0);
      const refAct = Math.min(refDur, activeOf(stepLike(s)));
      const sf = refDur >= 2 ? factorOf(stepKey(r.slug, si + 1), "step", `${r.name} · étape ${si + 1} (${STEP_LABELS[s.kind].toLowerCase()})`) : null;
      const dur = sf ? Math.max(1, Math.round(refDur * sf.f)) : refDur;
      const act = refAct >= refDur - EPS ? dur : Math.min(dur, refAct);
      if (sf && dur !== refDur) sf.note(refDur, dur);
      const e = s.equipmentId ? eq.get(s.equipmentId) : undefined;
      if (s.equipmentId && !e) {
        errors.push({ kind: "unknown_equipment", message: `${r.name}, étape ${si + 1} : équipement inconnu « ${s.equipmentId} ».`, stepIds: [id] });
      }
      const vessel = e && isVessel(e) ? e.id : null;
      const vesselHobs = vessel ? hobFitsOf(vessel) : [];
      const vesselOven = vessel ? res.fits.some((f) => f.equipmentId === vessel && f.hobId === "oven") || e?.kind === "dish" : false;
      // Braiser sur la plaque : le braisage au four reste sur le foyer.
      const onHobBraise = braiseHere && s.kind === "braise" && s.ovenTemp != null && vesselHobs.length > 0;
      const usesOven = !onHobBraise && s.ovenTemp != null && (s.equipmentId === "oven" || vesselOven);
      let needsHob = Boolean(vessel && vesselHobs.length && (s.hobLevel != null || !usesOven));
      if (vessel && s.hobLevel != null && !vesselHobs.length && !s.hobId) {
        errors.push({
          kind: "hob_fit",
          message: `${r.name}, étape ${si + 1} : ${shortName(vessel, e?.name)} ne va sur aucun foyer.`,
          stepIds: [id],
        });
      }
      let candidates: string[] = [];
      if (s.hobId) {
        candidates = [s.hobId];
        needsHob = true;
      } else if (needsHob) {
        const vd = diam(e);
        candidates = [...vesselHobs]
          .sort((a, b) => {
            if (Boolean(b.preferred ?? true) !== Boolean(a.preferred ?? true)) return Number(b.preferred ?? true) - Number(a.preferred ?? true);
            const da = Math.abs((diam(eq.get(a.hobId)) ?? 0) - (vd ?? 0));
            const db = Math.abs((diam(eq.get(b.hobId)) ?? 0) - (vd ?? 0));
            return da - db;
          })
          .map((f) => f.hobId);
        const h = hint(s.text);
        if (h && candidates.includes(h)) candidates = [h, ...candidates.filter((c) => c !== h)];
        else if (h) warnings.push(`${r.name}, étape ${si + 1} : le texte parle du ${eq.get(h)?.name.toLowerCase() ?? h}, mais ${shortName(vessel, e?.name)} n'y va pas ; j'en prends un autre.`);
        // Continuité : même foyer que l'étape précédente avec ce récipient.
        const prevSame = [...mine].reverse().find((w) => w.vessel === vessel && w.needsHob);
        if (prevSame && !h && prevSame.hobCandidates[0] && candidates.includes(prevSame.hobCandidates[0])) {
          candidates = [prevSame.hobCandidates[0], ...candidates.filter((c) => c !== prevSame.hobCandidates[0])];
        }
      }
      let ovenLevels: number[] = [];
      if (usesOven) {
        const m = !needsHob ? s.text.match(/niveaux? (\d)(?:\s*et\s*(\d))?/i) : null;
        if (m) ovenLevels = [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])];
        else if (s.kind === "bake" && act >= dur - EPS) ovenLevels = []; // montage pendant le préchauffage
        else if (vessel === "cocotte") ovenLevels = [4];
        else ovenLevels = [3];
      }
      const w: Work = {
        id,
        r: ri,
        order: si + 1,
        src: s,
        dur,
        act,
        vessel,
        hobCandidates: candidates,
        needsHob,
        hobDur: needsHob && usesOven ? Math.max(1, act) : dur,
        usesOven,
        ovenTemp: usesOven ? (s.ovenTemp ?? null) : null,
        ovenLevels,
        deps: [],
        tail: 0,
        prio: 0,
        side: /\bpendant (?:le|la|les|l'|que|ce)\b/i.test(s.text) && s.kind !== "cool",
        hobBraise: onHobBraise,
        notes: [],
        refDur: sf && dur !== refDur ? refDur : undefined,
      };
      if (vessel && COOK_APPLIANCES.has(vessel) && s.ovenTemp != null) {
        w.notes.push(`${shortName(vessel, e?.name)} à ${s.ovenTemp} °C, en une couche ; secoue ou retourne à mi-cuisson.`);
      }
      if (onHobBraise) {
        w.notes.push(`Braisage sur la plaque : couvercle, petit frémissement au niveau ${HOB_BRAISE_LEVEL} (le four reste libre pour l'autre recette).`);
      }
      // Dépendances dans la recette.
      const prev = mine[mine.length - 1];
      if (prev) {
        // Une étape du fil principal n'attend pas les à-côtés (« pendant le braisage ») :
        // elle suit la dernière étape principale. Un à-côté démarre une fois son geste fait.
        const main = [...mine].reverse().find((p) => !p.side) ?? prev;
        if (s.kind === "cool") for (const p of mine) w.deps.push({ w: p, type: "end" });
        else {
          const overlap = w.side || ((["boil", "rest"].includes(main.src!.kind) || /\bpendant (?:le|la|les|l'|que|ce)\b/i.test(s.text)) && main.vessel !== vessel);
          w.deps.push({ w: main, type: overlap ? "active" : "end" });
        }
        for (const p of mine) {
          if (vessel && p.vessel === vessel) w.deps.push({ w: p, type: "end" });
          if ((s.bowls ?? []).some((b) => (p.src!.bowls ?? []).includes(b))) w.deps.push({ w: p, type: "end" });
        }
        // Continuité : le même récipient reste sur son foyer, ou au four à la même température,
        // quand l'étape suit directement (« ajoute les champignons » d'un braisage au four).
        const h = hint(s.text);
        const lastHob = vessel ? [...mine].reverse().find((p) => p.vessel === vessel) : undefined;
        const lastOven = [...mine].reverse().find((p) => p.usesOven);
        const near = (p: Work | undefined): p is Work => Boolean(p && !p.cont && (p === prev || p === main));
        if (near(lastHob) && lastHob.needsHob && !lastHob.usesOven && w.needsHob && (!h || h === lastHob.hobCandidates[0])) {
          w.contOf = { w: lastHob, type: "hob" };
          lastHob.cont = { w, type: "hob" };
        } else if (near(lastOven) && w.usesOven && !w.needsHob && w.ovenTemp === lastOven.ovenTemp) {
          w.contOf = { w: lastOven, type: "oven" };
          lastOven.cont = { w, type: "oven" };
        }
      }
      mine.push(w);
      works.push(w);
    });
  });

  // ─── À deux : les gestes de prep deviennent des tâches du fil ───
  const prepWorks: Work[] = [];
  if (thread) {
    const firstCook = new Map<string, Work>();
    for (const w of works) if (!firstCook.has(input[w.r].slug)) firstCook.set(input[w.r].slug, w);
    const bowlUsers = new Map<string, Work[]>();
    for (const w of works) for (const b of w.src!.bowls ?? []) {
      const l = letterMaps[w.r].get(b);
      if (l) bowlUsers.set(l, [...(bowlUsers.get(l) ?? []), w]);
    }
    for (const t of prepTasks) {
      const slugs = t.kind === "cut" ? [...new Set(t.items.map((i) => i.recipeSlug))] : [t.recipeSlug!];
      const pw: Work = {
        id: `prep:${t.id}`,
        r: Math.min(...slugs.map((s) => input.findIndex((r) => r.slug === s))),
        order: 0,
        src: null,
        prep: t,
        dur: t.minutes,
        act: t.minutes,
        vessel: null,
        hobCandidates: [],
        needsHob: false,
        hobDur: 0,
        usesOven: false,
        ovenTemp: null,
        ovenLevels: [],
        deps: [],
        tail: 0,
        prio: 0,
        side: false,
        needsTools: t.kind === "cut" || (t.kind === "other" && /coupe|taille|émince|cisèle/i.test(t.text ?? "")),
        meat: t.kind === "cut" && isMeat(t.id.replace(/^cut-/, ""), t.title),
        notes: [],
      };
      prepWorks.push(pw);
      const letters = t.kind === "weigh" ? (t.bowls ?? []) : t.items.map((i) => i.bowl).filter((l): l is string => Boolean(l));
      t.bowls = [...new Set(letters)];
      for (const l of t.bowls) {
        const b = bowls.find((x) => x.letter === l);
        if (b) b.tasks = [...(b.tasks ?? []), t.id];
        for (const u of bowlUsers.get(l) ?? []) {
          u.deps.push({ w: pw, type: "end" });
          // Une suite dans le même récipient n'attend pas son bol : il est prêt avant les étapes d'avant
          // qui ne laissent pas le temps de le faire (moins de 10 min d'attente).
          let root = u;
          while (root.contOf && root.contOf.w.dur - root.contOf.w.act < 10) root = root.contOf.w;
          if (root !== u) root.deps.push({ w: pw, type: "end" });
        }
      }
      // Sans bol (viande sur le plateau, tamponner) : avant la première étape de la recette.
      const loose = t.kind === "other" || t.items.some((i) => !i.bowl);
      if (loose) for (const s of slugs) firstCook.get(s)?.deps.push({ w: pw, type: "end" });
    }
  }
  // Gestes remis avant la cuisson : toute étape les attend.
  for (const pw of prepWorks) if (before.has(pw.prep!.id)) for (const w of works) w.deps.push({ w: pw, type: "end" });
  const all = [...prepWorks, ...works];

  // Priorité : chemin critique (ce qui reste à faire derrière l'étape, sans les ressources).
  if (thread) {
    // Plus long chemin jusqu'à la fin (les dépendances pointent toujours vers l'amont du tableau).
    const succ = new Map<Work, { w: Work; lag: number }[]>();
    for (const w of all) for (const d of w.deps) succ.set(d.w, [...(succ.get(d.w) ?? []), { w, lag: d.type === "end" ? d.w.dur : d.w.act }]);
    for (let i = all.length - 1; i >= 0; i--) {
      const w = all[i];
      w.tail = Math.max(w.dur, ...(succ.get(w) ?? []).map((x) => x.lag + x.w.tail));
    }
  } else {
    const est = new Map<Work, number>();
    for (const w of works) est.set(w, Math.max(0, ...w.deps.map((d) => est.get(d.w)! + (d.type === "end" ? d.w.dur : d.w.act))));
    const recipeEnd = new Map<number, number>();
    for (const w of works) recipeEnd.set(w.r, Math.max(recipeEnd.get(w.r) ?? 0, est.get(w)! + w.dur));
    for (const w of works) w.tail = recipeEnd.get(w.r)! - est.get(w)!;
  }
  // Priorité d'un essai : le chemin critique, perturbé de quelques minutes (graine fixe).
  let seed = tr.seed ?? 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const amp = tr.seed ? 5 + rnd() * 55 : 0;
  for (const w of all) w.prio = w.tail + (amp ? (rnd() - 0.5) * amp : 0);

  // ─── Ustensiles (à deux) : grands couteaux et planches ───
  const units = (id: string) => {
    const e = eq.get(id);
    if (!e) return [];
    const n = Math.max(1, e.count ?? 1);
    return Array.from({ length: n }, (_, i) => ({ id: n > 1 ? `${id}#${i + 1}` : id, name: n > 1 ? `${e.name} ${i + 1}` : e.name, until: 0, meat: false }));
  };
  const knives = duo ? units("grand-couteau") : [];
  const boards = duo ? [...units("planche-principale"), ...units("planche-2")] : [];

  // ─── Ordonnancement : on avance dans le temps, on démarre ce qui peut l'être ───
  const freeAt = new Map<Person, number>(persons.map((p) => [p, 0]));
  const lastPersonOf = new Map<number, Person>(); // recette → dernière personne à son fil
  const hobRes: { hob: string; from: number; to: number; w: Work }[] = [];
  const ovenRes: { temp: number; from: number; to: number; w: Work }[] = [];
  const locks = new Map<string, { owner: number; left: number; releasedAt: number | null; lastEnd: number }>();
  const usesLeft = new Map<string, number>();
  for (const w of works) if (w.vessel) usesLeft.set(`${w.r}|${w.vessel}`, (usesLeft.get(`${w.r}|${w.vessel}`) ?? 0) + 1);
  const preheats: { at: number; temp: number; before: Work }[] = [];

  const depTime = (w: Work): number | null => {
    let t = 0;
    for (const d of w.deps) {
      if (d.w.start == null) return null;
      t = Math.max(t, d.w.start + (d.type === "end" ? d.w.dur : d.w.act));
    }
    return t;
  };
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - EPS && b0 < a1 - EPS;
  const pending = new Set(all);

  const pickPerson = (w: Work, t: number): Person | null => {
    if (w.act <= EPS) return w.contOf?.w.person ?? lastPersonOf.get(w.r) ?? "A";
    const free = persons.filter((p) => freeAt.get(p)! <= t + EPS);
    if (!free.length) return null;
    const pref = [w.contOf?.w.person, ...w.deps.filter((d) => d.w.src && d.w.r === w.r).map((d) => d.w.person), lastPersonOf.get(w.r)].filter((p): p is Person => Boolean(p));
    return pref.find((p) => free.includes(p)) ?? free[0];
  };

  const tryPlace = (w: Work, t: number) => {
    const person = pickPerson(w, t);
    if (!person) return null;
    // À deux, un geste de prep ne doit pas retarder une étape plus urgente qui devient prête pendant qu'on le fait.
    if (thread && w.prep) {
      const after = new Map(freeAt);
      after.set(person, t + w.act);
      for (const x of pending) {
        if (x === w || x.act <= EPS || x.tail <= w.tail) continue;
        const d = depTime(x);
        if (d == null || d <= t + EPS || d >= t + w.act - EPS) continue;
        if (![...after.values()].some((f) => f <= d + EPS)) return null;
        // La personne qui tient le récipient le garde (pas de relais pour un geste de prep).
        if ((x.contOf?.w.person ?? (x.src ? lastPersonOf.get(x.r) : undefined)) === person) return null;
      }
    }
    // Une suite qui tombe à l'heure (« à 1 h de braisage, ajoute les champignons ») n'attend
    // jamais : on ne commence pas un geste qui occuperait la dernière personne libre à ce moment.
    if (w.act > EPS) {
      const after = new Map(freeAt);
      after.set(person, Math.max(after.get(person)!, t + w.act));
      for (const x of pending) {
        if (x === w || !x.contOf || x.act <= EPS) continue;
        const d = depTime(x);
        if (d == null || d <= t + EPS || d >= t + w.act - EPS) continue;
        if (![...after.values()].some((f) => f <= d + EPS)) return null;
      }
    }
    // À deux, un récipient partagé ne part pas chez une recette moins pressée quand l'étape
    // la plus urgente qui le demande devient prête pendant qu'il serait pris (la poêle
    // du chasseur, quand le forno pourrait la prendre une minute avant).
    if (thread && w.vessel && !w.contOf && locks.get(w.vessel)?.owner !== w.r) {
      for (const x of pending) {
        if (x === w || x.r === w.r || x.vessel !== w.vessel || x.tail <= w.tail + 15) continue;
        const d = depTime(x);
        if (d != null && d > t + EPS && d < t + w.dur - EPS) return null;
      }
    }
    let washFrom: string | null = null;
    if (w.vessel) {
      const lock = locks.get(w.vessel);
      if (lock && lock.owner !== w.r) {
        if (lock.releasedAt == null || t < lock.releasedAt + WASH_MIN - EPS) return null;
        washFrom = recipes[lock.owner].name;
      }
    }
    let hobId: string | null = null;
    if (w.needsHob) {
      const contHob = w.contOf?.type === "hob" ? w.contOf.w.hobId : null;
      // Essai « foyer malin » : garder libres les foyers que des récipients moins accommodants attendent.
      const demand = (h: string) => [...pending].filter((x) => x !== w && x.needsHob && x.hobCandidates.length < w.hobCandidates.length && x.hobCandidates.includes(h)).length;
      const cands = contHob ? [contHob] : tr.smartHob ? [...w.hobCandidates].sort((a, b) => demand(a) - demand(b)) : w.hobCandidates;
      hobId = cands.find((h) => !hobRes.some((x) => x.hob === h && x.w !== w.contOf?.w && overlaps(t, t + w.hobDur, x.from, x.to))) ?? null;
      if (!hobId) return null;
    }
    let oven: PlanStep["oven"] = null;
    let needPreheat = false;
    if (w.usesOven && w.ovenTemp != null) {
      const from = t + (w.needsHob ? w.hobDur : 0);
      const to = Math.max(from, t + w.dur);
      const keep = w.contOf?.type === "oven" ? ovenRes.find((o) => o.w === w.contOf!.w) : undefined;
      const hot = Boolean(keep) || ovenRes.some((o) => o.temp === w.ovenTemp && o.from <= from + EPS && o.to >= from - EPS);
      const pre = hot ? from : from - PREHEAT_MIN;
      if (ovenRes.some((o) => o !== keep && o.temp !== w.ovenTemp && overlaps(pre, to, o.from, o.to))) return null;
      needPreheat = !hot;
      oven = { temp: w.ovenTemp, levels: w.ovenLevels, fromMin: from, untilMin: to, preheatFromMin: pre };
    }
    let tools: { knife: (typeof knives)[number]; board: (typeof boards)[number]; wash: boolean } | null = null;
    if (w.needsTools && knives.length && boards.length) {
      const knife = knives.find((k) => k.until <= t + EPS);
      const okBoard = (b: (typeof boards)[number]) => b.until + (b.meat && !w.meat ? WASH_MIN : 0) <= t + EPS;
      const free = boards.filter(okBoard);
      // La viande va sur la planche qui en a déjà vu (ou la seconde) ; les légumes sur une planche propre.
      const board = w.meat ? (free.find((b) => b.meat) ?? [...free].reverse()[0]) : (free.find((b) => !b.meat) ?? free[0]);
      if (!knife || !board) return null;
      tools = { knife, board, wash: board.meat && !w.meat };
    }
    return { hobId, oven, needPreheat, washFrom, person, tools };
  };

  let t = 0;
  let guard = 0;
  while (pending.size && guard++ < 20_000) {
    let placed = true;
    while (placed) {
      placed = false;
      const ready = [...pending]
        .map((w) => ({ w, d: depTime(w) }))
        .filter((x) => x.d != null && x.d <= t + EPS)
        // Une suite dans le même récipient d'abord (la poêle préchauffée à vide n'attend pas un geste).
        .sort((a, b) => Number(Boolean(b.w.contOf)) - Number(Boolean(a.w.contOf)) || b.w.prio - a.w.prio || a.w.r - b.w.r || a.w.order - b.w.order);
      for (const { w } of ready) {
        const p = tryPlace(w, t);
        if (!p) continue;
        w.start = t;
        w.hobId = p.hobId;
        w.oven = p.oven;
        w.person = p.person;
        if (p.washFrom && w.vessel) w.notes.push(`Rince d'abord ${article(shortName(w.vessel)!)} (servait à : ${p.washFrom}).`);
        if (w.act > EPS) freeAt.set(p.person, Math.max(freeAt.get(p.person)!, t + w.act));
        if (w.src) lastPersonOf.set(w.r, p.person);
        if (p.tools) {
          p.tools.knife.until = t + w.dur;
          p.tools.board.until = t + w.dur;
          p.tools.board.meat = Boolean(w.meat);
          w.tools = [p.tools.knife.name, p.tools.board.name];
          if (p.tools.wash) w.notes.push(`Lave d'abord ${p.tools.board.name.toLowerCase()} (de la viande y est passée).`);
        }
        // La continuité garde le foyer ou le four jusqu'à l'étape suivante (to = ∞, puis fermé).
        const prevHob = w.contOf?.type === "hob" ? hobRes.find((x) => x.w === w.contOf!.w) : undefined;
        if (prevHob) prevHob.to = t;
        const prevOven = w.contOf?.type === "oven" ? ovenRes.find((x) => x.w === w.contOf!.w) : undefined;
        if (prevOven) prevOven.to = t;
        if (p.hobId) hobRes.push({ hob: p.hobId, from: t, to: w.cont?.type === "hob" ? Infinity : t + w.hobDur, w });
        if (p.oven) {
          ovenRes.push({ temp: p.oven.temp, from: prevOven ? t : p.oven.preheatFromMin, to: w.cont?.type === "oven" ? Infinity : p.oven.untilMin, w });
          if (p.needPreheat) preheats.push({ at: p.oven.preheatFromMin, temp: p.oven.temp, before: w });
        }
        if (w.vessel) {
          const key = `${w.r}|${w.vessel}`;
          const left = (usesLeft.get(key) ?? 1) - 1;
          usesLeft.set(key, left);
          const lock = locks.get(w.vessel);
          const lastEnd = Math.max(lock && lock.owner === w.r ? lock.lastEnd : 0, t + w.dur);
          locks.set(w.vessel, { owner: w.r, left, releasedAt: left === 0 ? lastEnd : null, lastEnd });
        }
        pending.delete(w);
        placed = true;
        break; // on recalcule les étapes prêtes (la personne est peut-être occupée)
      }
    }
    if (!pending.size) break;
    const times = [
      ...freeAt.values(),
      ...hobRes.map((x) => x.to),
      ...ovenRes.map((x) => x.to),
      ...knives.map((k) => k.until),
      ...boards.flatMap((b) => [b.until, b.until + WASH_MIN]),
      ...[...locks.values()].map((l) => (l.releasedAt != null ? l.releasedAt + WASH_MIN : NaN)),
      ...[...pending].map((w) => depTime(w) ?? NaN),
      // Four pris à une autre température : on peut démarrer quand le préchauffage (et le
      // passage sur le foyer avant le four) tombe juste à sa libération.
      ...[...pending]
        .filter((w) => w.usesOven)
        .flatMap((w) => ovenRes.map((o) => o.to + PREHEAT_MIN - (w.needsHob ? w.hobDur : 0))),
    ].filter((x) => Number.isFinite(x) && x > t + EPS);
    if (!times.length) {
      for (const w of pending) {
        errors.push({
          kind: "unschedulable",
          message: `${w.src ? `${recipes[w.r].name}, étape ${w.order}` : w.prep!.title} : impossible à placer (${w.vessel ? shortName(w.vessel) : "ressource"} jamais libre).`,
          stepIds: [w.id],
        });
      }
      break;
    }
    t = Math.min(...times);
  }

  // Seul, gestes glissés : la prep (avant la cuisson) est ce qui commence avant la première étape ;
  // les gestes d'après deviennent des étapes du fil. Les heures partent du début de la cuisson.
  const cookStart = interleave ? Math.min(...works.filter((w) => w.start != null).map((w) => w.start!)) : 0;
  const shift = interleave && Number.isFinite(cookStart) ? cookStart : 0;
  const during = interleave ? prepWorks.filter((w) => w.start != null && w.start >= shift - EPS && works.length > 0).sort((a, b) => a.start! - b.start!) : [];
  // Gestes à la suite (sans étape entre eux) : un moment, une étape du fil avec un geste par sous-étape.
  const blocks: Work[][] = [];
  for (const w of during) {
    const last = blocks[blocks.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && w.start! <= prev.start! + prev.dur + 0.5) last.push(w);
    else blocks.push([w]);
  }
  const small = blocks.filter((b) => b.reduce((x, w) => x + w.dur, 0) < MIN_BLOCK - EPS).flatMap((b) => b.map((w) => w.prep!.id));

  // ─── Fil de cuisson ───
  const steps: PlanStep[] = works
    .filter((w) => w.start != null)
    .map((w) => {
      const r = input[w.r];
      const src = w.src!;
      const e = src.equipmentId ? eq.get(src.equipmentId) : undefined;
      let batches: number | null = null;
      const max = w.vessel ? eq.get(w.vessel)?.maxBatchG : null;
      if (max && (src.kind === "sear" || COOK_APPLIANCES.has(w.vessel!)) && w.dur >= 5) {
        const g = gramsOf(r, src.bowls);
        if (g > max) {
          batches = Math.ceil(g / max);
          if (!/fournée/i.test(src.text)) {
            warnings.push(`${r.name}, étape ${w.order} : ${Math.round(g)} g dans ${article(shortName(w.vessel)!)}, prévois ${batches} fournées (${max} g au plus).`);
          }
        }
      }
      const hob = hobRes.find((x) => x.w === w);
      const ov = ovenRes.find((x) => x.w === w);
      let text = relabelBowls(src.text, letterMaps[w.r]);
      let hobLevel = w.needsHob ? (src.hobLevel ?? null) : null;
      let hobLevelLabel: string | null = null;
      if (w.hobBraise) {
        text = text.replace(/,?\s*puis au four\b/i, ", puis couvercle et niveau 2-3 sur la plaque").replace(/\bremets au four\b/i, "remets le couvercle, niveau 2-3,");
        hobLevelLabel = src.hobLevel != null ? `${src.hobLevel} puis ${HOB_BRAISE_LEVEL}` : HOB_BRAISE_LEVEL;
        hobLevel = src.hobLevel ?? 2;
      }
      const step: PlanStep = {
        id: w.id,
        no: 0,
        recipeSlug: r.slug,
        order: w.order,
        kind: src.kind,
        text,
        cue: src.cue ?? null,
        ...(src.phases?.length ? { phases: src.phases.map((p) => ({ text: relabelBowls(p.text, letterMaps[w.r]), min: p.min, hobLevel: p.hobLevel ?? null, batch: p.batch ?? null, ...(p.wait ? { wait: true } : {}) })) } : {}),
        durationMin: w.dur,
        activeMin: w.act,
        startMin: w.start!,
        endMin: w.start! + w.dur,
        equipmentId: src.equipmentId ?? null,
        equipmentName: shortName(src.equipmentId ?? null, e?.name),
        hobId: w.hobId ?? null,
        hobLevel,
        hobUntilMin: w.hobId ? Math.max(w.start! + w.hobDur, Number.isFinite(hob?.to) ? hob!.to : 0) : null,
        oven: w.oven ? { ...w.oven, untilMin: Math.max(w.oven.untilMin, Number.isFinite(ov?.to) ? ov!.to : 0) } : null,
        bowls: (src.bowls ?? []).map((b) => letterMaps[w.r].get(b) ?? b),
        batches,
        notes: w.notes,
      };
      if (hobLevelLabel) step.hobLevelLabel = hobLevelLabel;
      if (w.refDur != null) step.refDurationMin = w.refDur;
      if (duo) step.person = w.person ?? null;
      return step;
    });
  if (shift) {
    for (const st of steps) {
      st.startMin -= shift;
      st.endMin -= shift;
      if (st.hobUntilMin != null) st.hobUntilMin -= shift;
      if (st.oven) st.oven = { ...st.oven, fromMin: st.oven.fromMin - shift, untilMin: st.oven.untilMin - shift, preheatFromMin: st.oven.preheatFromMin - shift };
    }
    for (const p of preheats) p.at -= shift;
  }
  for (const b of blocks) {
    const tasks = b.map((w) => w.prep!);
    const minutes = b[b.length - 1].start! + b[b.length - 1].dur - b[0].start!;
    const names = tasks.map((t) => (t.kind === "cut" ? t.title : t.kind === "weigh" ? `bol ${t.bowls?.[0] ?? ""}` : t.title));
    steps.push({
      id: `geste:${tasks[0].id}`,
      no: 0,
      recipeSlug: tasks[0].recipeSlug ?? tasks[0].items[0]?.recipeSlug ?? input[b[0].r].slug,
      order: 0,
      kind: "prep",
      text: `Pendant que ça cuit : ${tasks.length > 1 ? `${tasks.length} gestes de prep.` : "un geste de prep."} ${names.join(", ")}.`,
      cue: null,
      phases: tasks.map((t) => ({ text: gestureText(t), min: t.minutes })),
      durationMin: minutes,
      activeMin: minutes,
      startMin: b[0].start! - shift,
      endMin: b[0].start! - shift + minutes,
      equipmentId: null,
      equipmentName: null,
      hobId: null,
      hobLevel: null,
      hobUntilMin: null,
      oven: null,
      bowls: [...new Set(tasks.flatMap((t) => t.bowls ?? []))],
      batches: null,
      notes: [],
      tasks,
    });
  }
  preheats.forEach((p, i) => {
    if (p.at <= EPS) {
      prepNotes.push(`Allume le four à ${p.temp} °C pendant la prep (pour : ${recipes[p.before.r].name}).`);
      return;
    }
    const step: PlanStep = {
      id: `four#${i + 1}`,
      no: 0,
      recipeSlug: null,
      order: 0,
      kind: "preheat",
      text: `Règle le four à ${p.temp} °C chaleur tournante (préchauffage ${PREHEAT_MIN} min, pour : ${recipes[p.before.r].name}).`,
      cue: null,
      durationMin: PREHEAT_MIN,
      activeMin: 0,
      startMin: p.at,
      endMin: p.at + PREHEAT_MIN,
      equipmentId: "oven",
      equipmentName: "Four",
      hobId: null,
      hobLevel: null,
      hobUntilMin: null,
      oven: null,
      bowls: [],
      batches: null,
      notes: [],
    };
    if (duo) step.person = p.before.person ?? "A";
    steps.push(step);
  });
  steps.sort((a, b) => a.startMin - b.startMin || (a.kind === "preheat" ? -1 : 0) - (b.kind === "preheat" ? -1 : 0) || a.order - b.order);
  steps.forEach((s, i) => (s.no = i + 1));

  // À deux : heures, personne et ustensiles de chaque geste ; passages de relais.
  const handoffs: Handoff[] = [];
  if (duo) {
    for (const w of prepWorks) {
      const tk = w.prep!;
      tk.person = w.person;
      tk.startMin = w.start;
      tk.endMin = w.start != null ? w.start + w.dur : undefined;
      if (w.tools) tk.tools = w.tools;
      if (w.notes.length) tk.notes = w.notes;
    }
    prepTasks.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0) || (a.person ?? "").localeCompare(b.person ?? ""));
    const byVessel = new Map<string, PlanStep[]>();
    for (const s of steps) {
      const v = s.equipmentId && isVessel(eq.get(s.equipmentId)) ? s.equipmentId : null;
      if (v && s.person) byVessel.set(v, [...(byVessel.get(v) ?? []), s]);
    }
    for (const [v, list] of byVessel) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        if (a.person === b.person) continue;
        const name = article(shortName(v)!);
        const text = `${a.person} libère ${name} pour ${b.person}`;
        handoffs.push({ atMin: a.endMin, from: a.person!, to: b.person!, equipmentId: v, fromStepId: a.id, toStepId: b.id, text });
        a.notes.push(`Relais : ensuite, ${text}.`);
        b.notes.push(`Relais : ${text} (étape ${a.no}).`);
      }
    }
  }

  // « sert à l'étape N » (un geste qui finit le bol ne le « sert » pas : il le remplit).
  for (const b of bowls) {
    const s = steps.find((x) => !x.tasks && x.recipeSlug === b.recipeSlug && x.bowls.includes(b.letter));
    b.usedBy = s ? { stepId: s.id, no: s.no } : null;
    if (interleave) {
      delete b.tasks;
      const fill = steps.filter((x) => x.tasks && x.bowls.includes(b.letter)).map((x) => ({ stepId: x.id, no: x.no }));
      if (fill.length) b.during = fill;
    }
  }
  if (interleave) {
    const movedIds = new Set(during.map((w) => w.prep!.id));
    prepTasks.splice(0, prepTasks.length, ...prepTasks.filter((t) => t.kind !== "weigh" && !movedIds.has(t.id)));
    prepMin = works.length ? Math.ceil(shift) : Math.ceil(prepWorks.reduce((x, w) => x + w.dur, 0));
    if (during.length) prepNotes.push(`${during.length} geste${during.length > 1 ? "s" : ""} de prep se ${during.length > 1 ? "font" : "fait"} pendant la cuisson, quand tu attends : ${blocks.length > 1 ? `${blocks.length} moments` : "un moment"} dans le fil.`);
  }

  // Manques à la commande : facteur proposé au prorata de l'ingrédient le plus court.
  const shortages: Shortage[] = [];
  input.forEach((r) => {
    for (const i of r.ingredients) {
      const o = i.id ? ordered.get(i.id) : undefined;
      if (!o || i.optional || i.pantry) continue;
      const need = (o.gramsNeeded ?? i.grams ?? 0) * (r.scale ?? 1);
      const got = o.gramsBought ?? 0;
      if (need > 0 && got < need * 0.97) {
        shortages.push({ recipeSlug: r.slug, recipeIngredientId: o.recipeIngredientId, item: i.item, gramsNeeded: need, gramsBought: got, ratio: got / need });
      }
    }
  });
  const scaleSuggestions = recipes
    .map((r) => {
      const mine = shortages.filter((s) => s.recipeSlug === r.slug);
      if (!mine.length) return null;
      const factor = Math.floor(Math.min(...mine.map((s) => s.ratio)) * r.scale * 20) / 20; // par pas de 5 %
      return { recipeSlug: r.slug, factor: Math.max(0.05, factor) };
    })
    .filter((x): x is { recipeSlug: string; factor: number } => Boolean(x));

  const stepsEnd = Math.max(0, ...steps.map((s) => s.endMin));
  const cookingMin = duo ? Math.max(stepsEnd, ...prepTasks.map((t) => t.endMin ?? 0)) : stepsEnd;
  const plan: SessionPlan = {
    version: 1,
    mode,
    recipes,
    hobs: hobsBySize.map((h) => ({ id: h.id, name: h.name, diameterCm: diam(h) })),
    bowls,
    prep: { tasks: prepTasks, minutes: prepMin, notes: prepNotes, sources },
    steps,
    cookingMin,
    activeMin: thread ? all.reduce((s, w) => s + w.act, 0) : prepMin + (eveMin ?? 0) + works.reduce((s, w) => s + w.act, 0),
    totalMin: duo ? cookingMin : prepMin + cookingMin,
    errors,
    warnings,
    shortages,
    scaleSuggestions,
  };
  if (duo) {
    plan.persons = persons;
    plan.handoffs = handoffs;
  }
  if (eveMin != null) plan.prep.eveMin = eveMin;
  if (opts.eve) plan.eve = { minutes: eveDoneMin, tasks: eveTasks, bowls: bowls.filter((b) => b.fridge).map((b) => b.letter), doneTasks: [...opts.eve.doneTasks] };
  if (opts.durations) {
    const list = [...applied.values()].filter((a) => Math.abs(a.min - a.refMin) >= 0.25);
    plan.durations = {
      window: opts.durations.sessions,
      sessions: new Set(list.flatMap((a) => a.sessions)).size,
      applied: list.map(({ sessions: _s, ...a }) => ({ ...a, refMin: Math.round(a.refMin * 10) / 10, min: Math.round(a.min * 10) / 10 })), // eslint-disable-line @typescript-eslint/no-unused-vars
    };
  }
  plan.errors.push(...validatePlan(plan, res));
  return { plan, small };
}

/** Vérifie un plan : four à deux températures, récipient sur un foyer incompatible, deux récipients sur un foyer, un récipient pour deux recettes en même temps ; à deux, une personne à deux endroits, un ustensile pris deux fois. */
export function validatePlan(plan: Pick<SessionPlan, "steps" | "recipes"> & Partial<Pick<SessionPlan, "mode" | "prep">>, res: PlannerResources): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const eq = new Map(res.equipment.map((e) => [e.id, e]));
  const nameOf = (slug: string | null) => plan.recipes.find((r) => r.slug === slug)?.name ?? "commun";
  const label = (s: PlanStep) => `étape ${s.no} · ${nameOf(s.recipeSlug)}`;
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - EPS && b0 < a1 - EPS;
  const hobName = (id: string) => eq.get(id)?.name.toLowerCase() ?? id;

  for (const s of plan.steps) {
    if (!s.hobId || !s.equipmentId) continue;
    const ok = res.fits.some((f) => f.equipmentId === s.equipmentId && f.hobId === s.hobId);
    if (!ok) {
      const possible = res.fits.filter((f) => f.equipmentId === s.equipmentId && eq.get(f.hobId)?.kind === "hob").map((f) => hobName(f.hobId));
      issues.push({
        kind: "hob_fit",
        message: `${shortName(s.equipmentId, eq.get(s.equipmentId)?.name)} ne va pas sur le ${hobName(s.hobId)} (${label(s)})${possible.length ? ` : ${possible.join(" ou ")} seulement` : ""}.`,
        stepIds: [s.id],
      });
    }
  }
  const withHob = plan.steps.filter((s) => s.hobId && s.hobUntilMin != null);
  for (let i = 0; i < withHob.length; i++)
    for (let j = i + 1; j < withHob.length; j++) {
      const a = withHob[i];
      const b = withHob[j];
      if (a.hobId !== b.hobId || !overlaps(a.startMin, a.hobUntilMin!, b.startMin, b.hobUntilMin!)) continue;
      if (a.equipmentId === b.equipmentId && a.recipeSlug === b.recipeSlug) continue;
      issues.push({
        kind: "hob_shared",
        message: `Deux récipients sur le ${hobName(a.hobId!)} en même temps : ${shortName(a.equipmentId)} (${label(a)}) et ${shortName(b.equipmentId)} (${label(b)}).`,
        stepIds: [a.id, b.id],
      });
    }
  const withOven = plan.steps.filter((s) => s.oven);
  for (let i = 0; i < withOven.length; i++)
    for (let j = i + 1; j < withOven.length; j++) {
      const a = withOven[i];
      const b = withOven[j];
      const ao = a.oven!;
      const bo = b.oven!;
      if (ao.temp === bo.temp || !overlaps(ao.preheatFromMin, ao.untilMin, bo.preheatFromMin, bo.untilMin)) continue;
      issues.push({
        kind: "oven_temp",
        message: `Le four est demandé à ${ao.temp} °C (${label(a)}) et à ${bo.temp} °C (${label(b)}) en même temps.`,
        stepIds: [a.id, b.id],
      });
    }
  const vessels = plan.steps.filter((s) => s.equipmentId && isVessel(eq.get(s.equipmentId)));
  for (let i = 0; i < vessels.length; i++)
    for (let j = i + 1; j < vessels.length; j++) {
      const a = vessels[i];
      const b = vessels[j];
      if (a.equipmentId !== b.equipmentId || a.recipeSlug === b.recipeSlug || !overlaps(a.startMin, a.endMin, b.startMin, b.endMin)) continue;
      issues.push({
        kind: "vessel_shared",
        message: `${shortName(a.equipmentId)} sert à deux recettes en même temps (${label(a)} et ${label(b)}).`,
        stepIds: [a.id, b.id],
      });
    }

  // À deux : chaque personne fait une chose à la fois ; un ustensile ne sert qu'à un geste à la fois.
  if (plan.mode === "duo") {
    const acts: { id: string; who: string; from: number; to: number; label: string }[] = [
      ...plan.steps.filter((s) => s.activeMin > EPS && s.person).map((s) => ({ id: s.id, who: s.person!, from: s.startMin, to: s.startMin + s.activeMin, label: label(s) })),
      ...(plan.prep?.tasks ?? [])
        .filter((t) => t.person && t.startMin != null)
        .map((t) => ({ id: `prep:${t.id}`, who: t.person!, from: t.startMin!, to: t.startMin! + t.minutes, label: `prep · ${t.title}` })),
    ];
    for (let i = 0; i < acts.length; i++)
      for (let j = i + 1; j < acts.length; j++) {
        const a = acts[i];
        const b = acts[j];
        if (a.who !== b.who || !overlaps(a.from, a.to, b.from, b.to)) continue;
        issues.push({ kind: "person_busy", message: `${a.who} est demandé à deux endroits en même temps (${a.label} et ${b.label}).`, stepIds: [a.id, b.id] });
      }
    const uses = (plan.prep?.tasks ?? []).filter((t) => t.tools?.length && t.startMin != null);
    for (let i = 0; i < uses.length; i++)
      for (let j = i + 1; j < uses.length; j++) {
        const a = uses[i];
        const b = uses[j];
        const shared = a.tools!.filter((x) => b.tools!.includes(x));
        if (!shared.length || !overlaps(a.startMin!, a.endMin!, b.startMin!, b.endMin!)) continue;
        issues.push({ kind: "tool_shared", message: `${shared.join(", ")} : pris par ${a.person} (${a.title}) et ${b.person} (${b.title}) en même temps.`, stepIds: [`prep:${a.id}`, `prep:${b.id}`] });
      }
  }
  return issues;
}

function stepLike(s: PlannerStep) {
  return { kind: s.kind, durationMin: s.durationMin ?? null, activeMin: s.activeMin ?? null, equipmentId: s.equipmentId ?? null, ovenTemp: s.ovenTemp ?? null };
}

/** Le texte d'un geste glissé dans la cuisson (une sous-étape). */
function gestureText(t: PrepTask): string {
  if (t.kind === "cut") {
    const parts = t.items.map((i) => `${i.gesture}${i.qty ? ` (${i.qty})` : ""}${i.bowl ? ` → bol ${i.bowl}` : ", sur le plateau"}`);
    return `${t.title} : ${parts.join(" ; ")}`;
  }
  if (t.kind === "weigh" && t.bowls?.length) return `Bol ${t.bowls[0]} : ${(t.text ?? "").replace(/^Pèse et verse : /, "pèse et verse ").replace(/\.$/, "")}`;
  return (t.text ?? t.title).replace(/\.$/, "");
}

function article(name: string) {
  return /^(Poêle|Cocotte|Casserole|Petite|Grande|Planche|Seconde)/.test(name) ? `la ${name}` : /^[AEIOUYÉ]/.test(name) ? `l'${name}` : `le ${name}`;
}

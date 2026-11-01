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
import { intervalsOverlap, stepTimeline, type Attention, type Reminder, type Timeline } from "./attention";
import { allocateBowls, classifyBowl, inventoryOf, type BowlNeed, type Holder } from "./containers";
import { baseLiters, baseOfStep, bowlLiquids, bowlLiters, dishArea, fmtL, gramsOfIngredient, holds, ROAST_G_PER_CM2, stepLoads, usableLiters, vesselLiters, vesselNeeds, type BaseFood, type BaseMethod, type StepLoad } from "./capacity";
import { rewriteHob, splitTitle } from "./text";

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
  /** Garniture cuite et gardée à part (riz, semoule) : elle n'entre pas dans le récipient du plat. */
  side?: boolean | null;
}

/** À incrémenter quand un changement du planificateur doit refaire le plan des sessions ouvertes (réimport des fiches au démarrage). */
export const PLAN_VERSION = 5;

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
  /** Plan : ce que demande ce moment (src/lib/session/attention.ts). */
  attention?: Attention;
  /** Plan : rappel pendant un moment « surveille » (« Remue la sauce », toutes les 5 min). */
  reminder?: { everyMin: number; text: string } | null;
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
  /** Contenance en litres (récipients, bols et boîtes) ; sans elle, estimée d'après dimsJson. */
  capacityL?: number | null;
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
  /** Quantités en nombres, mises à l'échelle (absentes dans les plans d'avant le 01/11/2026). */
  grams?: number | null;
  units?: number | null;
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
  /** Où attend ce groupe (src/lib/session/containers.ts) : au moment (pesé et versé à l'étape), un bol, une boîte, une assiette. */
  holder?: Holder;
  /** Le contenant de l'inventaire (« bol-grand#1 ») et son nom (« Grand bol ») ; null au moment. */
  container?: string | null;
  containerLabel?: string | null;
  /** Lettres qui partagent ce contenant (elles entrent ensemble dans le récipient). */
  with?: string[];
  /** Se remplit quand le contenant du bol indiqué se libère (pendant la cuisson), pas avant. */
  fillAfter?: string;
  /** Volume estimé du contenu, en litres. */
  liters?: number;
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
  /** Titre court et complet (jamais coupé dans une parenthèse), et le reste du texte (src/lib/session/text.ts). */
  title?: string;
  detail?: string;
  /** Ce que demande l'étape dans l'ensemble, et ses intervalles « mains » (mêmes minutes que startMin). */
  attention?: Attention;
  hands?: [number, number][];
  /** Rappels pendant les moments « surveille », en minutes depuis le début de l'étape. */
  reminders?: Reminder[];
  /** Ce qui entre dans l'étape, quantités mises à l'échelle (bols, et ce qui est hors bol : huile…). */
  ingredients?: StepIngredient[];
  /** Cuisson de base (« riz », « pâtes », « haricots verts ») : un à-côté qui ne retient pas la recette. */
  base?: string;
  /** Cuisson de base partagée entre recettes (riz pour trois) : la part de chacune. */
  shared?: SharedPortion[];
  /** Volume au plus fort dans le récipient et ce que le récipient offre (remplissage compris). */
  load?: { liters: number; usableL: number | null; mode: "boil" | "stew" };
  /** Four : plats et plaques où étaler, et la surface demandée (cm²). */
  dishes?: { ids: string[]; needCm2: number; haveCm2: number };
}

/** Un ingrédient d'une étape : de quoi afficher « Pèse et verse : pulpe de tomate 800 g, concentré 30 g ». */
export interface StepIngredient {
  item: string;
  /** Le nom sans le geste (« Oignons » pour « Oignons, émincés »). */
  name: string;
  food: string | null;
  grams: number | null;
  units: number | null;
  qty: string | null;
  /** Lettre de session du bol d'où il vient (null : hors bol, au placard). */
  bowl: string | null;
  holder?: Holder | null;
  recipeSlug: string;
  optional?: boolean;
  /** Rang de la sous-étape où il entre (null : dès le début ou l'étape n'a pas de sous-étape). */
  phase: number | null;
}

/** La part d'une recette dans une cuisson partagée. */
export interface SharedPortion {
  recipeSlug: string;
  bowl: string | null;
  rawG: number;
  /** Poids cuit estimé (rendement de l'aliment). */
  cookedG: number;
  /** Part du total, de 0 à 1. */
  share: number;
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
  kind: "oven_temp" | "hob_fit" | "hob_shared" | "vessel_shared" | "unknown_equipment" | "unschedulable" | "person_busy" | "tool_shared" | "hands_busy";
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
  /** Contenants de prep : sortis, au plus fort en même temps, ce que la cuisine en a. */
  containers?: PlanContainers;
}

export interface PlanContainers {
  /** Contenants différents sortis (bols et boîtes, après réutilisation). */
  used: number;
  /** Au plus fort, pleins en même temps. */
  peak: number;
  /** Bols et boîtes de l'inventaire. */
  owned: number;
  /** Groupes pesés au moment, posés sur une assiette, sans contenant. */
  moment: number;
  plates: number;
  missing: string[];
  /** Boîtes de conservation de la cuisine (pour ranger en fin de session), si elles sont décrites. */
  storage?: { count: number; liters: number };
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
  "plaque-four": "Plaque du four",
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

/** Le texte cite-t-il ce bol (« bol C », « bols D, I et M », « Beurre + bol A ») ? */
export function mentionsBowl(text: string, letter: string): boolean {
  for (const m of text.matchAll(/\b[Bb]ols? ((?:[A-Z]{1,2}\b(?:, | et | \+ |,? ?)?)+)/g)) {
    if (m[1].split(/,|\bet\b|\+/).map((x) => x.trim()).includes(letter)) return true;
  }
  return false;
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
  /** Lettres de session de ses bols (une cuisson partagée en a de plusieurs recettes). */
  letters: string[];
  /** Cuisson de base (riz, pâtes, légumes à l'eau) : se partage entre recettes ; `batches` : fournées dans la même eau. */
  base?: { key: string; info: BaseFood; method: BaseMethod; grams: number; food: string; batches?: number };
  /** Cuisson partagée : texte, sous-étapes et parts déjà écrits (lettres de session). */
  out?: { text: string; phases: StepPhase[]; shared: SharedPortion[] };
  /** Intervalles « mains » depuis le début de l'étape, et la chronologie d'attention. */
  hands: [number, number][];
  tl?: Timeline;
  /** Clé du verrou de récipient (par défaut la recette) : une cuisson de base déplacée a la sienne. */
  lock?: number;
  /** Intervalles « mains » retenus (minutes absolues), gestes courts glissés compris. */
  placed?: [number, number][];
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

/**
 * Les rechanges possibles d'une recette : chaque récipient dont toutes les étapes acceptent le même autre,
 * s'il tient ce qu'on y met. Un récipient trop petit pour ce qu'il reçoit (ou absent de la cuisine) doit
 * changer (`forced` : les récipients qui le tiennent, ceux de la fiche d'abord, sinon toute casserole
 * de la cuisine qui va sur la plaque, et au four s'il le faut). Les cuissons de base (le riz) choisissent
 * leur récipient plus tard, une fois regroupées.
 */
function swapsOf(r: PlannerRecipe, ri: number, res: PlannerResources): { swaps: Swap[]; forced: Swap[][] } {
  const out: Swap[] = [];
  const forced: Swap[][] = [];
  const eq = new Map(res.equipment.map((e) => [e.id, e]));
  const isPot = (id: string) => kindOfIn(res, id) === "pot";
  const needs = vesselNeeds(r, isPot, (id) => kindOfIn(res, id) === "pan");
  const onHob = (id: string) => res.fits.some((f) => f.equipmentId === id && eq.get(f.hobId)?.kind === "hob");
  const inOven = (id: string) => res.fits.some((f) => f.equipmentId === id && f.hobId === "oven");
  for (const from of new Set(r.steps.map((s) => s.equipmentId).filter((x): x is string => Boolean(x)))) {
    const mine = r.steps.filter((s) => s.equipmentId === from);
    const need = needs.get(from);
    const tight = (id: string) => Boolean(need && eq.get(id) && holds(eq.get(id)!, need) === false);
    const common = (mine[0].equipmentAlt ?? []).filter((to) => to !== from && eq.has(to) && mine.every((s) => s.equipmentAlt?.includes(to)) && !tight(to));
    const allBase = mine.every((s) => baseOfStep(r, s));
    if (isPot(from) && !allBase && (!eq.has(from) || tight(from))) {
      const hob = mine.some((s) => s.ovenTemp == null || s.hobLevel != null);
      const oven = mine.some((s) => s.ovenTemp != null) && (!eq.has(from) || inOven(from));
      const others = res.equipment
        .filter((e) => e.kind === "pot" && e.id !== from && !common.includes(e.id) && !tight(e.id) && (!hob || onHob(e.id)) && (!oven || inOven(e.id)))
        .sort((a, b) => (vesselLiters(a) ?? 99) - (vesselLiters(b) ?? 99))
        .slice(0, 2)
        .map((e) => e.id);
      const opts = common.length ? common : others;
      if (opts.length) {
        forced.push(opts.map((to) => ({ r: ri, from, to })));
        continue;
      }
    }
    for (const to of common) {
      // Un appareil (air fryer) ne prend que ce qui tient dans son panier, en une fournée.
      const max = COOK_APPLIANCES.has(to) ? res.equipment.find((e) => e.id === to)?.maxBatchG : null;
      if (max && mine.some((s) => gramsOf(r, s.bowls) > max)) continue;
      out.push({ r: ri, from, to });
    }
  }
  return { swaps: out, forced };
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
  // Combinaisons de rechanges : les rechanges obligées (récipient trop petit), puis aucune autre, chaque
  // rechange seule, puis par paires (4 recettes au plus).
  const found = input.map((r, ri) => swapsOf(r, ri, res));
  const all = found.flatMap((f) => f.swaps);
  let bases: Swap[][] = [[]];
  for (const opts of found.flatMap((f) => f.forced)) bases = bases.flatMap((b) => opts.map((o) => [...b, o])).slice(0, 4);
  const swapSets: Swap[][] = [];
  for (const b of bases) {
    swapSets.push(b, ...all.map((x) => [...b, x]));
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].r !== all[j].r) swapSets.push([...b, all[i], all[j]]);
  }
  const hobFits = new Set(res.fits.filter((f) => res.equipment.some((e) => e.id === f.hobId && e.kind === "hob")).map((f) => f.equipmentId));

  let base: SessionPlan | null = null;
  let best: { plan: SessionPlan; swaps: Swap[]; braise: number | null; rs: PlannerRecipe[]; o: PlanOptions; t: Try } | null = null;
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
          const p = planOnce(rs, res, o, new Set(braise == null ? [] : [rs[braise].slug]), t, false);
          base ??= p;
          if (better(p)) best = { plan: p, swaps, braise, rs, o, t };
        }
  }
  // Le plan retenu, refait en entier (textes, ingrédients, contenants : inutiles pour comparer les essais).
  const { swaps, braise } = best!;
  const plan = planOnce(best!.rs, res, best!.o, new Set(braise == null ? [] : [best!.rs[braise].slug]), best!.t, true);
  const decisions: string[] = [];
  for (const sw of swaps) {
    const others = input.filter((_, i) => i !== sw.r && input[i].steps.some((s) => s.equipmentId === sw.from)).map((r) => r.name);
    const forced = found[sw.r].forced.some((opts) => opts.some((o) => o.from === sw.from));
    const need = forced ? vesselNeeds(input[sw.r], (id) => kindOfIn(res, id) === "pot", (id) => kindOfIn(res, id) === "pan").get(sw.from) : undefined;
    const why = forced
      ? res.equipment.some((e) => e.id === sw.from)
        ? ` (il faut environ ${fmtL(need?.liters ?? 0)}, plus que n'en prend ${article(shortName(sw.from)!).toLowerCase()})`
        : ` (${article(shortName(sw.from)!).toLowerCase()} n'est pas dans ta cuisine)`
      : others.length
        ? ` (${article(shortName(sw.from)!).toLowerCase()} sert à : ${others.join(", ")})`
        : "";
    decisions.push(`${input[sw.r].name} se fait dans ${article(shortName(sw.to)!).toLowerCase()} au lieu ${ofArticle(shortName(sw.from)!)}${why}.`);
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
function planOnce(input: PlannerRecipe[], res: PlannerResources, opts: PlanOptions, hobBraise: Set<string>, tr: Try = {}, full = true): SessionPlan {
  let before = new Set<string>();
  for (let i = 0; ; i++) {
    const { plan, small } = planCore(input, res, opts, hobBraise, tr, before, full);
    if (!small.length || i >= 5) return plan;
    before = new Set([...before, ...small]);
  }
}

/** `full` = false : seulement de quoi comparer les essais (heures, erreurs), sans textes, ingrédients ni contenants. */
function planCore(input: PlannerRecipe[], res: PlannerResources, opts: PlanOptions, hobBraise: Set<string>, tr: Try, before: Set<string>, full = true): { plan: SessionPlan; small: string[] } {
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
  const kindOf = (id: string) => kindOfIn(res, id);
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
              grams: i.grams != null ? i.grams * scale : null,
              units: i.units != null ? i.units * scale : null,
            };
            if (eveRules) item.eve = prepAhead(i, parseGesture(i.item).gesture).eve;
            return item;
          }),
        usedBy: null,
      });
    }
    letterMaps.push(map);
  });
  // Ce que contient chaque groupe (src/lib/session/containers.ts) : un vrai bol, ou pesé au moment de l'étape.
  const bowlInfo = new Map<string, Pick<BowlNeed, "content" | "moment" | "liters">>();
  input.forEach((r, ri) => {
    const prepTexts = r.steps.filter((x) => x.kind === "prep").map((x) => x.text);
    const liquids = bowlLiquids(prepTexts);
    for (const [g, letter] of letterMaps[ri]) {
      const ings = r.ingredients.filter((i) => i.group === g);
      const kinds = r.steps.filter((x) => x.kind !== "prep" && (x.bowls ?? []).includes(g)).map((x) => x.kind);
      const mixText = prepTexts.map((t) => t.split(/\b[Bb]ol ([A-Z])\s*:/)).flatMap((parts) => parts.flatMap((x, k) => (k % 2 === 1 && x === g ? [parts[k + 1] ?? ""] : []))).join(" ");
      const c = classifyBowl(
        ings.map((i) => ({ food: i.foodId ?? null, item: i.item, gesture: parseGesture(i.item).gesture })),
        { mixText, liquidL: liquids.get(g) ?? 0, kinds: kinds.length ? kinds : ["sear"] }
      );
      bowlInfo.set(letter, { ...c, liters: Math.round(bowlLiters(ings, r.scale ?? 1, liquids.get(g) ?? 0) * 100) / 100 });
    }
  });
  const atMoment = (letter: string | null) => Boolean(letter && bowlInfo.get(letter)?.moment);
  if (eveRules) for (const b of bowls) b.fridge = !atMoment(b.letter) && b.items.every((i) => i.eve);

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
        // Un groupe pesé au moment de l'étape ne se prépare pas avant.
        if (bowl && !atMoment(bowl)) {
          weighMin.v += weighOne;
          if (ahead.eve) weighMin.eve += weighOne;
          weighF?.note(WEIGH_MIN, weighOne);
          const q = formatQty(grams, units);
          weighItems.set(bowl, [...(weighItems.get(bowl) ?? []), q ? `${base.toLowerCase()} ${q}` : base.toLowerCase()]);
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
  const needsOf = input.map((r) => vesselNeeds(r, (id) => kindOf(id) === "pot", (id) => kindOf(id) === "pan"));
  const hobFitsOf = (vessel: string) => res.fits.filter((f) => f.equipmentId === vessel && hobs.some((h) => h.id === f.hobId));
  /** Les foyers d'un récipient, le plus adapté d'abord ; celui que cite le texte en tête s'il y va. */
  const hobsFor = (vessel: string, text: string): string[] => {
    const vd = diam(eq.get(vessel));
    const c = [...hobFitsOf(vessel)]
      .sort((a, b) => {
        if (Boolean(b.preferred ?? true) !== Boolean(a.preferred ?? true)) return Number(b.preferred ?? true) - Number(a.preferred ?? true);
        const da = Math.abs((diam(eq.get(a.hobId)) ?? 0) - (vd ?? 0));
        const db = Math.abs((diam(eq.get(b.hobId)) ?? 0) - (vd ?? 0));
        return da - db;
      })
      .map((f) => f.hobId);
    const h = hint(text);
    return h && c.includes(h) ? [h, ...c.filter((x) => x !== h)] : c;
  };
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
      // Une cuisson de base dont la casserole manque trouvera un autre récipient (plus bas) ; sinon, le dire.
      if (s.equipmentId && !e && !(baseOfStep(r, s) && kindOf(s.equipmentId) === "pot")) {
        const need = kindOf(s.equipmentId) === "pot" ? needsOf[ri].get(s.equipmentId) : undefined;
        errors.push({
          kind: "unknown_equipment",
          message: need
            ? `${r.name}, étape ${si + 1} : la fiche prend ${article(shortName(s.equipmentId)!).toLowerCase()} (environ ${fmtL(need.liters)}) et la cuisine n'a pas de récipient assez grand qui le remplace.`
            : `${r.name}, étape ${si + 1} : équipement inconnu « ${s.equipmentId} ».`,
          stepIds: [id],
        });
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
      } else if (needsHob && vessel) {
        // Un foyer cité par le texte où le récipient ne va pas : le texte suivra le foyer choisi (rewriteHob).
        candidates = hobsFor(vessel, s.text);
        const h = hint(s.text);
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
      const bs = baseOfStep(r, s);
      const w: Work = {
        id,
        r: ri,
        order: si + 1,
        letters: (s.bowls ?? []).map((g) => letterMaps[ri].get(g) ?? g),
        hands: [],
        ...(bs ? { base: { key: `${bs.base.family}|${bs.method}`, info: bs.base, method: bs.method, grams: bs.grams, food: bs.food } } : {}),
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
        // Une cuisson de base (le riz, gardé à part) est un à-côté : rien n'attend qu'elle finisse, sauf le rangement.
        side: Boolean(bs) || (/\bpendant (?:le|la|les|l'|que|ce)\b/i.test(s.text) && s.kind !== "cool"),
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
        // Après des cuissons de base seulement, l'étape n'attend personne (le riz ne bloque pas la saisie).
        const main = [...mine].reverse().find((p) => !p.side) ?? (prev.base ? null : prev);
        if (s.kind === "cool") for (const p of mine) w.deps.push({ w: p, type: "end" });
        else if (main && !w.base) {
          const overlap = w.side || ((["boil", "rest"].includes(main.src!.kind) || /\bpendant (?:le|la|les|l'|que|ce)\b/i.test(s.text)) && main.vessel !== vessel);
          w.deps.push({ w: main, type: overlap ? "active" : "end" });
        }
        // L'étape principale qui suit un à-côté l'attend : « Poulet dans la sauce » après « pendant que la sauce
        // mijote, saisis le poulet », le montage après la sauce faite « pendant ce temps ». Pas une cuisson de base.
        if (!w.side && s.kind !== "cool") for (const p of mine.slice(main ? mine.indexOf(main) + 1 : 0)) if (p.side && !p.base) w.deps.push({ w: p, type: "end" });
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


  // ─── Bases communes : une cuisson pour toutes les recettes, puis le partage ───
  // Le riz de trois recettes cuit une fois, dans le récipient qui le tient (plusieurs si trop gros) ;
  // une base seule garde son récipient s'il la tient, sinon prend le plus petit qui la tient.
  const SHARE_MIN = 2;
  const pots = res.equipment.filter((e) => e.kind === "pot" && hobFitsOf(e.id).length > 0);
  const baseLoad = (ms: Work[]): StepLoad => ({ liters: baseLiters(ms[0].base!.info, ms[0].base!.method, ms.reduce((x, m) => x + m.base!.grams, 0) / 1000), mode: "boil" });
  const holdsAll = (vid: string, ms: Work[]) => {
    const e = eq.get(vid);
    return Boolean(e) && holds(e!, baseLoad(ms)) !== false;
  };
  let nextLock = input.length;
  const lockNames = new Map<number, string>();
  const ownLock = (w: Work) => {
    w.lock = nextLock++;
    lockNames.set(w.lock, recipes[w.r].name);
  };
  const moveTo = (w: Work, vessel: string) => {
    if (w.vessel === vessel) return;
    ownLock(w);
    const from = w.src!.equipmentId ?? w.vessel ?? vessel;
    w.src = { ...w.src!, equipmentId: vessel, text: swapVesselText(w.src!.text, from, vessel) };
    w.vessel = vessel;
    w.hobCandidates = hobsFor(vessel, w.src.text);
    w.needsHob = w.hobCandidates.length > 0;
    w.hobDur = w.dur;
  };
  const merged = new Map<Work, Work>(); // membre fondu → la cuisson qui le porte
  const mergeNotes: string[] = [];
  const groups = new Map<string, Work[]>();
  // Une cuisson de base dont la casserole manque à la cuisine entre aussi : elle prendra un récipient qui la tient.
  for (const w of works) if (w.base && !w.cont && !w.contOf && (w.vessel || (w.src?.equipmentId && kindOf(w.src.equipmentId) === "pot"))) groups.set(w.base.key, [...(groups.get(w.base.key) ?? []), w]);
  /**
   * Trop pour le plus grand récipient, à l'eau : en fournées dans la même eau (la moitié, sortie à l'écumoire,
   * puis l'autre moitié). Le temps de cuisson se répète.
   */
  const inBatches = (m: Work): boolean => {
    if (m.base!.method !== "bath") return false;
    const big = [...pots].sort((a, b) => (usableLiters(b, "boil") ?? 0) - (usableLiters(a, "boil") ?? 0))[0];
    const u = big ? usableLiters(big, "boil") : null;
    if (!big || u == null) return false;
    const k = [2, 3, 4].find((n) => baseLiters(m.base!.info, "bath", m.base!.grams / n / 1000) <= u + 1e-6);
    if (!k) return false;
    moveTo(m, big.id);
    m.base!.batches = k;
    const src = m.src!;
    const phases = [...(src.phases ?? [])];
    const addAt = phases.findIndex((p) => mentionsBowl(relabelBowls(p.text, letterMaps[m.r]), m.letters[0] ?? "?"));
    const cook = phases.slice(addAt + 1).find((p) => p.wait);
    const extra = (k - 1) * ((cook?.min ?? 6) + 0.5);
    if (addAt >= 0 && cook) {
      const at = phases.indexOf(cook) + 1;
      const more = Array.from({ length: k - 1 }, (_, i) => [
        { text: `Sors-les à l'écumoire ; fournée ${i + 2} sur ${k} dans la même eau`, min: 0.5 },
        { ...cook, text: `${cook.text} (fournée ${i + 2})` },
      ]).flat();
      phases.splice(at, 0, ...more);
    }
    m.src = { ...src, phases, text: `${src.text} En ${k} fournées dans la même eau : ${m.base!.info.label} n'y tiennent pas d'un coup.` };
    m.dur += extra;
    m.hobDur += extra;
    m.act += 0.5 * (k - 1);
    m.notes.push(`${m.base!.info.label[0].toUpperCase()}${m.base!.info.label.slice(1)} en ${k} fournées : ${article(shortName(big.id, big.name)!).toLowerCase()} n'en prend pas plus d'un coup.`);
    return true;
  };
  const noPot = (m: Work) => errors.push({ kind: "unknown_equipment", message: `${recipes[m.r].name}, étape ${m.order} : il faut un récipient d'environ ${fmtL(baseLoad([m]).liters)} pour ${m.base!.info.label} et la cuisine n'en a pas d'assez grand.`, stepIds: [m.id] });
  for (const [key, members] of groups) {
    // Minutes où les autres étapes de la session tiennent chaque récipient : à éviter (on attendrait qu'il se libère).
    const busy = new Map<string, number>();
    for (const w of works) if (w.vessel && !members.includes(w)) busy.set(w.vessel, (busy.get(w.vessel) ?? 0) + w.dur);
    // Le moins de cuissons d'abord (un récipient de plus pèse plus que toute attente), puis les récipients
    // les moins pris ailleurs, puis les plus petits.
    const cost = (ids: string[]) => ids.length * 1000 + ids.reduce((x, id) => x + (busy.get(id) ?? 0) / 2 + (vesselLiters(eq.get(id)!) ?? 9) / 10, 0);
    const smallest = (ms: Work[]) =>
      pots
        .filter((e) => holdsAll(e.id, ms))
        .sort((a, b) => cost([a.id]) - cost([b.id]))[0]?.id ?? null;
    const recipesIn = new Set(members.map((m) => m.r));
    if (recipesIn.size < 2 || members.length > 5) {
      for (const m of members) {
        if (m.vessel && holdsAll(m.vessel, [m])) continue;
        const v = smallest([m]);
        if (v) {
          const from = m.src!.equipmentId ?? m.vessel!;
          mergeNotes.push(`${recipes[m.r].name} : ${m.base!.info.label} dans ${article(shortName(v, eq.get(v)?.name)!).toLowerCase()} au lieu ${ofArticle(shortName(from)!)}${eq.has(from) ? ` (il faut environ ${fmtL(baseLoad([m]).liters)}, plus que n'en prend ${article(shortName(from)!).toLowerCase()})` : " (absent de ta cuisine)"}.`);
          moveTo(m, v);
        } else if (!inBatches(m) && !m.vessel) noPot(m);
      }
      continue;
    }
    // Partage en cuissons : le moins de récipients, les moins pris ailleurs (leurs minutes d'occupation), puis
    // les plus petits. Une recette seule dans sa cuisson garde son récipient s'il la tient.
    const found: { parts: Map<string, Work[]>; score: number }[] = [];
    const assign = (i: number, acc: Map<string, Work[]>) => {
      if (i === members.length) {
        const score = cost([...acc.keys()]) + [...acc].filter(([id, ms]) => ms.length === 1 && ms[0].vessel !== id).length * 10;
        if (!found.length || score < found[0].score - EPS) found[0] = { parts: new Map([...acc].map(([k, v]) => [k, [...v]])), score };
        return;
      }
      for (const p of pots) {
        const cur = acc.get(p.id) ?? [];
        if (!holdsAll(p.id, [...cur, members[i]])) continue;
        acc.set(p.id, [...cur, members[i]]);
        assign(i + 1, acc);
        if (cur.length) acc.set(p.id, cur);
        else acc.delete(p.id);
      }
    };
    assign(0, new Map());
    // Rien à regrouper (chaque recette seule dans son récipient) : chacune garde le sien s'il la tient.
    if (!found.length || [...found[0].parts.values()].every((ms) => ms.length === 1)) {
      for (const m of members) {
        if (m.vessel && holdsAll(m.vessel, [m])) continue;
        const v = smallest([m]);
        if (v) {
          const from = m.src!.equipmentId ?? m.vessel!;
          mergeNotes.push(`${recipes[m.r].name} : ${m.base!.info.label} dans ${article(shortName(v, eq.get(v)?.name)!).toLowerCase()} au lieu ${ofArticle(shortName(from)!)}${eq.has(from) ? ` (il faut environ ${fmtL(baseLoad([m]).liters)}, plus que n'en prend ${article(shortName(from)!).toLowerCase()})` : " (absent de ta cuisine)"}.`);
          moveTo(m, v);
        } else if (!inBatches(m) && !m.vessel) noPot(m);
      }
      continue;
    }
    for (const [vessel, ms] of found[0].parts) {
      if (ms.length === 1 || new Set(ms.map((m) => m.r)).size === 1) {
        for (const m of ms) moveTo(m, vessel);
        continue;
      }
      // Une cuisson pour plusieurs recettes : la plus longue sert de modèle, la première recette la porte.
      const lead = ms.reduce((a, m) => (m.r < a.r ? m : a));
      const model = ms.reduce((a, m) => (m.dur > a.dur ? m : a));
      const info = lead.base!.info;
      const total = ms.reduce((x, m) => x + m.base!.grams, 0);
      const letters = ms.flatMap((m) => m.letters);
      const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}` : xs.join(""));
      let text = relabelBowls(model.src!.text, letterMaps[model.r]);
      const tag = `(bols ${list(letters)} : ${formatQty(total, null)} en tout, pour ${ms.length} recettes)`;
      text = /\(bols? [A-Z]{1,2}\)/.test(text) ? text.replace(/\(bols? [A-Z]{1,2}\)/, tag) : `${info.label[0].toUpperCase()}${info.label.slice(1)} ${tag} : ${text[0].toLowerCase()}${text.slice(1)}`;
      text = swapVesselText(text, model.src!.equipmentId ?? vessel, vessel).replace(/\b(\d+) g rincés\b/, `${Math.round(total)} g rincés`);
      const shared: SharedPortion[] = ms.map((m) => ({
        recipeSlug: input[m.r].slug,
        bowl: m.letters[0] ?? null,
        rawG: Math.round(m.base!.grams),
        cookedG: Math.round((m.base!.grams * info.cookedYield) / 10) * 10,
        share: Math.round((m.base!.grams / total) * 100) / 100,
      }));
      const shareText = `Partage ${info.label === "riz" ? "le riz" : `les ${info.label}`} : ${shared.map((p) => `${formatQty(p.cookedG, null)}${info.cookedYield !== 1 ? " cuit" : ""} pour ${recipes[input.findIndex((r) => r.slug === p.recipeSlug)].name}`).join(", ")}`;
      // La sous-étape qui verse la base cite tous les bols de la cuisson commune (« Riz (bols D et I) + eau »).
      let cited = false;
      const together = (t: string) => (cited ? t : t.replace(/\(bol [A-Z]{1,2}\)|\bbol [A-Z]{1,2}\b/, (m) => ((cited = true), m.startsWith("(") ? `(bols ${list(letters)})` : `bols ${list(letters)}`)));
      const phases: StepPhase[] = [...(model.src!.phases ?? []).map((p) => ({ ...p, text: together(relabelBowls(p.text, letterMaps[model.r])) })), { text: shareText, min: SHARE_MIN }];
      lead.out = { text: `${text} ${shareText}.`, phases, shared };
      lead.src = { ...model.src!, equipmentId: vessel, text: model.src!.text };
      lead.dur = model.dur + SHARE_MIN;
      lead.act = model.act + SHARE_MIN;
      lead.refDur = model.refDur != null ? model.refDur + SHARE_MIN : undefined;
      lead.vessel = vessel;
      ownLock(lead);
      lockNames.set(lead.lock!, list(ms.map((m) => recipes[m.r].name)));
      lead.hobCandidates = hobsFor(vessel, text);
      lead.needsHob = lead.hobCandidates.length > 0;
      lead.hobDur = lead.dur;
      lead.letters = letters;
      lead.base = { ...lead.base!, grams: total, key };
      for (const m of ms) if (m !== lead) merged.set(m, lead);
      lead.deps = ms.flatMap((m) => m.deps);
      lead.notes.push(`Une seule cuisson de ${info.label} pour ${list(ms.map((m) => recipes[m.r].name))}.`);
      mergeNotes.push(`${info.label[0].toUpperCase()}${info.label.slice(1)} : une seule cuisson pour ${list(ms.map((m) => recipes[m.r].name))} (${formatQty(total, null)} dans ${article(shortName(vessel, eq.get(vessel)?.name)!).toLowerCase()}), puis le partage.`);
    }
  }
  if (merged.size) {
    const kept = works.filter((w) => !merged.has(w));
    for (const w of kept) {
      const seen = new Set<string>();
      w.deps = w.deps
        .map((d) => ({ ...d, w: merged.get(d.w) ?? d.w }))
        .filter((d) => d.w !== w && !seen.has(`${d.w.id}|${d.type}`) && Boolean(seen.add(`${d.w.id}|${d.type}`)));
    }
    // Ordre du tableau : chaque étape après celles qu'elle attend (une cuisson partagée attend aussi les autres recettes).
    const sorted: Work[] = [];
    const done = new Set<Work>();
    while (sorted.length < kept.length) {
      const next = kept.find((w) => !done.has(w) && w.deps.every((d) => done.has(d.w))) ?? kept.find((w) => !done.has(w))!;
      done.add(next);
      sorted.push(next);
    }
    works.splice(0, works.length, ...sorted);
  }

  // Volumes : ce que chaque étape met dans son récipient (et ce que le récipient offre).
  const isPot = (id: string) => kindOf(id) === "pot";
  const isPan = (id: string) => kindOf(id) === "pan";
  const loadsOf = input.map((r) => stepLoads(r, isPot, isPan));
  const loadOfWork = (w: Work): StepLoad | null => {
    if (w.base?.batches) return { liters: baseLiters(w.base.info, w.base.method, w.base.grams / w.base.batches / 1000), mode: "boil" };
    return w.out && w.base ? baseLoad([w]) : (loadsOf[w.r].get(w.order - 1) ?? null);
  };

  // Attention : la chronologie de chaque étape (mains, surveille, libre) et ses intervalles « mains ».
  for (const w of works) {
    const src = w.src!;
    w.tl = stepTimeline({ kind: src.kind, text: w.out?.text ?? src.text, phases: w.out?.phases ?? src.phases }, w.dur, w.act, (w.needsHob && !w.usesOven) || Boolean(w.hobBraise));
    w.hands = w.tl.hands;
  }

  // ─── À deux : les gestes de prep deviennent des tâches du fil ───
  const prepWorks: Work[] = [];
  if (thread) {
    const firstCook = new Map<string, Work>();
    for (const w of works) if (!firstCook.has(input[w.r].slug)) firstCook.set(input[w.r].slug, w);
    const bowlUsers = new Map<string, Work[]>();
    for (const w of works) for (const l of w.letters) bowlUsers.set(l, [...(bowlUsers.get(l) ?? []), w]);
    for (const t of prepTasks) {
      const slugs = t.kind === "cut" ? [...new Set(t.items.map((i) => i.recipeSlug))] : [t.recipeSlug!];
      const pw: Work = {
        id: `prep:${t.id}`,
        r: Math.min(...slugs.map((s) => input.findIndex((r) => r.slug === s))),
        order: 0,
        src: null,
        prep: t,
        letters: [],
        hands: t.minutes > 0 ? [[0, t.minutes]] : [],
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
  // Les mains de chacun : intervalles déjà pris (une tâche « mains » à la fois, src/lib/session/attention.ts).
  const hold = new Map<Person, [number, number][]>(persons.map((p) => [p, []]));
  const SHIFTS = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2];
  /**
   * Les mains de `w` si elle démarre à `t` pour `p` (avec `extra` déjà pris) : un geste court glisse un peu s'il
   * le faut, sinon null. Le dernier geste qui recule allonge l'étape (`ext`, lu par extOf).
   */
  const fit = (p: Person, w: Work, t: number, extra: [number, number][] = []): [number, number][] | null => {
    const taken = [...hold.get(p)!, ...extra];
    const out: [number, number][] = [];
    for (let i = 0; i < w.hands.length; i++) {
      const [a, b] = w.hands[i];
      const sl = w.tl?.slack[i] ?? { lo: 0, hi: 0 };
      const d = SHIFTS.find((x) => x >= sl.lo - EPS && x <= sl.hi + EPS && !intervalsOverlap([[t + a + x, t + b + x]], [...taken, ...out], EPS));
      if (d == null) return null;
      out.push([t + a + d, t + b + d]);
    }
    return out;
  };
  /** De combien le dernier geste, reculé, allonge l'étape. */
  const extOf = (w: Work, t: number, ivs: [number, number][]) => {
    const i = w.hands.length - 1;
    if (i < 0 || !ivs[i] || w.tl?.slack[i]?.phase !== (w.tl?.phases.length ?? 0) - 1) return 0;
    return Math.max(0, ivs[i][0] - (t + w.hands[i][0]));
  };
  /** Quelqu'un peut-il prendre `x` à `d`, si `p` prend aussi `extra` ? */
  const someoneFor = (x: Work, d: number, p: Person, extra: [number, number][]) => persons.some((q) => fit(q, x, d, q === p ? extra : []) != null);
  const lastPersonOf = new Map<number, Person>(); // recette → dernière personne à son fil
  const hobRes: { hob: string; from: number; to: number; w: Work }[] = [];
  const ovenRes: { temp: number; from: number; to: number; w: Work }[] = [];
  const locks = new Map<string, { owner: number; left: number; releasedAt: number | null; lastEnd: number }>();
  const usesLeft = new Map<string, number>();
  const lockOf = (w: Work) => w.lock ?? w.r;
  for (const w of works) if (w.vessel) usesLeft.set(`${lockOf(w)}|${w.vessel}`, (usesLeft.get(`${lockOf(w)}|${w.vessel}`) ?? 0) + 1);
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
    if (!w.hands.length) return w.contOf?.w.person ?? lastPersonOf.get(w.r) ?? "A";
    const free = persons.filter((p) => fit(p, w, t) != null);
    if (!free.length) return null;
    const pref = [w.contOf?.w.person, ...w.deps.filter((d) => d.w.src && d.w.r === w.r).map((d) => d.w.person), lastPersonOf.get(w.r)].filter((p): p is Person => Boolean(p));
    return pref.find((p) => free.includes(p)) ?? free[0];
  };

  const tryPlace = (w: Work, t: number) => {
    const person = pickPerson(w, t);
    if (!person) return null;
    // À deux, un geste de prep ne doit pas retarder une étape plus urgente qui devient prête pendant qu'on le fait.
    const mine = fit(person, w, t) ?? [];
    const handsEnd = mine.length ? mine[mine.length - 1][1] : t;
    const ext = extOf(w, t, mine);
    const dur = w.dur + ext;
    const hobDur = w.hobDur + (w.hobDur >= w.dur - EPS ? ext : 0);
    if (thread && w.prep) {
      for (const x of pending) {
        if (x === w || !x.hands.length || x.tail <= w.tail) continue;
        const d = depTime(x);
        if (d == null || d <= t + EPS || d >= handsEnd - EPS) continue;
        if (!someoneFor(x, d, person, mine)) return null;
        // La personne qui tient le récipient le garde (pas de relais pour un geste de prep).
        if ((x.contOf?.w.person ?? (x.src ? lastPersonOf.get(x.r) : undefined)) === person) return null;
      }
    }
    // Une suite qui tombe à l'heure (« à 1 h de braisage, ajoute les champignons ») n'attend
    // jamais : on ne commence pas un geste qui occuperait la dernière personne libre à ce moment.
    if (mine.length) {
      for (const x of pending) {
        if (x === w || !x.contOf || !x.hands.length) continue;
        const d = depTime(x);
        if (d == null || d <= t + EPS || d >= handsEnd - EPS) continue;
        if (!someoneFor(x, d, person, mine)) return null;
      }
    }
    // À deux, un récipient partagé ne part pas chez une recette moins pressée quand l'étape
    // la plus urgente qui le demande devient prête pendant qu'il serait pris (la poêle
    // du chasseur, quand le forno pourrait la prendre une minute avant).
    if (thread && w.vessel && !w.contOf && locks.get(w.vessel)?.owner !== lockOf(w)) {
      for (const x of pending) {
        if (x === w || x.r === w.r || x.vessel !== w.vessel || x.tail <= w.tail + 15) continue;
        const d = depTime(x);
        if (d != null && d > t + EPS && d < t + w.dur - EPS) return null;
      }
    }
    let washFrom: string | null = null;
    if (w.vessel) {
      const lock = locks.get(w.vessel);
      if (lock && lock.owner !== lockOf(w)) {
        if (lock.releasedAt == null || t < lock.releasedAt + WASH_MIN - EPS) return null;
        washFrom = lockNames.get(lock.owner) ?? recipes[lock.owner].name;
      }
    }
    let hobId: string | null = null;
    if (w.needsHob) {
      const contHob = w.contOf?.type === "hob" ? w.contOf.w.hobId : null;
      // Essai « foyer malin » : garder libres les foyers que des récipients moins accommodants attendent.
      const demand = (h: string) => [...pending].filter((x) => x !== w && x.needsHob && x.hobCandidates.length < w.hobCandidates.length && x.hobCandidates.includes(h)).length;
      const cands = contHob ? [contHob] : tr.smartHob ? [...w.hobCandidates].sort((a, b) => demand(a) - demand(b)) : w.hobCandidates;
      hobId = cands.find((h) => !hobRes.some((x) => x.hob === h && x.w !== w.contOf?.w && overlaps(t, t + hobDur, x.from, x.to))) ?? null;
      if (!hobId) return null;
    }
    let oven: PlanStep["oven"] = null;
    let needPreheat = false;
    if (w.usesOven && w.ovenTemp != null) {
      const from = t + (w.needsHob ? hobDur : 0);
      const to = Math.max(from, t + dur);
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
    return { hobId, oven, needPreheat, washFrom, person, tools, hands: mine, dur, hobDur };
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
        if (p.hands.length) hold.get(p.person)!.push(...p.hands);
        w.placed = p.hands;
        w.dur = p.dur;
        w.hobDur = p.hobDur;
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
          const key = `${lockOf(w)}|${w.vessel}`;
          const left = (usesLeft.get(key) ?? 1) - 1;
          usesLeft.set(key, left);
          const lock = locks.get(w.vessel);
          const lastEnd = Math.max(lock && lock.owner === lockOf(w) ? lock.lastEnd : 0, t + w.dur);
          locks.set(w.vessel, { owner: lockOf(w), left, releasedAt: left === 0 ? lastEnd : null, lastEnd });
        }
        pending.delete(w);
        placed = true;
        break; // on recalcule les étapes prêtes (la personne est peut-être occupée)
      }
    }
    if (!pending.size) break;
    const ends = [...hold.values()].flat().map(([, b]) => b).filter((e) => e > t + EPS);
    const deps = new Map([...pending].map((w) => [w, depTime(w)]));
    const times = [
      ...ends,
      // Une étape prête dont un moment « mains » tombe plus tard : elle peut partir quand ce moment tombe juste après une tâche.
      ...[...pending].flatMap((w) => (deps.get(w) != null && deps.get(w)! <= t + EPS ? w.hands.filter(([a]) => a > EPS).flatMap(([a]) => ends.map((e) => e - a)) : [])),
      ...hobRes.map((x) => x.to),
      ...ovenRes.map((x) => x.to),
      ...knives.map((k) => k.until),
      ...boards.flatMap((b) => [b.until, b.until + WASH_MIN]),
      ...[...locks.values()].map((l) => (l.releasedAt != null ? l.releasedAt + WASH_MIN : NaN)),
      ...[...deps.values()].map((d) => d ?? NaN),
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
    // Une étape de cuisson qui démarre entre deux gestes coupe le moment (le bol qu'elle prend est prêt avant).
    const from = last ? last[0].start! : -Infinity;
    const cut = works.some((x) => x.start != null && x.start > from + EPS && x.start < w.start! + EPS);
    if (prev && w.start! <= prev.start! + prev.dur + 0.5 && !cut) last.push(w);
    else blocks.push([w]);
  }
  const small = blocks.filter((b) => b.reduce((x, w) => x + w.dur, 0) < MIN_BLOCK - EPS).flatMap((b) => b.map((w) => w.prep!.id));

  // ─── Ingrédients de chaque étape : quantités mises à l'échelle, bol d'origine, sous-étape ───
  const byLetter = new Map<string, { r: number; ing: PlannerIngredient }[]>();
  input.forEach((r, ri) => {
    for (const ing of r.ingredients) {
      const l = ing.group ? letterMaps[ri].get(ing.group) : undefined;
      if (l) byLetter.set(l, [...(byLetter.get(l) ?? []), { r: ri, ing }]);
    }
  });
  const looseDone = new Set<PlannerIngredient>();
  const stepIngredients = (w: Work, text: string, phases: StepPhase[] | undefined): StepIngredient[] => {
    const out: StepIngredient[] = [];
    const phaseOf = (letter: string) => {
      const i = (phases ?? []).findIndex((p) => mentionsBowl(p.text, letter));
      return i >= 0 ? i : null;
    };
    const one = (ri: number, ing: PlannerIngredient, bowl: string | null, phase: number | null): StepIngredient => {
      const scale = input[ri].scale ?? 1;
      const grams = ing.grams != null ? ing.grams * scale : null;
      const units = ing.units != null ? ing.units * scale : null;
      return { item: ing.item, name: parseGesture(ing.item).base, food: ing.foodId ?? null, grams, units, qty: formatQty(grams, units), bowl, recipeSlug: input[ri].slug, ...(ing.optional ? { optional: true } : {}), phase };
    };
    for (const l of w.letters) for (const { r: ri, ing } of byLetter.get(l) ?? []) out.push(one(ri, ing, l, phaseOf(l)));
    // Hors bol (« huile », « le porc et son jus ») : la première étape de la recette qui le nomme.
    if (!w.out) {
      const all = `${text} ${(phases ?? []).map((p) => p.text).join(" ")}`.toLowerCase();
      for (const ing of input[w.r].ingredients) {
        if (ing.group || looseDone.has(ing)) continue;
        const names = parseGesture(ing.item).base.toLowerCase().split(/[^\p{L}]+/u).filter((x) => x.length >= 3 && !["pour", "les", "des", "avec", "sans", "frais", "fraîche"].includes(x));
        if (!names.some((x) => new RegExp(`(?<!\\p{L})${x}`, "u").test(all))) continue;
        looseDone.add(ing);
        const i = (phases ?? []).findIndex((p) => names.some((x) => p.text.toLowerCase().includes(x)));
        out.push(one(w.r, ing, null, i >= 0 ? i : null));
      }
    }
    return out;
  };
  /** Les ingrédients d'un geste de prep glissé dans la cuisson (sous-étape `phase`). */
  const taskIngredients = (t: PrepTask, phase: number): StepIngredient[] => {
    if (t.kind === "cut") return t.items.map((i) => ({ item: `${i.item}, ${i.gesture}`, name: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, qty: i.qty, bowl: i.bowl, recipeSlug: i.recipeSlug, phase }));
    if (t.kind === "weigh") return (t.bowls ?? []).flatMap((l) => (byLetter.get(l) ?? []).filter(({ ing }) => !parseGesture(ing.item).gesture)).map(({ r: ri, ing }) => {
      const scale = input[ri].scale ?? 1;
      const grams = ing.grams != null ? ing.grams * scale : null;
      const units = ing.units != null ? ing.units * scale : null;
      return { item: ing.item, name: parseGesture(ing.item).base, food: ing.foodId ?? null, grams, units, qty: formatQty(grams, units), bowl: t.bowls?.[0] ?? null, recipeSlug: input[ri].slug, phase };
    });
    return [];
  };
  // Four : où étaler ce qui rôtit en une couche (plaques et plats libres), et si ça tient.
  const ovenDishes = res.equipment.filter((e) => e.kind === "dish" && res.fits.some((f) => f.equipmentId === e.id && f.hobId === "oven"));
  const roastOn = (w: Work, text: string): PlanStep["dishes"] | null => {
    if (!w.usesOven || w.src!.kind !== "bake" || w.src!.equipmentId !== "oven" || !w.letters.length || !/étal|rôti|plaque|une couche/i.test(text)) return null;
    const grams = w.letters.flatMap((l) => byLetter.get(l) ?? []).reduce((x, { r: ri, ing }) => x + gramsOfIngredient(ing, input[ri].scale ?? 1), 0);
    const need = Math.round(grams / ROAST_G_PER_CM2);
    const others = new Set(input.flatMap((r, ri) => (ri === w.r ? [] : r.steps.map((x) => x.equipmentId).filter(Boolean))));
    const free = ovenDishes
      .filter((e) => !others.has(e.id))
      .flatMap((e) => Array.from({ length: Math.max(1, e.count ?? 1) }, () => ({ id: e.id, area: dishArea(e) ?? 0 })))
      .filter((d) => d.area > 0)
      .sort((a, b) => b.area - a.area);
    const ids: string[] = [];
    let have = 0;
    for (const d of free) {
      if (have >= need) break;
      ids.push(d.id);
      have += d.area;
    }
    return { ids, needCm2: need, haveCm2: have };
  };

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
          // Les fournées que la fiche découpe déjà (sous-étapes numérotées) font foi : la sauce versée à la fin ne se saisit pas.
          const said = Math.max(0, ...(src.phases ?? []).map((p) => p.batch ?? 0));
          batches = said >= 2 ? said : Math.ceil(g / max);
          if (!/fournée/i.test(src.text)) {
            warnings.push(`${r.name}, étape ${w.order} : ${Math.round(g)} g dans ${article(shortName(w.vessel)!)}, prévois ${batches} fournées (${max} g au plus).`);
          }
        }
      }
      const hob = hobRes.find((x) => x.w === w);
      const ov = ovenRes.find((x) => x.w === w);
      let text = w.out ? w.out.text : relabelBowls(src.text, letterMaps[w.r]);
      let hobLevel = w.needsHob ? (src.hobLevel ?? null) : null;
      let hobLevelLabel: string | null = null;
      if (w.hobBraise) {
        text = text.replace(/,?\s*puis au four\b/i, ", puis couvercle et niveau 2-3 sur la plaque").replace(/\bremets au four\b/i, "remets le couvercle, niveau 2-3,");
        hobLevelLabel = src.hobLevel != null ? `${src.hobLevel} puis ${HOB_BRAISE_LEVEL}` : HOB_BRAISE_LEVEL;
        hobLevel = src.hobLevel ?? 2;
      }
      // Le foyer du texte suit le foyer choisi (« sur le foyer moyen » quand la cocotte n'entre que sur le grand).
      text = rewriteHob(text, w.hobId ? eq.get(w.hobId)?.name : null);
      const srcPhases = w.out ? w.out.phases : (src.phases ?? []).map((p) => ({ ...p, text: relabelBowls(p.text, letterMaps[w.r]) }));
      const phases: StepPhase[] = srcPhases.map((p, i) => {
        const tp = w.tl?.phases[i];
        return { text: p.text, min: p.min, hobLevel: p.hobLevel ?? null, batch: p.batch ?? null, ...(p.wait ? { wait: true } : {}), ...(tp ? { attention: tp.attention, ...(tp.reminder ? { reminder: tp.reminder } : {}) } : {}) };
      });
      // Un geste court glissé (« Inverse les plats » 1 min plus tard) : l'attente d'avant s'allonge, celle d'après raccourcit.
      (w.placed ?? []).forEach(([a], i) => {
        const sl = w.tl?.slack[i];
        const d = a - (w.start! + w.hands[i][0]);
        if (!sl || Math.abs(d) < EPS || sl.phase <= 0 || !phases[sl.phase - 1]) return;
        phases[sl.phase - 1].min = Math.round((phases[sl.phase - 1].min + d) * 100) / 100;
        if (phases[sl.phase + 1]) phases[sl.phase + 1].min = Math.round((phases[sl.phase + 1].min - d) * 100) / 100;
      });
      const step: PlanStep = {
        id: w.id,
        no: 0,
        recipeSlug: r.slug,
        order: w.order,
        kind: src.kind,
        text,
        cue: src.cue ?? null,
        ...(phases.length ? { phases } : {}),
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
        bowls: w.letters,
        batches,
        notes: w.notes,
        ...(full ? splitTitle(text) : {}),
        attention: w.tl?.attention ?? "libre",
        hands: w.placed ?? w.hands.map(([a, b]) => [w.start! + a, w.start! + b] as [number, number]),
        reminders: w.tl?.reminders ?? [],
        ...(full ? { ingredients: stepIngredients(w, text, phases) } : {}),
      };
      if (w.base) step.base = w.base.info.label;
      if (w.base?.batches) step.batches = w.base.batches;
      if (w.out) step.shared = w.out.shared;
      if (hobLevelLabel) step.hobLevelLabel = hobLevelLabel;
      // Volume : ce que met l'étape dans son récipient, et ce qu'il offre (remplissage compris).
      const ld = full && w.vessel && isPot(w.vessel) ? loadOfWork(w) : null;
      if (ld && w.vessel) {
        const usable = usableLiters(eq.get(w.vessel)!, ld.mode);
        step.load = { liters: Math.round(ld.liters * 100) / 100, usableL: usable == null ? null : Math.round(usable * 100) / 100, mode: ld.mode };
        if (usable != null && ld.liters > usable + 0.05) {
          warnings.push(`${r.name}, étape ${w.order} : environ ${fmtL(ld.liters)} dans ${article(shortName(w.vessel, eq.get(w.vessel)?.name)!).toLowerCase()}, qui n'en prend que ${fmtL(usable)} à ce stade, et aucun récipient plus grand n'est libre : fais-le en deux fois.`);
        }
      }
      const dishes = full ? roastOn(w, text) : null;
      if (dishes) {
        step.dishes = dishes;
        const names = dishes.ids.map((id) => article(shortName(id, eq.get(id)?.name)!).toLowerCase());
        if (dishes.haveCm2 >= dishes.needCm2) step.notes = [...step.notes, `Étale en une couche sur ${[...new Set(names)].join(" et ")}${names.length > new Set(names).size ? ` (${names.length})` : ""}.`];
        else warnings.push(`${r.name}, étape ${w.order} : ${formatQty(Math.round(dishes.needCm2 * ROAST_G_PER_CM2), null)} à rôtir en une couche demandent environ ${dishes.needCm2} cm², tes plaques et plats libres en offrent ${dishes.haveCm2} : serre (ça rôtira moins) ou fais deux fournées.`);
      }
      if (w.refDur != null) step.refDurationMin = w.refDur;
      if (duo) step.person = w.person ?? null;
      return step;
    });
  if (shift) {
    for (const st of steps) {
      st.startMin -= shift;
      st.endMin -= shift;
      if (st.hobUntilMin != null) st.hobUntilMin -= shift;
      if (st.hands) st.hands = st.hands.map(([a, b]) => [a - shift, b - shift]);
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
      title: `Pendant que ça cuit : ${tasks.length > 1 ? `${tasks.length} gestes de prep` : "un geste de prep"}`,
      detail: `${names.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()),
      attention: "mains",
      // Les gestes un à un : entre deux, une autre étape peut prendre les mains (retourner un plat).
      hands: b.map((w) => [w.start! - shift, w.start! - shift + w.dur] as [number, number]),
      reminders: [],
      ingredients: tasks.flatMap((t, i) => taskIngredients(t, i)),
      cue: null,
      phases: tasks.map((t) => ({ text: gestureText(t), min: t.minutes, attention: "mains" as const })),
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
      title: `Allume le four à ${p.temp} °C`,
      detail: `Chaleur tournante, ${PREHEAT_MIN} min de préchauffage, pour : ${recipes[p.before.r].name}.`,
      attention: "libre",
      hands: [],
      reminders: [],
      ingredients: [],
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
    const s = steps.find((x) => !x.tasks && (x.recipeSlug === b.recipeSlug || x.shared?.some((p) => p.recipeSlug === b.recipeSlug)) && x.bowls.includes(b.letter));
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

  // ─── Contenants : chaque groupe dans un vrai bol de la cuisine, réutilisé dès qu'il est libre ───
  const workOf = new Map(works.map((w) => [w.id, w]));
  const releaseOf = (letter: string): number => {
    let at = -Infinity;
    for (const st of steps) {
      const w = workOf.get(st.id);
      if (!w || !st.bowls.includes(letter)) continue;
      const i = (st.phases ?? []).findIndex((p) => mentionsBowl(p.text, letter));
      // Sans sous-étape qui le cite : au début si le texte le cite tôt, sinon à la fin (prudent).
      const off = i >= 0 ? (w.tl?.phases[i]?.fromMin ?? 0) : st.text.indexOf(`bol ${letter}`) >= 0 && st.text.indexOf(`bol ${letter}`) < st.text.length * 0.4 ? 0 : st.durationMin;
      at = Math.max(at, st.startMin + off);
    }
    return Number.isFinite(at) ? at : 0;
  };
  const togetherOf = (letter: string): string | null => {
    const st = steps.find((x) => !x.tasks && x.bowls.includes(letter));
    const i = (st?.phases ?? []).findIndex((p) => mentionsBowl(p.text, letter));
    return st && i >= 0 ? `${st.id}|${i}` : null;
  };
  const needs: BowlNeed[] = bowls.map((b) => {
    const info = bowlInfo.get(b.letter)!;
    let fillAt = -Infinity;
    if (duo && b.tasks?.length) fillAt = Math.min(...prepTasks.filter((t) => b.tasks!.includes(t.id) && t.startMin != null).map((t) => t.startMin!), Infinity);
    if (interleave && b.during?.length) fillAt = Math.min(...b.during.map((d) => steps.find((x) => x.id === d.stepId)?.startMin ?? Infinity));
    return { letter: b.letter, recipeSlug: b.recipeSlug, liters: info.liters, fillAt: Number.isFinite(fillAt) ? fillAt : -Infinity, releaseAt: releaseOf(b.letter), content: info.content, moment: info.moment, together: togetherOf(b.letter), fridge: Boolean(b.fridge) };
  });
  const inventory = inventoryOf(res.equipment);
  const alloc = full ? allocateBowls(needs, inventory) : { places: new Map(), peak: 0, used: 0, missing: [] as string[] };
  for (const b of bowls) {
    const p = alloc.places.get(b.letter);
    b.liters = bowlInfo.get(b.letter)!.liters;
    if (!p) continue;
    b.holder = p.holder;
    b.container = p.container;
    b.containerLabel = p.label;
    if (p.with?.length) b.with = p.with;
    if (p.fillAfter) b.fillAfter = p.fillAfter;
  }
  for (const st of steps) for (const i of st.ingredients ?? []) if (i.bowl) i.holder = alloc.places.get(i.bowl)?.holder ?? null;
  const owned = inventory.reduce((x, k) => x + k.count, 0);
  const containers: PlanContainers = {
    used: alloc.used,
    peak: alloc.peak,
    owned,
    moment: bowls.filter((b) => b.holder === "moment").length,
    plates: bowls.filter((b) => b.holder === "assiette").length,
    missing: alloc.missing,
  };
  const storage = res.equipment.find((e) => e.kind === "container" && e.dimsJson?.role === "frigo");
  if (storage) containers.storage = { count: Math.max(0, storage.count ?? 0), liters: storage.capacityL ?? 1 };
  if (alloc.missing.length) warnings.push(`Il manque ${alloc.missing.length} bol${alloc.missing.length > 1 ? "s" : ""} (${alloc.missing.map((l) => `bol ${l}`).join(", ")}) : ta cuisine en a ${owned}, la session en demande ${alloc.peak} en même temps. Une boîte, un plat ou une casserole propre fera l'affaire.`);
  const late = bowls.filter((b) => b.fillAfter);
  if (late.length) prepNotes.push(`Pas assez de bols pour tout préparer d'avance : ${late.map((b) => `remplis le bol ${b.letter} quand le bol ${b.fillAfter} est vidé`).join(", ")}.`);

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
    containers,
  };
  if (duo) {
    plan.persons = persons;
    plan.handoffs = handoffs;
  }
  if (mergeNotes.length) plan.decisions = mergeNotes;
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

  // Les mains : jamais deux moments « mains » en même temps pour une personne (plans avec `hands`).
  if (plan.mode !== "duo" && plan.steps.some((s) => s.hands)) {
    const busy = plan.steps.filter((s) => s.hands?.length);
    for (let i = 0; i < busy.length; i++)
      for (let j = i + 1; j < busy.length; j++) {
        const a = busy[i];
        const b = busy[j];
        if (!intervalsOverlap(a.hands!, b.hands!, EPS)) continue;
        issues.push({ kind: "hands_busy", message: `Deux choses à faire de ses mains en même temps (${label(a)} et ${label(b)}).`, stepIds: [a.id, b.id] });
      }
  }
  // À deux : chaque personne fait une chose à la fois ; un ustensile ne sert qu'à un geste à la fois.
  if (plan.mode === "duo") {
    const acts: { id: string; who: string; from: number; to: number; label: string }[] = [
      ...plan.steps
        .filter((s) => s.person && (s.hands ? s.hands.length : s.activeMin > EPS))
        .flatMap((s) => (s.hands ?? [[s.startMin, s.startMin + s.activeMin]]).map(([from, to]) => ({ id: s.id, who: s.person!, from, to, label: label(s) }))),
      ...(plan.prep?.tasks ?? [])
        .filter((t) => t.person && t.startMin != null)
        .map((t) => ({ id: `prep:${t.id}`, who: t.person!, from: t.startMin!, to: t.startMin! + t.minutes, label: `prep · ${t.title}` })),
    ];
    const seenPairs = new Set<string>();
    for (let i = 0; i < acts.length; i++)
      for (let j = i + 1; j < acts.length; j++) {
        const a = acts[i];
        const b = acts[j];
        if (a.id === b.id || a.who !== b.who || !overlaps(a.from, a.to, b.from, b.to) || seenPairs.has(`${a.id}|${b.id}`)) continue;
        seenPairs.add(`${a.id}|${b.id}`);
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

const POT_ID = /^(casserole|faitout|cocotte)/;
/** Le genre d'un équipement (pot, pan, dish…), même absent de la cuisine (d'après son id standard). */
function kindOfIn(res: PlannerResources, id: string): string | undefined {
  return res.equipment.find((e) => e.id === id)?.kind ?? (POT_ID.test(id) ? "pot" : id.startsWith("poele") ? "pan" : id.startsWith("plat") ? "dish" : undefined);
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

/** « du grand plat », « de la cocotte », « de l'air fryer ». */
function ofArticle(name: string) {
  const a = article(name).toLowerCase();
  return a.startsWith("le ") ? `du ${a.slice(3)}` : `de ${a}`;
}

/** « le faitout », « la cocotte », « l'air fryer » : le nom d'un récipient avec son article. */
export function article(name: string) {
  return /^(Poêle|Cocotte|Casserole|Petite|Grande|Planche|Seconde|Plaque)/.test(name) ? `la ${name}` : /^[AEIOUYÉ]/.test(name) ? `l'${name}` : `le ${name}`;
}

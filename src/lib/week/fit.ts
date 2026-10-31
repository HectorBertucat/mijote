// Objectifs → recettes : à quel point une recette, puis une sélection, tombe dans le repère d'un
// repas de chacun (src/lib/eaters). Module pur, sans accès à la base (tests/fit.test.ts).
//
// Règles :
// - la part est celle que l'appli servira (portionOf : visée au milieu du repère en kcal, au demi
//   près, bornée entre 60 % et 160 % de la part de base) ; le score ne change pas la répartition ;
// - le repère d'un repas déduit déjà le hors batch (habitudes : shaker, petit-déjeuner), donc une
//   habitude protéinée baisse ce qu'un repas doit apporter ;
// - « au mieux » : la part poussée jusqu'au haut du repère en kcal (dans ses bornes). Une recette
//   pauvre en protéines n'atteint pas le bas du repère même là : c'est ce qu'on détecte, une
//   quantité qui ne peut pas être bien calée ;
// - niveaux : « bien » (kcal dans le repère, protéines au moins au bas ; au-dessus ne gêne pas ;
//   des kcal un peu hors du repère par le seul arrondi au demi ne comptent pas, seulement une part
//   bloquée à sa borne),
//   « juste » (un petit écart : une part un peu plus grande suffirait, ou moins de 6 g ou 10 % de
//   kcal), « loin » (le reste) ;
// - sélection : protéines et kcal moyens d'un repas de chacun, pondérés par les repas que chaque
//   recette lui sert ; on n'avertit que d'un écart notable (≥ 5 g de protéines ou ≥ 60 kcal par
//   repas), avec une suggestion vérifiée en code : la recette de la bibliothèque qui le réduit le
//   plus sans être loin pour les autres, sinon un complément hors batch chiffré.
import { PORTION_MAX_RATIO, PORTION_MIN_RATIO, PORTION_STEP, portionOf, type DayTarget, type MealRef, type Outside } from "@/lib/eaters/core";
import { FOODS } from "@/lib/nutrition/foods";

export type FitLevel = "bien" | "juste" | "loin";
export type FitIssue = "proteines" | "trop-riche" | "trop-leger";

/** Une personne vue par le score : sa part de base, son repère, ce qu'elle prend hors batch. */
export interface FitEater {
  id: string;
  name: string;
  baseUnits: number;
  ref: MealRef | null;
  dayTarget?: DayTarget | null;
  outside?: Outside | null;
  hasShaker?: boolean;
}

export interface FitRecipe {
  slug: string;
  name: string;
  kcalUnit: number | null;
  proteinUnit: number | null;
  status?: string;
}

export interface RecipeFit {
  personId: string;
  name: string;
  /** null : pas de repère ou macros inconnues. */
  level: FitLevel | null;
  issue: FitIssue | null;
  units: number;
  kcal: number | null;
  protein: number | null;
  /** Protéines de la part poussée au haut du repère en kcal, dans ses bornes. */
  proteinBest: number | null;
  /** Écart en points (20 kcal ou 2 g de protéines manquants = 1) : pour trier. */
  points: number;
}

/** Petits écarts tolérés en « juste ». */
const JUST_PROTEIN_G = 6;
const JUST_KCAL_RATIO = 0.1;

const floorStep = (x: number) => Math.floor(x / PORTION_STEP + 1e-9) * PORTION_STEP;
const roundStep = (x: number) => Math.round(x / PORTION_STEP) * PORTION_STEP;

/** Bornes d'une part (unités), comme portionUnits. */
function bounds(baseUnits: number) {
  return { lo: Math.max(PORTION_STEP, roundStep(baseUnits * PORTION_MIN_RATIO)), hi: roundStep(baseUnits * PORTION_MAX_RATIO) };
}

/** Protéines au mieux : la plus grande part qui reste sous le haut du repère en kcal. */
function proteinBestOf(e: Pick<FitEater, "baseUnits">, ref: MealRef, r: { kcalUnit: number; proteinUnit: number | null }): number {
  const { lo, hi } = bounds(e.baseUnits);
  const u = Math.min(hi, Math.max(lo, floorStep(ref.kcalMax / r.kcalUnit)));
  return Math.round((r.proteinUnit ?? 0) * u);
}

export function recipeFit(e: FitEater, r: Pick<FitRecipe, "kcalUnit" | "proteinUnit">): RecipeFit {
  const p = portionOf(e, r);
  const base = { personId: e.id, name: e.name, units: p.units, kcal: p.kcal, protein: p.protein };
  if (!e.ref || r.kcalUnit == null || r.kcalUnit <= 0 || p.kcal == null || p.protein == null) return { ...base, level: null, issue: null, proteinBest: null, points: r.kcalUnit == null ? 8 : 0 };
  const t = e.ref;
  const best = proteinBestOf(e, t, { kcalUnit: r.kcalUnit, proteinUnit: r.proteinUnit });
  const short = Math.max(0, t.proteinMin - p.protein);
  // Hors du repère en kcal sans être à une borne : l'arrondi au demi, la meilleure part possible.
  const { lo, hi } = bounds(e.baseUnits);
  const over = p.units <= lo ? Math.max(0, p.kcal - t.kcalMax) : 0;
  const under = p.units >= hi ? Math.max(0, t.kcalMin - p.kcal) : 0;
  const points = (over + under) / 20 + short / 2;
  // L'écart nommé est le plus grand des deux.
  const issue: FitIssue | null = !points ? null : short / 2 >= (over + under) / 20 ? "proteines" : over > 0 ? "trop-riche" : "trop-leger";
  if (!issue) return { ...base, level: "bien", issue, proteinBest: best, points };
  const mid = (t.kcalMin + t.kcalMax) / 2;
  const small = issue === "proteines" ? short <= JUST_PROTEIN_G || best >= t.proteinMin : (over + under) <= mid * JUST_KCAL_RATIO && short <= JUST_PROTEIN_G;
  return { ...base, level: small ? "juste" : "loin", issue, proteinBest: best, points };
}

/**
 * Protéines pour 100 kcal qu'une recette doit apporter pour que la part, calée au milieu du repère
 * en kcal, atteigne le bas du repère en protéines (Atelier : écrire une recette qui tombe bien).
 */
export function densityTarget(ref: MealRef): number {
  return Math.round((ref.proteinMin * 1000) / ((ref.kcalMin + ref.kcalMax) / 2)) / 10;
}

/** La recette pour tout le foyer (les personnes sans repère n'apparaissent pas). */
export function recipeFits(eaters: FitEater[], r: Pick<FitRecipe, "kcalUnit" | "proteinUnit">, excluded?: Set<string>): RecipeFit[] {
  return eaters.filter((e) => e.ref && !excluded?.has(e.id)).map((e) => recipeFit(e, r));
}

const RANK: Record<FitLevel, number> = { bien: 0, juste: 1, loin: 2 };

/** Pour trier la bibliothèque (« Pour nos objectifs ») : le pire niveau, puis l'écart moyen. Plus petit = mieux. */
export function fitRank(fits: RecipeFit[]): number {
  const known = fits.filter((f) => f.level);
  if (!known.length) return fits.length ? 100 : 0;
  const worst = Math.max(...known.map((f) => RANK[f.level!]));
  return worst * 10 + known.reduce((s, f) => s + f.points, 0) / known.length / 10;
}

/** La recette ne s'écarte franchement du repère de personne (filtre « Pour nos objectifs »). */
export const fitsAll = (fits: RecipeFit[]) => fits.length > 0 && fits.every((f) => f.level === "bien" || f.level === "juste");

/** La pastille d'une recette : un mot, seulement quand il dit quelque chose. */
export interface FitBadge {
  tone: "ok" | "warn";
  text: string;
}

export function fitBadge(fits: RecipeFit[]): FitBadge | null {
  const known = fits.filter((f) => f.level);
  if (!known.length) return null;
  const worst = known.filter((f) => f.level === "loin").sort((a, b) => b.points - a.points)[0];
  if (worst) return { tone: "warn", text: `${ISSUE_WORD[worst.issue!]} pour ${worst.name}` };
  const good = known.filter((f) => f.level === "bien");
  if (!good.length) return null;
  return { tone: "ok", text: `Calé pour ${joinNames(good.map((f) => f.name))}` };
}

const ISSUE_WORD: Record<FitIssue, string> = { proteines: "Peu protéiné", "trop-riche": "Trop riche", "trop-leger": "Trop léger" };

const joinNames = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}`);

// ─── Une sélection ───

/** Repas servis : personne → recette → nombre de repas (de la répartition). Absent = parts égales. */
export type Served = Map<string, Map<string, number>>;

export interface PersonWeekFit {
  personId: string;
  name: string;
  /** Repas du batch comptés (macros connues). */
  meals: number;
  /** Un repas moyen : la part de chaque recette, pondérée par les repas qu'elle sert. */
  perMeal: { kcal: number; protein: number } | null;
  ref: MealRef | null;
  /** Un jour moyen : deux repas + hors batch ; null sans cible du jour. */
  perDay: { kcal: number; protein: number } | null;
  dayTarget: DayTarget | null;
  level: FitLevel | null;
  /** Protéines manquantes par repas sous le bas du repère (0 si atteint). */
  proteinShort: number;
  /** kcal par repas au-dessus (+) ou en dessous (−) du repère ; 0 dedans. */
  kcalOff: number;
  /** Même aux parts poussées au haut du repère en kcal, les protéines manquent : la quantité ne peut pas rattraper. */
  stuck: boolean;
}

export interface FitSuggestion {
  /** Une recette de la bibliothèque à ajouter, vérifiée : elle réduit l'écart. */
  recipe: { slug: string; name: string } | null;
  /** Protéines par jour d'un complément hors batch (shaker), arrondies à 5 g. */
  shakerG: number | null;
  text: string;
}

export interface FitWarning {
  personId: string;
  name: string;
  issue: FitIssue;
  /** Le constat, court : « ~46 g de protéines par repas pour 52 visés ». */
  text: string;
  suggestion: FitSuggestion;
}

export interface WeekFit {
  people: PersonWeekFit[];
  warnings: FitWarning[];
  /** Tout le monde avec un repère est dans son repère (« bien » ou « juste »). */
  ok: boolean;
}

/** Seuils d'un écart notable, par repas. */
export const WARN_PROTEIN_G = 5;
export const WARN_KCAL = 60;
/** Recettes au plus dans une semaine (la session ne tient pas au-delà). */
const MAX_RECIPES = 4;

function personWeek(e: FitEater, recipes: FitRecipe[], served: Map<string, number> | undefined): PersonWeekFit {
  const known = recipes.filter((r) => r.kcalUnit != null && r.kcalUnit > 0);
  const weights = known.map((r) => (served ? served.get(r.slug) ?? 0 : 1));
  const n = weights.reduce((s, w) => s + w, 0);
  const empty = { personId: e.id, name: e.name, ref: e.ref, dayTarget: e.dayTarget ?? null, meals: n, proteinShort: 0, kcalOff: 0, stuck: false };
  if (!n) return { ...empty, perMeal: null, perDay: null, level: null };
  let kcal = 0;
  let protein = 0;
  let best = 0;
  known.forEach((r, i) => {
    if (!weights[i]) return;
    const p = portionOf(e, r);
    kcal += p.kcal! * weights[i];
    protein += p.protein! * weights[i];
    if (e.ref) best += proteinBestOf(e, e.ref, { kcalUnit: r.kcalUnit!, proteinUnit: r.proteinUnit }) * weights[i];
  });
  const perMeal = { kcal: Math.round(kcal / n), protein: Math.round(protein / n) };
  const o = e.outside ?? { kcal: 0, protein: 0 };
  const perDay = e.dayTarget ? { kcal: 2 * perMeal.kcal + o.kcal, protein: 2 * perMeal.protein + o.protein } : null;
  if (!e.ref) return { ...empty, perMeal, perDay, level: null };
  const t = e.ref;
  const proteinShort = Math.max(0, t.proteinMin - perMeal.protein);
  const kcalOff = perMeal.kcal > t.kcalMax ? perMeal.kcal - t.kcalMax : perMeal.kcal < t.kcalMin ? perMeal.kcal - t.kcalMin : 0;
  const notable = proteinShort >= WARN_PROTEIN_G || Math.abs(kcalOff) >= WARN_KCAL;
  const level: FitLevel = !proteinShort && !kcalOff ? "bien" : notable ? "loin" : "juste";
  return { ...empty, perMeal, perDay, level, proteinShort, kcalOff, stuck: proteinShort > 0 && best / n < t.proteinMin };
}

/** Un shaker de whey (FOODS) : grammes de poudre pour `g` de protéines. */
export const wheyFor = (proteinG: number) => Math.round(proteinG / (FOODS.whey.protein / 100));

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const round5Up = (x: number) => Math.max(5, Math.ceil(x / 5) * 5);

/**
 * Adéquation d'une sélection (1 à 4 recettes) pour le foyer, et ce qu'on peut y faire. `library` :
 * les recettes candidates à une suggestion ; `excluded` : slug → personnes à qui ne pas la servir.
 */
export function weekFit(
  eaters: FitEater[],
  selected: FitRecipe[],
  opts: { served?: Served; library?: FitRecipe[]; excluded?: Map<string, Set<string>> } = {}
): WeekFit {
  const people = eaters.map((e) => personWeek(e, selected.filter((r) => !opts.excluded?.get(r.slug)?.has(e.id)), opts.served?.get(e.id)));
  const warnings: FitWarning[] = [];
  for (const pw of people) {
    if (pw.level !== "loin" || !pw.perMeal || !pw.ref) continue;
    const e = eaters.find((x) => x.id === pw.personId)!;
    const t = pw.ref;
    const issue: FitIssue = pw.proteinShort >= WARN_PROTEIN_G ? "proteines" : pw.kcalOff > 0 ? "trop-riche" : "trop-leger";
    const text =
      issue === "proteines"
        ? `~${pw.perMeal.protein} g de protéines par repas pour ${t.proteinMin} visés`
        : issue === "trop-riche"
          ? `~${fr(pw.perMeal.kcal)} kcal par repas pour ${fr(t.kcalMax)} au plus`
          : `~${fr(pw.perMeal.kcal)} kcal par repas pour ${fr(t.kcalMin)} visées`;
    warnings.push({ personId: pw.personId, name: pw.name, issue, text, suggestion: suggest(e, pw, issue, eaters, selected, opts) });
  }
  return { people, warnings, ok: people.every((p) => p.level !== "loin") };
}

function suggest(e: FitEater, pw: PersonWeekFit, issue: FitIssue, eaters: FitEater[], selected: FitRecipe[], opts: { served?: Served; library?: FitRecipe[]; excluded?: Map<string, Set<string>> }): FitSuggestion {
  const recipe = selected.length < MAX_RECIPES ? bestAddition(e, pw, issue, eaters, selected, opts) : null;
  if (issue === "proteines") {
    const g = round5Up(2 * pw.proteinShort);
    const side = e.hasShaker ? `un en-cas protéiné de plus (200 g de skyr : ~21 g)` : `un shaker de ~${g} g de protéines par jour`;
    const text = recipe
      ? `Ajoute un plat plus protéiné, par ex. ${recipe.name}, ou ${side}.`
      : e.hasShaker
        ? `Un en-cas protéiné de plus couvrirait l’écart (~${g} g par jour ; 200 g de skyr en donnent ~21).`
        : `Un shaker de ~${g} g de protéines par jour couvrirait l’écart (~${wheyFor(g)} g de poudre).`;
    return { recipe, shakerG: e.hasShaker ? null : g, text };
  }
  if (issue === "trop-riche") return { recipe, shakerG: null, text: recipe ? `Un plat plus léger rééquilibrerait, par ex. ${recipe.name}.` : "Un plat plus léger rééquilibrerait : la part est déjà au plus petit." };
  return { recipe, shakerG: null, text: recipe ? `Ajoute un plat plus copieux, par ex. ${recipe.name}, ou un petit-déjeuner plus solide.` : "Un petit-déjeuner plus solide comblerait l’écart." };
}

/**
 * La recette qui réduit le plus l'écart de cette personne, ajoutée à la sélection (repas répartis à
 * parts égales avec les autres) : pas déjà choisie, servie à cette personne, jamais « loin » pour un
 * autre, et un gain réel. Les recettes aimées passent devant à gain proche.
 */
function bestAddition(e: FitEater, pw: PersonWeekFit, issue: FitIssue, eaters: FitEater[], selected: FitRecipe[], opts: { library?: FitRecipe[]; excluded?: Map<string, Set<string>> }): { slug: string; name: string } | null {
  const chosen = new Set(selected.map((r) => r.slug));
  const n = selected.length;
  const gain = (r: FitRecipe) => {
    const f = recipeFit(e, r);
    if (f.kcal == null || f.protein == null || !pw.perMeal) return -Infinity;
    // Nouvelle moyenne si la recette prend sa part des repas (1 sur n + 1).
    const k = 1 / (n + 1);
    const protein = pw.perMeal.protein * (1 - k) + f.protein * k;
    const kcal = pw.perMeal.kcal * (1 - k) + f.kcal * k;
    const t = e.ref!;
    if (issue === "proteines") return Math.min(protein, t.proteinMin) - Math.min(pw.perMeal.protein, t.proteinMin) - Math.max(0, kcal - t.kcalMax) / 20;
    if (issue === "trop-riche") return pw.perMeal.kcal - kcal - Math.max(0, t.proteinMin - protein) * 10;
    return kcal - pw.perMeal.kcal - Math.max(0, t.proteinMin - protein) * 10;
  };
  const min = issue === "proteines" ? 2 : 20;
  const candidates = (opts.library ?? [])
    .filter((r) => !chosen.has(r.slug) && r.status !== "archived" && r.kcalUnit != null && !opts.excluded?.get(r.slug)?.has(e.id))
    .filter((r) => recipeFits(eaters, r, opts.excluded?.get(r.slug)).every((f) => f.level !== "loin"))
    .map((r) => ({ r, g: gain(r) + (r.status === "liked" ? min / 2 : 0) }))
    .filter((c) => c.g >= min)
    .sort((a, b) => b.g - a.g || a.r.name.localeCompare(b.r.name, "fr"));
  const top = candidates[0]?.r;
  return top ? { slug: top.slug, name: top.name } : null;
}

/** Résumé d'une ligne quand tout va bien : « Protéines et kcal dans le repère d'Alex et Sam. » */
export function fitSummary(w: WeekFit): string | null {
  const known = w.people.filter((p) => p.level);
  if (!known.length || !w.ok) return null;
  const names = joinNames(known.map((p) => p.name));
  return `Protéines et kcal dans le repère ${/^[aeiouyhéèêàâîôû]/i.test(names) ? "d’" : "de "}${names}.`;
}

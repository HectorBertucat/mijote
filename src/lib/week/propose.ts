// « Propose la semaine », en code (pas d'IA) : choisit 2 à 4 recettes de la
// bibliothèque qui couvrent les repas où quelqu'un mange (maison ou bureau), puis
// répartit les unités cuites entre ces repas. Module pur : pas d'accès à la base.
//
// Règles :
// - la part de chacun dépend de la recette : sa cible (Santé) ÷ kcal d'une unité, au demi près
//   (src/lib/eaters) ; sans mangeurs connus, la part de base du créneau (people.portion_units) ;
// - une seule session, la veille du premier jour de la période (J0) : premier jour = J+1,
//   septième = J+7 (une période va jusqu'à 14 jours, src/lib/week/period.ts) ;
// - un repas au jour J+n peut venir du frigo si n ≤ fridge_days, sinon seulement du
//   congélateur, si la recette le supporte (docs/preferences.md : le congélateur sert
//   au-delà d'environ J+4) ; sinon il reste « non couvert », et on le dit ;
// - on évite les conflits d'équipement et les sessions longues (estimateSession),
//   on varie la protéine, et on préfère les recettes dont la part de chacun tombe dans son
//   repère (protéines surtout : les kcal sont visées par la taille de la part) ;
// - unités cuites = servings_units × factor (multiplicateur choisi sur la Semaine) ;
// - goûts : une recette qui contient ce qu'une personne n'aime pas ne lui est pas servie
//   (`excluded`, calculé par tastes.ts depuis la table preferences) ;
// - gaspillage : les paquets entamés à travers toutes les recettes (`profiles`, waste.ts)
//   coûtent des points, d'après la valeur du reste.
import { estimateSession, estimateRecipe, type RecipeLike } from "@/lib/session/estimate";
import { gapOf, meanGap, portionUnits, type Eater } from "@/lib/eaters/core";
import { selectionWaste, wastePenalty, type PackProfiles, type WasteLine } from "./waste";
import { dayString } from "@/lib/days";

export type Meal = "lunch" | "dinner";
export type Place = "home" | "office" | "away";

export interface SlotIn {
  id?: string;
  day: number; // 0 = premier jour de la période
  meal: Meal;
  personId: string;
  place: Place;
  portionUnits: number;
}

export interface WeekRecipe extends RecipeLike {
  servingsUnits: number;
  freezerOk: boolean;
  kcalUnit: number | null;
  proteinUnit: number | null;
  status?: string;
  /** Multiplicateur des unités cuites (1 = la fiche). */
  factor?: number;
  /** Grammes ajoutés à un ingrédient (recipe_ingredient_id → g), pour finir un paquet. */
  extras?: Record<string, number>;
}

/** Unités cuites d'une recette, à son multiplicateur. */
export const unitsOf = (r: Pick<WeekRecipe, "servingsUnits" | "factor">) => Math.round(r.servingsUnits * (r.factor ?? 1));

/** Pas du multiplicateur : de la moitié au triple de la fiche. */
export const FACTORS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export function stepFactor(f: number, dir: 1 | -1): number {
  const i = FACTORS.findIndex((x) => Math.abs(x - f) < 1e-9);
  if (i < 0) return dir > 0 ? (FACTORS.find((x) => x > f) ?? FACTORS[FACTORS.length - 1]) : ([...FACTORS].reverse().find((x) => x < f) ?? FACTORS[0]);
  return FACTORS[Math.max(0, Math.min(FACTORS.length - 1, i + dir))];
}
export const isFactor = (f: number) => Number.isFinite(f) && f >= FACTORS[0] && f <= FACTORS[FACTORS.length - 1];

/** Contexte facultatif du score : goûts et tailles de paquet. Absent = ignoré. */
export interface ScoreContext {
  /** slug → personnes à qui ne pas servir la recette */
  excluded?: Map<string, Set<string>>;
  profiles?: PackProfiles;
  /** Mangeurs (cible, part de base) : la part de chacun suit la recette. Absent = part du créneau. */
  eaters?: Map<string, Eater>;
}

/** Jour de la session, relatif au premier jour de la période : -1 = la veille (le dimanche pour une semaine du lundi). */
export const COOK_DAY = -1;
const DEFAULT_FRIDGE_DAYS = 3;

export const MEAL_LABEL: Record<Meal, string> = { lunch: "midi", dinner: "soir" };

/** Présence par défaut : tout le monde mange à tous les repas (midi en semaine au bureau) ; on retire ensuite les absences. `weekday` : 0 = lundi. */
export function defaultPlace(weekday: number, meal: Meal, _personId?: string): Place {
  return meal === "lunch" && weekday < 5 ? "office" : "home";
}

export const NEXT_PLACE: Record<Place, Place> = { home: "office", office: "away", away: "home" };

/** Combien de jours après la session on mange ce repas. */
export const daysAfterSession = (day: number) => day - COOK_DAY;

// ─── Dates ───

/** Lundi de la semaine qui contient `d`, à l'heure de Paris, en AAAA-MM-JJ. */
export function mondayOf(d: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

/** Semaine affichée par défaut : celle en cours du lundi au jeudi, la suivante à partir du vendredi (on prépare la session du dimanche). */
export function defaultWeek(now: Date): string {
  const m = mondayOf(now);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
  const dow = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${m}T00:00:00Z`)) / 86400000);
  return dow >= 4 ? addDays(m, 7) : m;
}

/** Le jour `n` jours plus tard (ou plus tôt), en AAAA-MM-JJ, sans objet Date (src/lib/days.ts). */
export function addDays(ymd: string, n: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new RangeError(`Date invalide : ${ymd}`);
  // Comme setUTCDate(jour + n) : un `n` fractionnaire est tronqué avec le jour du mois.
  const dom = Number(ymd.slice(8, 10));
  return dayString(Math.floor(ms / 86_400_000) + Math.trunc(dom + n) - dom);
}


// ─── Répartition des unités ───

export interface CoveredMeal {
  day: number;
  meal: Meal;
  personIds: string[];
  units: number;
  frozen: boolean; // au-delà du frigo : à congeler le jour de la session
}

export interface RecipePlan {
  slug: string;
  meals: CoveredMeal[];
  unitsUsed: number;
  unitsLeft: number;
  frozenUnits: number;
}

export interface Assignment {
  bySlot: Map<string, string>; // clé de créneau (jour:repas:personne) → slug
  unitsBySlot: Map<string, number>; // clé de créneau → unités servies
  recipes: RecipePlan[];
  uncovered: SlotIn[];
  neededUnits: number;
  coveredUnits: number;
  frozenUnits: number;
}

export const slotKey = (s: { day: number; meal: Meal; personId: string }) => `${s.day}:${s.meal}:${s.personId}`;
const fridgeOf = (r: WeekRecipe) => r.fridgeDays ?? DEFAULT_FRIDGE_DAYS;
const present = (s: SlotIn) => s.place !== "away";

/**
 * Répartit les unités des recettes entre les repas, dans l'ordre du calendrier.
 * Un repas pris ensemble vient d'une seule recette quand c'est possible. On mange
 * d'abord ce qui se garde le moins (frigo le plus court, non congelable), et on
 * évite le même plat midi et soir d'un même jour quand il y a le choix.
 */
export function assign(recipes: WeekRecipe[], slots: SlotIn[], ctx: Pick<ScoreContext, "excluded" | "eaters"> = {}): Assignment {
  const left = new Map(recipes.map((r) => [r.slug, unitsOf(r)]));
  const plans = new Map<string, RecipePlan>(recipes.map((r) => [r.slug, { slug: r.slug, meals: [], unitsUsed: 0, unitsLeft: unitsOf(r), frozenUnits: 0 }]));
  const allowed = (r: WeekRecipe, people: SlotIn[]) => !people.some((x) => ctx.excluded?.get(r.slug)?.has(x.personId));
  const bySlot = new Map<string, string>();
  const unitsBySlot = new Map<string, number>();
  const unitsFor = (x: SlotIn, r: WeekRecipe) => {
    const e = ctx.eaters?.get(x.personId);
    return e ? portionUnits(e, r) : x.portionUnits;
  };
  const needOf = (r: WeekRecipe, people: SlotIn[]) => people.reduce((s, x) => s + unitsFor(x, r), 0);
  const uncovered: SlotIn[] = [];
  const eaten = slots.filter(present);
  const neededUnits = eaten.reduce((s, x) => s + x.portionUnits, 0);
  let frozenUnits = 0;

  const groups = new Map<string, SlotIn[]>();
  for (const s of [...eaten].sort((a, b) => a.day - b.day || (a.meal === b.meal ? 0 : a.meal === "lunch" ? -1 : 1) || a.personId.localeCompare(b.personId))) {
    const k = `${s.day}:${s.meal}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  const sameDay = new Map<number, Set<string>>(); // jour → recettes déjà servies ce jour-là

  for (const group of groups.values()) {
    const { day, meal } = group[0];
    const n = daysAfterSession(day);
    const eligible = (r: WeekRecipe) => (n <= fridgeOf(r) ? "fresh" : r.freezerOk ? "frozen" : null);
    const rank = (r: WeekRecipe, people: SlotIn[]) => {
      const how = eligible(r);
      if (!how || (left.get(r.slug) ?? 0) < needOf(r, people) - 1e-9 || !allowed(r, people)) return null;
      return [
        how === "fresh" ? 0 : 1,
        sameDay.get(day)?.has(r.slug) ? 1 : 0,
        how === "fresh" ? fridgeOf(r) : 0,
        r.freezerOk ? 1 : 0,
        -(left.get(r.slug) ?? 0),
      ];
    };
    const pick = (people: SlotIn[]) => {
      let best: { r: WeekRecipe; key: number[] } | null = null;
      for (const r of recipes) {
        const key = rank(r, people);
        if (!key) continue;
        if (!best || cmp(key, best.key) < 0 || (cmp(key, best.key) === 0 && r.slug < best.r.slug)) best = { r, key };
      }
      return best?.r ?? null;
    };
    const serve = (r: WeekRecipe, people: SlotIn[]) => {
      const units = needOf(r, people);
      const frozen = eligible(r) === "frozen";
      left.set(r.slug, (left.get(r.slug) ?? 0) - units);
      const p = plans.get(r.slug)!;
      p.meals.push({ day, meal, personIds: people.map((x) => x.personId), units, frozen });
      p.unitsUsed += units;
      p.unitsLeft -= units;
      if (frozen) {
        p.frozenUnits += units;
        frozenUnits += units;
      }
      for (const x of people) {
        bySlot.set(slotKey(x), r.slug);
        unitsBySlot.set(slotKey(x), unitsFor(x, r));
      }
      sameDay.set(day, new Set([...(sameDay.get(day) ?? []), r.slug]));
    };

    const together = pick(group);
    if (together) {
      serve(together, group);
      continue;
    }
    // Sinon chacun le sien (la plus grosse part d'abord).
    for (const x of [...group].sort((a, b) => b.portionUnits - a.portionUnits)) {
      const r = pick([x]);
      if (r) serve(r, [x]);
      else uncovered.push(x);
    }
  }

  const coveredUnits = neededUnits - uncovered.reduce((s, x) => s + x.portionUnits, 0);
  return { bySlot, unitsBySlot, recipes: recipes.map((r) => plans.get(r.slug)!), uncovered, neededUnits, coveredUnits, frozenUnits };
}

function cmp(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ─── Choix des recettes ───

/** Sans mangeurs connus : seules les macros inconnues pèsent (pénalité moyenne). */
export function nutritionGap(r: Pick<WeekRecipe, "kcalUnit" | "proteinUnit">): number {
  return r.kcalUnit == null ? 8 : 0;
}

export interface Proposal extends Assignment {
  slugs: string[];
  score: number;
  totalMin: number;
  conflicts: string[];
  /** Paquets entamés (vide sans profils de paquet). */
  waste: WasteLine[];
}

export function scoreSelection(recipes: WeekRecipe[], slots: SlotIn[], ctx: ScoreContext = {}): Proposal {
  const a = assign(recipes, slots, ctx);
  const est = estimateSession(recipes);
  const uncoveredUnits = a.neededUnits - a.coveredUnits;
  let score = uncoveredUnits * 10 + a.frozenUnits * 0.5;
  const servings = a.recipes.reduce((s, p) => s + p.meals.reduce((t, m) => t + m.personIds.length, 0), 0);
  for (const r of recipes) {
    const p = a.recipes.find((x) => x.slug === r.slug)!;
    // Reste non mangé : gâché s'il ne se congèle pas.
    score += p.unitsLeft * (r.freezerOk ? 0.4 : 1.2);
    // Une recette qui ne sert à rien coûte une session plus longue pour rien.
    if (p.unitsUsed === 0) score += 40;
    // Nutrition, pondérée par la part de la semaine que la recette nourrit : avec les mangeurs,
    // l'écart de la part de chacun à son repère ; sinon seules les macros inconnues pèsent.
    if (ctx.eaters) {
      const served = p.meals.flatMap((m) => m.personIds);
      const gap = served.reduce((s, pid) => s + (ctx.eaters!.get(pid) ? gapOf(ctx.eaters!.get(pid)!, r) : 0), 0);
      score += servings ? (gap / servings) * recipes.length : 0;
    } else score += nutritionGap(r) * (a.neededUnits ? (p.unitsUsed / a.neededUnits) * recipes.length : 1);
    if (r.status && r.status !== "liked") score += 3;
  }
  score += est.conflicts.length * 40;
  score += est.totalMin * 0.05 + Math.max(0, est.totalMin - 210) * 0.3;
  const proteins = est.perRecipe.map((p) => p.protein ?? p.slug);
  score += (proteins.length - new Set(proteins).size) * 12;
  const waste = ctx.profiles ? selectionWaste(recipes.map((r) => ({ slug: r.slug, factor: r.factor, extras: r.extras })), ctx.profiles) : [];
  score += wastePenalty(waste);
  return {
    waste,
    ...a,
    slugs: recipes.map((r) => r.slug),
    score,
    totalMin: est.totalMin,
    conflicts: est.conflicts.map((c) => c.message),
  };
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}

const POOL = 14; // au-delà, on garde les meilleures recettes seules (2 000 combinaisons au plus)

/** Ordre de départ : recettes aimées, proches du repère, qui se gardent et se congèlent. */
function poolOf(library: WeekRecipe[], eaters?: Map<string, Eater>): WeekRecipe[] {
  const gap = (r: WeekRecipe) => (eaters ? meanGap([...eaters.values()], r) : nutritionGap(r));
  const solo = (r: WeekRecipe) => gap(r) + (r.status === "liked" ? 0 : 3) + (r.freezerOk ? 0 : 2) - Math.min(4, fridgeOf(r));
  return [...library]
    .filter((r) => r.servingsUnits > 0 && r.status !== "archived")
    .sort((a, b) => solo(a) - solo(b) || a.slug.localeCompare(b.slug))
    .slice(0, POOL);
}

/** Meilleure sélection de 2 à 4 recettes (moins de 2 si la bibliothèque est trop petite). */
export function propose(library: WeekRecipe[], slots: SlotIn[], opts: { keep?: string[]; exclude?: string[] } & ScoreContext = {}): Proposal | null {
  const keep = (opts.keep ?? []).map((s) => library.find((r) => r.slug === s)).filter((r): r is WeekRecipe => !!r);
  const exclude = new Set([...(opts.exclude ?? []), ...keep.map((r) => r.slug)]);
  const pool = poolOf(library.filter((r) => !exclude.has(r.slug)), opts.eaters);
  let best: Proposal | null = null;
  const minK = Math.max(0, 2 - keep.length);
  const maxK = Math.max(0, 4 - keep.length);
  for (let k = Math.min(minK, pool.length); k <= Math.min(maxK, pool.length); k++) {
    for (const combo of combinations(pool, k)) {
      const sel = [...keep, ...combo];
      if (!sel.length) continue;
      const p = scoreSelection(sel, slots, opts);
      if (!best || p.score < best.score - 1e-9 || (Math.abs(p.score - best.score) <= 1e-9 && p.slugs.join() < best.slugs.join())) best = p;
    }
  }
  return best;
}

/** Échange une recette : on garde les autres et on cherche la meilleure remplaçante. */
export function swap(library: WeekRecipe[], slots: SlotIn[], current: string[], out: string, alsoExclude: string[] = [], ctx: ScoreContext = {}): Proposal | null {
  const keep = current.filter((s) => s !== out);
  const exclude = [out, ...alsoExclude];
  // Une seule remplaçante, à la place de celle qu'on retire.
  const pool = poolOf(library.filter((r) => !exclude.includes(r.slug) && !keep.includes(r.slug)), ctx.eaters);
  const kept = keep.map((s) => library.find((r) => r.slug === s)).filter((r): r is WeekRecipe => !!r);
  let best: Proposal | null = null;
  for (const c of pool) {
    const p = scoreSelection([...kept, c], slots, ctx);
    if (!best || p.score < best.score) best = p;
  }
  return best;
}

// ─── Quantités automatiques ───

/** Multiplicateur le plus haut choisi tout seul : au-delà, une marmite déborde des récipients d'une cuisine courante. */
export const AUTO_MAX_FACTOR = 2;

/**
 * Les unités à cuire de recettes choisies à la main : le multiplicateur de chacune (pas de FACTORS,
 * jusqu'à AUTO_MAX_FACTOR) qui couvre le plus de repas avec le moins de reste. Un reste qui se
 * congèle coûte peu (c'est de la marge), un reste qui ne se congèle pas coûte plus. Recherche
 * gloutonne : un pas à la fois sur la recette qui améliore le plus, jusqu'à ne plus rien gagner.
 */
export function autoSize(recipes: WeekRecipe[], slots: SlotIn[], ctx: Pick<ScoreContext, "excluded" | "eaters"> = {}): WeekRecipe[] {
  if (!recipes.length) return recipes;
  const steps = FACTORS.filter((f) => f <= AUTO_MAX_FACTOR);
  const cost = (rs: WeekRecipe[]) => {
    const a = assign(rs, slots, ctx);
    const unused = a.recipes.reduce((s, p) => s + (p.unitsUsed === 0 ? 1 : 0), 0);
    const left = a.recipes.reduce((s, p, i) => s + p.unitsLeft * (rs[i].freezerOk ? 0.15 : 1), 0);
    return (a.neededUnits - a.coveredUnits) * 10 + left + unused * 20;
  };
  let cur: WeekRecipe[] = recipes.map((r) => ({ ...r, factor: 1 }));
  let best = cost(cur);
  for (let guard = 0; guard < 40; guard++) {
    let move: { rs: WeekRecipe[]; c: number } | null = null;
    for (let i = 0; i < cur.length; i++) {
      for (const dir of [1, -1] as const) {
        const f = stepFactor(cur[i].factor ?? 1, dir);
        if (f === cur[i].factor || !steps.includes(f as (typeof FACTORS)[number])) continue;
        const rs = cur.map((r, j) => (j === i ? { ...r, factor: f } : r));
        const c = cost(rs);
        if (c < (move?.c ?? best) - 1e-9) move = { rs, c };
      }
    }
    if (!move) break;
    cur = move.rs;
    best = move.c;
  }
  return cur;
}

/** Protéine principale (pour l'affichage). */
export const proteinOf = (r: RecipeLike) => estimateRecipe(r).protein;

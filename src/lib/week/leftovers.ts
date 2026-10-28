// Restes de paquet d'une sélection de 2 à 4 recettes, calculés comme la liste de courses
// (même agrégation, mêmes produits : src/lib/shopping/build.ts planList), et ce qu'on
// peut en faire, en code :
//   a) une recette de la bibliothèque qui utilise ce produit et va avec la sélection
//      (accords de src/lib/session/estimate.ts) ;
//   b) mettre le reste dans une recette déjà choisie, si sa part reste dans la cible ;
//   c) sinon, l'atelier prérempli (« une recette qui utilise 200 g de … »).
// Pur : résolveurs, bibliothèque et profils sont injectés (tests sans réseau).
import type { AssocRow } from "@/lib/products/core";
import { computeNutrition, DEFAULT_PORTION_UNITS, type MealTarget } from "@/lib/nutrition/compute";
import { planList, type Ing } from "@/lib/shopping/build";
import { suggestPairings, type RecipeLike } from "@/lib/session/estimate";
import type { ResolveResponse } from "@/lib/chronocatalog";
import { isLeftover, isPerishable, packsOf, type PackProfiles } from "./waste";

export interface LeftoverRecipe {
  id: string;
  slug: string;
  name: string;
  servingsUnits: number;
  factor: number;
  extras: Record<string, number>;
  ingredients: Ing[];
}

export interface LibraryEntry extends RecipeLike {
  status?: string;
}

export interface AddSuggestion {
  slug: string;
  name: string;
  usesG: number; // grammes de ce produit dans la fiche
  restAfterG: number; // ce qui resterait avec elle
  morePacks: boolean; // elle en demande plus que le reste : un paquet de plus
  addedMin: number;
  reasons: string[];
  dislikes: string[]; // « Sam n'aime pas : brocoli »
}

export interface AdjustSuggestion {
  slug: string;
  name: string;
  ingredientId: string;
  item: string;
  fromG: number;
  extraG: number;
  before: { kcal: number; protein: number };
  after: { kcal: number; protein: number };
  inTarget: boolean;
}

export interface Leftover {
  key: string;
  label: string;
  product: string;
  quantityLabel: string | null;
  packs: number;
  packG: number;
  orderedG: number;
  needG: number;
  restG: number;
  perishable: boolean;
  uses: { slug: string; name: string; grams: number }[];
  add: AddSuggestion[];
  adjust: AdjustSuggestion | null;
  atelierHref: string | null;
}

export interface LeftoverContext {
  library: LibraryEntry[];
  profiles: PackProfiles;
  /** slug → personne → ce qu'elle n'aime pas dans la recette */
  dislikes?: Map<string, Map<string, string[]>>;
  names?: Record<string, string>; // personId → prénom
  resolveLine?: (q: string) => Promise<ResolveResponse>;
  resolveTotal?: (q: string) => Promise<ResolveResponse>;
  /** Produits du drive associés aux ingrédients (même choix que la liste de courses). */
  associations?: AssocRow[];
  maxRecipes?: number;
  /** La part de référence (la personne du profil actif) : ses unités et son repère. */
  lead?: Lead;
}

/** Part de référence pour juger un ajout : unités et repère d'un repas (null = pas de repère). */
export interface Lead {
  units: number;
  ref: MealTarget | null;
}
export const GENERIC_LEAD: Lead = { units: DEFAULT_PORTION_UNITS, ref: null };

/** Au-delà du repère de la part de référence, on accepte au plus 1,5 point d'écart en plus (30 kcal ou 3 g par part). */
export const NUTRITION_TOLERANCE = 1.5;

const lower = (s: string) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const shortLabel = (s: string) => lower(s.split(/[,(]/)[0].trim());

/** Nutrition d'une recette à son multiplicateur, avec des grammes ajoutés (par unité cuite inchangée sans ajout). */
export function scaledNutrition(ings: Ing[], servingsUnits: number, factor: number, extras: Record<string, number>) {
  return computeNutrition(
    ings.map((i) => ({
      item: i.item,
      food: i.foodId,
      grams: i.grams != null ? i.grams * factor + (extras[i.id] ?? 0) : (extras[i.id] ?? null),
      units: i.grams == null && !extras[i.id] && i.units != null ? i.units * factor : null,
      yield: i.yield ?? null,
    })),
    servingsUnits * factor
  );
}

/** Part de référence (kcal, protéines) d'une recette à son multiplicateur, avec des grammes ajoutés. */
export function leadPart(r: Pick<LeftoverRecipe, "ingredients" | "servingsUnits" | "factor">, extras: Record<string, number>, units = DEFAULT_PORTION_UNITS) {
  const n = scaledNutrition(r.ingredients, r.servingsUnits, r.factor, extras);
  return { kcal: Math.round(n.perUnit.kcal * units), protein: Math.round(n.perUnit.protein * units) };
}

/** Sans repère, toute part « tient » : on ne juge que ce qu'on sait. */
const inTarget = (t: MealTarget | null, p: { kcal: number; protein: number }) =>
  !t || (p.kcal >= t.kcalMin && p.kcal <= t.kcalMax && p.protein >= t.proteinMin && p.protein <= t.proteinMax);
/** Écart au repère, en « points » (20 kcal ou 2 g de protéines = 1). */
const gapOf = (t: MealTarget | null, p: { kcal: number; protein: number }) =>
  !t ? 0 : Math.max(0, p.kcal - t.kcalMax, t.kcalMin - p.kcal) / 20 + Math.max(0, p.protein - t.proteinMax, t.proteinMin - p.protein) / 2;

/** b) Le reste dans une recette déjà choisie : la ligne la plus lourde de ce produit, si la part tient. */
export function adjustFor(sel: LeftoverRecipe[], uses: { slug: string; ingredientId: string; grams: number | null; units: number | null }[], restG: number, lead: Lead = GENERIC_LEAD): AdjustSuggestion | null {
  const t = lead.ref;
  let best: (AdjustSuggestion & { cost: number }) | null = null;
  for (const r of sel) {
    const mine = uses.filter((u) => u.slug === r.slug && u.grams != null && u.grams > 0 && u.units == null);
    if (!mine.length) continue;
    const line = mine.reduce((a, b) => (b.grams! > a.grams! ? b : a));
    if (restG > line.grams!) continue; // pas plus du double de la ligne
    const ing = r.ingredients.find((i) => i.id === line.ingredientId);
    if (!ing) continue;
    const before = leadPart(r, r.extras, lead.units);
    const after = leadPart(r, { ...r.extras, [ing.id]: (r.extras[ing.id] ?? 0) + restG }, lead.units);
    const ok = inTarget(t, after) || gapOf(t, after) <= gapOf(t, before) + NUTRITION_TOLERANCE;
    if (!ok) continue;
    const cost = gapOf(t, after) - gapOf(t, before);
    if (!best || cost < best.cost)
      best = { slug: r.slug, name: r.name, ingredientId: ing.id, item: shortLabel(ing.item), fromG: Math.round(line.grams!), extraG: restG, before, after, inTarget: inTarget(t, after), cost };
  }
  if (!best) return null;
  const { cost: _c, ...out } = best;
  return out;
}

export async function selectionLeftovers(sel: LeftoverRecipe[], ctx: LeftoverContext): Promise<Leftover[]> {
  if (!sel.length) return [];
  const byId = new Map(sel.map((r) => [r.id, r]));
  const slugOfRecipe = (recipeId: string) => byId.get(recipeId)?.slug ?? recipeId;
  const factorOf = new Map(sel.map((r) => [r.slug, r]));
  const extras = Object.assign({}, ...sel.map((r) => r.extras)) as Record<string, number>;
  const plan = await planList(
    sel.flatMap((r) => r.ingredients),
    {
      scaleOf: (ing) => ({ factor: factorOf.get(slugOfRecipe(ing.recipeId))?.factor ?? 1, extraG: extras[ing.id] ?? 0 }),
      resolveLine: ctx.resolveLine,
      resolveTotal: ctx.resolveTotal,
      associations: ctx.associations,
      // Pas de recherche ici (page Semaine) : la carte du jour du choix suffit pour la taille du paquet.
      lookup: async () => [],
    }
  );
  const chosen = new Set(sel.map((r) => r.slug));
  const nameOf = new Map([...ctx.library.map((r) => [r.slug, r.name] as const), ...sel.map((r) => [r.slug, r.name] as const)]);
  const maxRecipes = ctx.maxRecipes ?? 4;
  const selectedLike = ctx.library.filter((r) => chosen.has(r.slug));
  const pairOrder = new Map(
    suggestPairings(
      selectedLike,
      ctx.library.filter((r) => !chosen.has(r.slug) && r.status !== "archived"),
      99
    ).map((p, k) => [p.slug, { ...p, k }])
  );

  const out: Leftover[] = [];
  for (const l of plan.lines) {
    const packG = l.product?.weightG;
    if (!l.product || !packG || l.packs <= 0 || l.needG == null) continue;
    const orderedG = l.packs * packG;
    const restG = Math.round(orderedG - l.needG);
    if (!isLeftover(restG, packG)) continue;
    const perishable = isPerishable(l.aisle, l.need.label);
    const uses = l.need.sources.map((s) => ({ slug: slugOfRecipe(s.ing.recipeId), ingredientId: s.ing.id, grams: s.grams, units: s.units }));
    const usesBy = new Map<string, number>();
    for (const u of uses) usesBy.set(u.slug, (usesBy.get(u.slug) ?? 0) + (u.grams ?? 0));

    // a) Une recette de la bibliothèque qui utilise ce produit.
    const add: AddSuggestion[] = [];
    if (perishable && sel.length < maxRecipes) {
      for (const [slug, lines] of ctx.profiles) {
        if (chosen.has(slug)) continue;
        const p = pairOrder.get(slug);
        if (!p) continue; // archivée, ou hors bibliothèque
        const usesG = lines.filter((x) => x.key === l.need.key).reduce((s, x) => s + (x.grams ?? 0), 0);
        if (usesG <= 0) continue;
        const need = l.needG + usesG;
        const packs = packsOf(need, packG);
        const restAfter = Math.max(0, Math.round(packs * packG - need));
        // Une recette entière pour 20 g d'ail ne vaut pas le coup : elle doit finir le paquet ou en prendre une bonne part.
        if (isLeftover(restAfter, packG) && usesG < Math.max(30, 0.3 * restG)) continue;
        const dis = [...(ctx.dislikes?.get(slug) ?? new Map<string, string[]>())].map(([who, what]) => `${ctx.names?.[who] ?? who} n'aime pas : ${what.join(", ")}`);
        add.push({ slug, name: nameOf.get(slug) ?? slug, usesG: Math.round(usesG), restAfterG: restAfter, morePacks: packs > l.packs, addedMin: p.addedMin, reasons: p.reasons, dislikes: dis });
      }
      add.sort((a, b) => Number(a.morePacks) - Number(b.morePacks) || Number(a.dislikes.length > 0) - Number(b.dislikes.length > 0) || a.restAfterG - b.restAfterG || pairOrder.get(a.slug)!.k - pairOrder.get(b.slug)!.k);
      add.splice(2);
    }

    // b) Finir le paquet dans une recette déjà choisie.
    const adjust = perishable ? adjustFor(sel, uses, restG, ctx.lead) : null;

    // c) Sinon, l'atelier.
    const label = shortLabel(l.need.label);
    const atelierHref = perishable && !add.length && !adjust ? `/atelier?envie=${encodeURIComponent(`Une recette qui utilise ${restG} g de ${label}`)}` : null;

    out.push({
      key: l.need.key,
      label,
      product: l.product.name,
      quantityLabel: l.product.quantityLabel,
      packs: l.packs,
      packG,
      orderedG: Math.round(orderedG),
      needG: Math.round(l.needG),
      restG,
      perishable,
      uses: [...usesBy].map(([slug, grams]) => ({ slug, name: nameOf.get(slug) ?? slug, grams: Math.round(grams) })),
      add,
      adjust,
      atelierHref,
    });
  }
  return out.sort((a, b) => Number(b.perishable) - Number(a.perishable) || b.restG / b.packG - a.restG / a.packG);
}

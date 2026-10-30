// Lecture et écriture d'une semaine (week_plans, meal_slots, week_recipes). Les recettes
// retenues vivent dans week_recipes (avec leur multiplicateur d'unités et les grammes
// ajoutés pour finir un paquet) ; meal_slots.recipe_id dit quel repas mange quoi.
// Changer une présence ou des unités redistribue les mêmes recettes, sans en choisir d'autres.
// La part de chacun suit sa cible et la recette (src/lib/eaters) : meal_slots.units la garde.
import { loadAssociations } from "@/lib/products/store";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { mealSlots, people, preferences, recipeIngredients, recipes, shoppingLists, weekPlans, weekRecipes } from "@/lib/db/schema";
import { listRecipesWithSteps } from "@/lib/recipes/queries";
import type { Ing } from "@/lib/shopping/build";
import { assign, autoSize, defaultPlace, isFactor, NEXT_PLACE, propose, slotKey, swap, type Assignment, type Meal, type SlotIn, type WeekRecipe } from "./propose";
import { dislikeRules, exclusionsOf, type DislikeRule } from "./tastes";
import { buildProfiles, lineResolver, totalResolver } from "./packs";
import { scaledNutrition, selectionLeftovers, type Leftover } from "./leftovers";
import type { PackProfiles } from "./waste";
import { eaterMap, leadOf, loadEaters } from "@/lib/eaters/store";

export function ensureWeek(db: Db, weekStart: string): string {
  const found = db.select({ id: weekPlans.id }).from(weekPlans).where(eq(weekPlans.weekStart, weekStart)).get();
  const id = found?.id ?? randomUUID();
  if (!found) db.insert(weekPlans).values({ id, weekStart }).onConflictDoNothing().run();
  const planId = db.select({ id: weekPlans.id }).from(weekPlans).where(eq(weekPlans.weekStart, weekStart)).get()!.id;
  const ps = db.select({ id: people.id }).from(people).all();
  const rows = [];
  for (let day = 0; day < 7; day++)
    for (const meal of ["lunch", "dinner"] as Meal[])
      for (const p of ps) rows.push({ id: randomUUID(), weekPlanId: planId, day, meal, personId: p.id, place: defaultPlace(day, meal, p.id) });
  if (rows.length) db.insert(mealSlots).values(rows).onConflictDoNothing().run();
  return planId;
}

export function loadWeek(db: Db, weekStart: string) {
  const planId = ensureWeek(db, weekStart);
  const slots = db
    .select({
      id: mealSlots.id,
      day: mealSlots.day,
      meal: mealSlots.meal,
      personId: mealSlots.personId,
      place: mealSlots.place,
      recipeId: mealSlots.recipeId,
      baseUnits: people.portionUnits,
      slotUnits: mealSlots.units,
      personName: people.name,
    })
    .from(mealSlots)
    .innerJoin(people, eq(people.id, mealSlots.personId))
    .where(eq(mealSlots.weekPlanId, planId))
    .all()
    // portionUnits = unités servies à ce repas (la part de base tant que rien n'est servi).
    .map((s) => ({ ...s, portionUnits: s.recipeId && s.slotUnits != null ? s.slotUnits : s.baseUnits }));
  return { planId, slots };
}

export type LibRecipe = WeekRecipe & { id: string; description: string | null; carbsUnit: number | null; fatUnit: number | null; fiberUnit: number | null };

export function library(db: Db): LibRecipe[] {
  return listRecipesWithSteps(db);
}

type Loaded = ReturnType<typeof loadWeek>;

/** Une recette retenue pour la semaine, avec son multiplicateur et ses grammes ajoutés. */
export interface WeekSel {
  recipeId: string;
  slug: string;
  factor: number;
  extras: Record<string, number>;
}

/** Les recettes retenues (week_recipes, dans l'ordre de la proposition). */
export function loadSelection(db: Db, planId: string): WeekSel[] {
  return db
    .select({ recipeId: weekRecipes.recipeId, slug: recipes.slug, factor: weekRecipes.factor, extras: weekRecipes.extras })
    .from(weekRecipes)
    .innerJoin(recipes, eq(recipes.id, weekRecipes.recipeId))
    .where(eq(weekRecipes.weekPlanId, planId))
    .orderBy(asc(weekRecipes.position), asc(recipes.slug))
    .all();
}

/** Remplace la sélection de la semaine (une transaction). */
function writeSelection(db: Db, planId: string, lib: LibRecipe[], sel: { slug: string; factor?: number; extras?: Record<string, number> }[]) {
  const idOf = new Map(lib.map((r) => [r.slug, r.id]));
  db.transaction((tx) => {
    tx.delete(weekRecipes).where(eq(weekRecipes.weekPlanId, planId)).run();
    sel.forEach((x, k) => {
      const recipeId = idOf.get(x.slug);
      if (recipeId) tx.insert(weekRecipes).values({ id: randomUUID(), weekPlanId: planId, recipeId, factor: x.factor ?? 1, extras: x.extras ?? {}, position: k }).run();
    });
  });
}

/** Écrit la répartition dans meal_slots (une transaction) : recette et unités de chaque repas. */
function save(db: Db, w: Loaded, lib: LibRecipe[], a: Pick<Assignment, "bySlot" | "unitsBySlot"> | null) {
  const idOf = new Map(lib.map((r) => [r.slug, r.id]));
  db.transaction((tx) => {
    for (const s of w.slots) {
      const slug = a?.bySlot.get(slotKey(s));
      const recipeId = slug ? idOf.get(slug) ?? null : null;
      const units = recipeId ? a?.unitsBySlot.get(slotKey(s)) ?? null : null;
      if (recipeId !== s.recipeId || units !== s.slotUnits) tx.update(mealSlots).set({ recipeId, units }).where(eq(mealSlots.id, s.id)).run();
    }
  });
}

/** Créneaux pour la répartition : la part de base de la personne (la part servie en découle). */
const asSlots = (w: Loaded): SlotIn[] => w.slots.map((s) => ({ id: s.id, day: s.day, meal: s.meal, personId: s.personId, place: s.place, portionUnits: s.baseUnits }));

/** Les mangeurs, pour la répartition (cible de Santé, part de base). */
const eatersCtx = (db: Db) => eaterMap(loadEaters(db));

// ─── Goûts et paquets ───

/** Ingrédients des recettes (lignes complètes : quantités, aliment, rendement). */
export function loadIngredients(db: Db, recipeIds: string[]): Map<string, Ing[]> {
  const out = new Map<string, Ing[]>(recipeIds.map((id) => [id, []]));
  if (!recipeIds.length) return out;
  for (const i of db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds)).orderBy(asc(recipeIngredients.position)).all())
    out.get(i.recipeId)?.push(i);
  return out;
}

export interface Tastes {
  rules: DislikeRule[];
  /** slug → personne → ce qu'elle n'aime pas dans la recette */
  dislikes: Map<string, Map<string, string[]>>;
  /** slug → personnes à qui ne pas la servir (propose/assign) */
  excluded: Map<string, Set<string>>;
}

export function loadTastes(db: Db, lib: LibRecipe[]): Tastes {
  const rules = dislikeRules(db.select().from(preferences).all());
  const ings = loadIngredients(db, lib.map((r) => r.id));
  const dislikes = exclusionsOf(
    lib.map((r) => ({ slug: r.slug, name: r.name, ingredients: (ings.get(r.id) ?? []).map((i) => ({ item: i.item, lineRaw: i.lineRaw, food: i.foodId })) })),
    rules
  );
  const excluded = new Map([...dislikes].map(([slug, m]) => [slug, new Set(m.keys())]));
  return { rules, dislikes, excluded };
}

/** Profils de paquet de la bibliothèque (/resolve, en cache) ; vide si chronocatalog ne répond pas. */
export async function loadProfiles(db: Db, lib: LibRecipe[]): Promise<{ profiles: PackProfiles; error: string | null }> {
  try {
    const ings = loadIngredients(db, lib.map((r) => r.id));
    const profiles = await buildProfiles(lib.map((r) => ({ slug: r.slug, ingredients: ings.get(r.id) ?? [] })));
    const empty = [...profiles.values()].every((l) => !l.length);
    return { profiles, error: empty && lib.length ? "chronocatalog ne répond pas : gaspillage non compté" : null };
  } catch (e) {
    console.error("[semaine] profils de paquet :", e);
    return { profiles: new Map(), error: "chronocatalog ne répond pas : gaspillage non compté" };
  }
}

/** La bibliothèque avec le multiplicateur et les grammes ajoutés de la sélection. */
const withSel = (lib: LibRecipe[], sel: WeekSel[]) => {
  const by = new Map(sel.map((x) => [x.slug, x]));
  return lib.map((r) => (by.has(r.slug) ? { ...r, factor: by.get(r.slug)!.factor, extras: by.get(r.slug)!.extras } : r));
};

// ─── Actions ───

/**
 * « Compléter pour moi » : garde les recettes déjà choisies et ajoute celles qui couvrent le mieux
 * le reste des repas (2 à 4 en tout), puis les quantités se calent toutes seules.
 */
export async function proposeWeek(db: Db, weekStart: string) {
  const w = loadWeek(db, weekStart);
  const lib = library(db);
  const kept = loadSelection(db, w.planId);
  const tastes = loadTastes(db, lib);
  const { profiles } = await loadProfiles(db, lib);
  const p = propose(lib, asSlots(w), { keep: kept.map((x) => x.slug), excluded: tastes.excluded, profiles, eaters: eatersCtx(db) });
  const old = new Map(kept.map((x) => [x.slug, x]));
  writeSelection(db, w.planId, lib, (p?.slugs ?? []).map((slug) => ({ slug, extras: old.get(slug)?.extras })));
  resize(db, weekStart);
  return p;
}

/**
 * Les quantités à cuire des recettes retenues, calées sur les repas de la semaine (autoSize),
 * puis la répartition. Appelé après chaque changement de recettes ou de présence.
 */
export function resize(db: Db, weekStart: string) {
  const w = loadWeek(db, weekStart);
  const sel = loadSelection(db, w.planId);
  const lib = withSel(library(db), sel);
  if (sel.length) {
    const chosen = selectedRecipes(db, lib, sel).selected;
    const sized = autoSize(chosen, asSlots(w), { excluded: loadTastes(db, chosen).excluded, eaters: eatersCtx(db) });
    const factorOf = new Map(sized.map((r) => [r.slug, r.factor ?? 1]));
    writeSelection(db, w.planId, lib, sel.map((x) => ({ slug: x.slug, factor: factorOf.get(x.slug) ?? x.factor, extras: x.extras })));
  }
  reassign(db, weekStart);
}

export async function swapRecipe(db: Db, weekStart: string, out: string) {
  const w = loadWeek(db, weekStart);
  const sel = loadSelection(db, w.planId);
  const lib = withSel(library(db), sel);
  const tastes = loadTastes(db, lib);
  const { profiles } = await loadProfiles(db, lib);
  const p = swap(lib, asSlots(w), sel.map((x) => x.slug), out, [], { excluded: tastes.excluded, profiles, eaters: eatersCtx(db) });
  if (p) {
    save(db, w, lib, p);
    const keep = new Map(sel.map((x) => [x.slug, x]));
    // La remplaçante prend la place de celle qu'on retire.
    const ordered = sel.map((x) => (x.slug === out ? p.slugs.find((s) => !keep.has(s))! : x.slug)).filter(Boolean);
    writeSelection(db, w.planId, lib, ordered.map((slug) => ({ slug, factor: keep.get(slug)?.factor, extras: keep.get(slug)?.extras })));
    resize(db, weekStart);
  }
  return p;
}

export function clearWeek(db: Db, weekStart: string) {
  const w = loadWeek(db, weekStart);
  save(db, w, [], null);
  writeSelection(db, w.planId, [], []);
}

/** Redistribue les recettes déjà retenues (après un changement de présence ou d'unités). */
export function reassign(db: Db, weekStart: string) {
  const w = loadWeek(db, weekStart);
  const sel = loadSelection(db, w.planId);
  const lib = withSel(library(db), sel);
  const current = new Set(sel.map((x) => x.slug));
  if (!current.size) return save(db, w, lib, null);
  const chosen = selectedRecipes(db, lib, sel).selected;
  const a = assign(chosen, asSlots(w), { excluded: loadTastes(db, chosen).excluded, eaters: eatersCtx(db) });
  save(db, w, lib, a);
}

function updateSel(db: Db, weekStart: string, fn: (sel: WeekSel[]) => { slug: string; factor?: number; extras?: Record<string, number> }[], opts: { sizes?: boolean } = {}) {
  const w = loadWeek(db, weekStart);
  const lib = library(db);
  writeSelection(db, w.planId, lib, fn(loadSelection(db, w.planId)));
  // Les recettes changent : les quantités se recalent. Un réglage à la main (multiplicateur, grammes) reste tel quel.
  if (opts.sizes) resize(db, weekStart);
  else reassign(db, weekStart);
}

/** Change le multiplicateur d'unités d'une recette (par pas de FACTORS). */
export function setFactor(db: Db, weekStart: string, slug: string, factor: number) {
  if (!isFactor(factor)) throw new Error("Multiplicateur hors des pas prévus.");
  updateSel(db, weekStart, (sel) => sel.map((x) => (x.slug === slug ? { ...x, factor } : x)));
}

/** Ajoute une recette de la bibliothèque (4 au plus). */
export function addRecipe(db: Db, weekStart: string, slug: string) {
  updateSel(db, weekStart, (sel) => (sel.length >= 4 || sel.some((x) => x.slug === slug) ? sel : [...sel, { recipeId: "", slug, factor: 1, extras: {} }]), { sizes: true });
}

export function removeRecipe(db: Db, weekStart: string, slug: string) {
  updateSel(db, weekStart, (sel) => sel.filter((x) => x.slug !== slug), { sizes: true });
}

/** Grammes ajoutés à une ligne d'une recette retenue (0 = retirer). */
export function setExtra(db: Db, weekStart: string, slug: string, ingredientId: string, grams: number) {
  updateSel(db, weekStart, (sel) =>
    sel.map((x) => {
      if (x.slug !== slug) return x;
      const extras = { ...x.extras };
      if (grams > 0) extras[ingredientId] = Math.round(grams);
      else delete extras[ingredientId];
      return { ...x, extras };
    })
  );
}

export function cyclePlace(db: Db, slotId: string): string | null {
  const s = db
    .select({ place: mealSlots.place, weekStart: weekPlans.weekStart })
    .from(mealSlots)
    .innerJoin(weekPlans, eq(weekPlans.id, mealSlots.weekPlanId))
    .where(eq(mealSlots.id, slotId))
    .get();
  if (!s) return null;
  db.update(mealSlots).set({ place: NEXT_PLACE[s.place] }).where(and(eq(mealSlots.id, slotId))).run();
  resize(db, s.weekStart);
  return s.weekStart;
}

/** La dernière liste de courses faite depuis cette semaine, et si la sélection a changé depuis. */
export function weekList(db: Db, planId: string, sel: WeekSel[]) {
  const l = db.select().from(shoppingLists).where(and(eq(shoppingLists.weekPlanId, planId), isNull(shoppingLists.archivedAt))).orderBy(desc(shoppingLists.createdAt)).limit(1).get();
  if (!l) return null;
  const same = (a: Record<string, number>, b: Record<string, number>) => {
    const ka = Object.keys(a).filter((k) => a[k] !== 0 && a[k] !== 1);
    const kb = Object.keys(b).filter((k) => b[k] !== 0 && b[k] !== 1);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  };
  const scales = Object.fromEntries(sel.filter((x) => x.factor !== 1).map((x) => [x.slug, x.factor]));
  const extras = Object.assign({}, ...sel.map((x) => x.extras)) as Record<string, number>;
  const changed = [...l.recipeSlugs].sort().join() !== sel.map((x) => x.slug).sort().join() || !same(l.recipeScales, scales) || !same(l.recipeExtras, extras);
  const ordered = l.status === "ordered" || l.status === "paid";
  return { id: l.id, status: l.status, ordered, createdAt: l.createdAt, orderedAt: l.orderedAt, changed, building: l.buildTotal != null && (l.buildDone ?? 0) < l.buildTotal && !l.buildError };
}

/**
 * Les recettes retenues, dans l'ordre, avec leurs macros par unité recalculées quand des
 * grammes ont été ajoutés (la part change).
 */
function selectedRecipes(db: Db, lib: LibRecipe[], sel: WeekSel[]) {
  const order = new Map(sel.map((x, k) => [x.slug, k]));
  const selected0 = lib.filter((r) => order.has(r.slug)).sort((a, b) => order.get(a.slug)! - order.get(b.slug)!);
  const ings = loadIngredients(db, selected0.map((r) => r.id));
  const selected = selected0.map((r) => {
    if (!r.extras || !Object.keys(r.extras).length) return r;
    const n = scaledNutrition(ings.get(r.id) ?? [], r.servingsUnits, r.factor ?? 1, r.extras);
    return { ...r, kcalUnit: n.perUnit.kcal, proteinUnit: n.perUnit.protein, carbsUnit: n.perUnit.carbs, fatUnit: n.perUnit.fat, fiberUnit: n.perUnit.fiber };
  });
  return { selected, ings };
}

/** Tout ce que la page affiche : grille, recettes retenues avec leur répartition. */
export function weekView(db: Db, weekStart: string) {
  let w = loadWeek(db, weekStart);
  const sel = loadSelection(db, w.planId);
  const lib = withSel(library(db), sel);
  const tastes = loadTastes(db, lib);
  const { selected, ings } = selectedRecipes(db, lib, sel);
  const eaters = loadEaters(db);
  const a = assign(selected, asSlots(w), { excluded: tastes.excluded, eaters: eaterMap(eaters) });
  const slugById = new Map(lib.map((r) => [r.id, r.slug]));
  // Une cible a bougé (pesée, profil, journée complète) : les parts suivent, la grille aussi.
  const stale = selected.length > 0 && w.slots.some((s) => {
    const slug = a.bySlot.get(slotKey(s)) ?? null;
    return (s.recipeId ? slugById.get(s.recipeId) ?? null : null) !== slug || (slug != null && a.unitsBySlot.get(slotKey(s)) !== s.slotUnits);
  });
  if (stale) {
    save(db, w, lib, a);
    w = loadWeek(db, weekStart);
  }
  // La grille montre ce qui est en base ; la répartition recalculée sert aux cartes.
  const grid = w.slots.map((s) => ({ ...s, slug: s.recipeId ? slugById.get(s.recipeId) ?? null : null }));
  const extraLines = selected.flatMap((r) =>
    Object.entries(r.extras ?? {}).map(([id, g]) => ({ slug: r.slug, ingredientId: id, grams: g, item: (ings.get(r.id) ?? []).find((i) => i.id === id)?.item ?? "?" }))
  );
  return {
    planId: w.planId,
    grid,
    selected,
    selection: sel,
    assignment: a,
    eaters,
    library: lib,
    tastes,
    extraLines,
    list: weekList(db, w.planId, sel),
    ingredients: ings,
  };
}

/**
 * Paquets entamés d'une sélection (Semaine ou Composer) et leurs propositions. Async :
 * /resolve sur chronocatalog (en cache 15 min). En cas d'échec, on le dit sans casser la page.
 */
export async function leftoversFor(db: Db, sel: { slug: string; factor?: number; extras?: Record<string, number> }[]): Promise<{ leftovers: Leftover[]; error: string | null }> {
  if (!sel.length) return { leftovers: [], error: null };
  try {
    const lib = library(db);
    const bySlug = new Map(lib.map((r) => [r.slug, r]));
    const chosen = sel.map((x) => ({ x, r: bySlug.get(x.slug) })).filter((c): c is { x: (typeof sel)[number]; r: LibRecipe } => !!c.r);
    const ings = loadIngredients(db, chosen.map((c) => c.r.id));
    const [{ profiles }, tastes] = [await loadProfiles(db, lib), loadTastes(db, lib)];
    const names = Object.fromEntries(db.select({ id: people.id, name: people.name }).from(people).all().map((p) => [p.id, p.name]));
    const leftovers = await selectionLeftovers(
      chosen.map(({ x, r }) => ({ id: r.id, slug: r.slug, name: r.name, servingsUnits: r.servingsUnits, factor: x.factor ?? 1, extras: x.extras ?? {}, ingredients: ings.get(r.id) ?? [] })),
      { library: lib, profiles, dislikes: tastes.dislikes, names, resolveLine: lineResolver(), resolveTotal: totalResolver(), associations: loadAssociations(db), lead: leadOf(loadEaters(db)) }
    );
    return { leftovers, error: null };
  } catch (e) {
    console.error("[semaine] paquets entamés :", e);
    return { leftovers: [], error: "chronocatalog ne répond pas : les paquets entamés ne sont pas calculés." };
  }
}

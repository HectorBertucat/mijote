// Goûts et variantes réelles vus par la base : les retours de chacun (taste_feedback), les ingrédients
// remplacés (recipe_swaps) et la nutrition d'une réserve qui en tient compte, les ajustements proposés et
// leur variante enregistrée. Le calcul est dans ./core, ./swap et ./adjust (purs, testés).
import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { cookSessions, mealBoxes, people, recipes, recipeSwaps, reserves, reserveServings, tasteFeedback } from "@/lib/db/schema";
import { loadRecipeInput, saveDraft } from "@/lib/atelier/library";
import { householdMembers } from "@/lib/eaters/store";
import { FOODS, isFoodId } from "@/lib/nutrition/foods";
import { getRecipe } from "@/lib/recipes/queries";
import type { RecipeInput } from "@/lib/recipes/format";
import { calcModel } from "@/lib/reserve/store";
import { macrosOf, type ReserveGroup } from "@/lib/reserve/core";
import type { SessionPlan } from "@/lib/session/planner";
import { adjustRecipe, variantNaming, type Adjustment } from "./adjust";
import { isTag, NOTE_MAX, RATINGS, TASTE_TAGS, type Feedback, type TasteTag } from "./core";
import { recipeFeedback, toFeedback } from "./read";
import { canSwap, rescaleGroups, swapOptions, type Swap } from "./swap";

export class FeedbackError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

// ─── Retours de goût ───

export const FeedbackInput = z.object({
  rating: z.enum(RATINGS),
  tags: z.array(z.enum(TASTE_TAGS)).max(TASTE_TAGS.length).default([]),
  note: z.string().trim().max(NOTE_MAX).nullish(),
});
export type FeedbackInput = z.input<typeof FeedbackInput>;

/**
 * Note un retour de goût pour une recette. `servingId` : la portion mangée qui l'a fait naître (elle doit
 * être à cette personne) ; sans recette donnée, c'est celle de la portion.
 */
export function saveFeedback(db: Db, input: { recipeId?: string | null; personId: string; servingId?: string | null } & FeedbackInput, now = new Date()): Feedback {
  const parsed = FeedbackInput.safeParse(input);
  if (!parsed.success) throw new FeedbackError("Note j’adore, ok ou bof, et des étiquettes connues.");
  const person = db.select({ id: people.id, name: people.name }).from(people).where(eq(people.id, input.personId)).get();
  if (!person) throw new FeedbackError("Personne inconnue.", 404);
  let recipeId = input.recipeId ?? null;
  if (input.servingId) {
    const s = db.select({ personId: reserveServings.personId, recipeId: reserves.recipeId }).from(reserveServings).innerJoin(reserves, eq(reserves.id, reserveServings.reserveId)).where(eq(reserveServings.id, input.servingId)).get();
    if (!s || s.personId !== person.id) throw new FeedbackError("Cette portion n’est pas la tienne.", 404);
    if (recipeId && s.recipeId && recipeId !== s.recipeId) throw new FeedbackError("Cette portion n’est pas de ce plat.");
    recipeId = recipeId ?? s.recipeId;
  }
  if (!recipeId || !db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, recipeId)).get()) throw new FeedbackError("Recette inconnue.", 404);
  const f = parsed.data;
  const row = {
    id: randomUUID(),
    recipeId,
    personId: person.id,
    rating: f.rating,
    tags: [...new Set(f.tags)],
    note: f.note ? f.note : null,
    servingId: input.servingId ?? null,
    createdAt: now.toISOString(),
  };
  db.insert(tasteFeedback).values(row).run();
  return toFeedback(row, person.name);
}

// ─── Ingrédients remplacés ───

export interface SwapView {
  id: string;
  position: number;
  from: string;
  to: string;
  toFood: string;
  at: string;
  where: "session" | "reserve" | null;
}

/** Les remplacements notés pour une recette, le plus récent d'abord. */
export function recipeSwapsOf(db: Db, recipeId: string): SwapView[] {
  const ings = getRecipeIngredients(db, recipeId);
  return db
    .select()
    .from(recipeSwaps)
    .where(eq(recipeSwaps.recipeId, recipeId))
    .orderBy(desc(recipeSwaps.createdAt))
    .all()
    .map((s) => ({
      id: s.id,
      position: s.position,
      from: ings[s.position]?.item.split(/[,(]/)[0].trim() ?? (s.fromFood && isFoodId(s.fromFood) ? FOODS[s.fromFood].name : "?"),
      to: isFoodId(s.toFood) ? FOODS[s.toFood].name : s.toFood,
      toFood: s.toFood,
      at: s.createdAt,
      where: s.reserveId ? ("reserve" as const) : s.sessionId ? ("session" as const) : null,
    }));
}

const getRecipeIngredients = (db: Db, recipeId: string) => {
  const slug = db.select({ slug: recipes.slug }).from(recipes).where(eq(recipes.id, recipeId)).get()?.slug;
  return slug ? (getRecipe(db, slug)?.ingredients ?? []) : [];
};

/** Les remplacements à proposer dans une variante : le dernier noté pour chaque ligne. */
export function latestSwaps(db: Db, recipeId: string): Swap[] {
  const seen = new Set<number>();
  const out: Swap[] = [];
  for (const s of recipeSwapsOf(db, recipeId)) {
    if (seen.has(s.position)) continue;
    seen.add(s.position);
    out.push({ position: s.position, toFood: s.toFood });
  }
  return out.sort((a, b) => a.position - b.position);
}

/** Les lignes qu'on peut remplacer, et par quoi (même famille d'aliments). */
export function swappable(db: Db, recipeId: string): { position: number; item: string; food: string; options: { food: string; label: string }[] }[] {
  return getRecipeIngredients(db, recipeId)
    .map((i) => ({ position: i.position, item: i.item, food: i.foodId ?? "", options: swapOptions(i.foodId) }))
    .filter((x) => x.options.length > 0);
}

/** À quoi rattacher un remplacement noté depuis la fiche : la réserve ouverte du plat, sinon la session en cours. */
export function swapTarget(db: Db, recipeId: string): { reserveId: string | null; sessionId: string | null; label: string } {
  const r = db.select({ id: reserves.id, sessionId: reserves.sessionId, cookedOn: reserves.cookedOn }).from(reserves).where(and(eq(reserves.recipeId, recipeId), eq(reserves.status, "open"))).orderBy(desc(reserves.cookedOn)).get();
  if (r) return { reserveId: r.id, sessionId: r.sessionId, label: "le plat en réserve" };
  const slug = db.select({ slug: recipes.slug }).from(recipes).where(eq(recipes.id, recipeId)).get()?.slug;
  const live = db
    .select({ id: cookSessions.id, planJson: cookSessions.planJson })
    .from(cookSessions)
    .where(and(inArray(cookSessions.status, ["prep", "fridge", "cooking"]), eq(cookSessions.test, false)))
    .orderBy(desc(cookSessions.startedAt))
    .all()
    .find((s) => ((s.planJson as SessionPlan | null)?.recipes ?? []).some((x) => x.slug === slug));
  if (live) return { reserveId: null, sessionId: live.id, label: "la session en cours" };
  return { reserveId: null, sessionId: null, label: "la prochaine fois" };
}

/**
 * Note un remplacement (patate douce → pomme de terre) : rattaché à la réserve ou à la session (par
 * défaut : `swapTarget`). Une réserve déjà rangée garde ses grammes ; ses kcal et protéines par gramme,
 * et celles de ses boîtes encore en stock, suivent le nouvel aliment.
 */
export function recordSwap(db: Db, input: { recipeId: string; position: number; toFood: string; reserveId?: string | null; sessionId?: string | null }, now = new Date()): SwapView {
  const ings = getRecipeIngredients(db, input.recipeId);
  const ing = ings[input.position];
  if (!ing) throw new FeedbackError("Ingrédient inconnu.", 404);
  if (!canSwap(ing.foodId, input.toFood)) throw new FeedbackError("Remplacement impossible : choisis un aliment de la même famille.");
  const target = input.reserveId !== undefined || input.sessionId !== undefined ? { reserveId: input.reserveId ?? null, sessionId: input.sessionId ?? null } : swapTarget(db, input.recipeId);
  let reserveId = target.reserveId;
  let sessionId = target.sessionId;
  if (reserveId) {
    const r = db.select({ recipeId: reserves.recipeId, sessionId: reserves.sessionId }).from(reserves).where(eq(reserves.id, reserveId)).get();
    if (!r || r.recipeId !== input.recipeId) throw new FeedbackError("Ce plat n’est pas de cette recette.", 404);
    sessionId = sessionId ?? r.sessionId;
  } else if (sessionId) {
    // Déjà rangée (ou estimée) pour cette session : la réserve suit aussi.
    reserveId = db.select({ id: reserves.id }).from(reserves).where(and(eq(reserves.sessionId, sessionId), eq(reserves.recipeId, input.recipeId))).get()?.id ?? null;
  }
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const id = randomUUID();
    const at = now.toISOString();
    t.insert(recipeSwaps).values({ id, recipeId: input.recipeId, position: input.position, fromFood: ing.foodId, toFood: input.toFood, sessionId, reserveId, createdAt: at }).run();
    if (reserveId) renourish(t, reserveId, now);
    return recipeSwapsOf(t, input.recipeId).find((s) => s.id === id)!;
  });
}

/** La nutrition d'une réserve rangée, refaite avec ses remplacements (grammes gardés). */
function renourish(db: Db, reserveId: string, now: Date) {
  const row = db.select().from(reserves).where(eq(reserves.id, reserveId)).get();
  if (!row?.recipeId) return;
  const r = db.select({ slug: recipes.slug, servingsUnits: recipes.servingsUnits }).from(recipes).where(eq(recipes.id, row.recipeId)).get();
  if (!r) return;
  const all = db.select().from(recipeSwaps).where(and(eq(recipeSwaps.reserveId, reserveId))).orderBy(asc(recipeSwaps.createdAt)).all();
  const scale = row.cookedUnits && r.servingsUnits ? row.cookedUnits / r.servingsUnits : 1;
  const before = calcModel(db, r.slug, { scale, swaps: all.slice(0, -1) }, now);
  const after = calcModel(db, r.slug, { scale, swaps: all }, now);
  if (!before || !after) return;
  const groups: ReserveGroup[] = rescaleGroups(row.groups, before.groups, after.groups);
  db.update(reserves).set({ groups, kcalUnit: after.kcalUnit, proteinUnit: after.proteinUnit, updatedAt: now.toISOString() }).where(eq(reserves.id, reserveId)).run();
  // Les boîtes encore en stock ont leurs kcal figées au rangement : elles suivent.
  for (const b of db.select().from(mealBoxes).where(and(eq(mealBoxes.reserveId, reserveId), eq(mealBoxes.status, "stock"))).all()) {
    if (!b.portion) continue;
    const m = macrosOf(groups, b.portion);
    db.update(mealBoxes).set({ kcal: m.kcal, proteinG: m.protein }).where(eq(mealBoxes.id, b.id)).run();
  }
}

// ─── Ajustements et variantes ───

/** La fiche au format standard, avec ses sous-étapes et ses groupes servis (ce que garde une variante). */
export function fullRecipeInput(db: Db, slug: string): RecipeInput | null {
  const base = loadRecipeInput(db, slug);
  const d = getRecipe(db, slug);
  if (!base || !d) return null;
  return {
    ...base,
    steps: base.steps.map((s, k) => ({ ...s, phases: d.steps[k]?.step.phases ?? null })),
    serve: d.recipe.serveJson ?? null,
  };
}

export interface AdjustView {
  recipeId: string;
  /** Les étiquettes à corriger d'après les retours en cours. */
  issues: TasteTag[];
  swaps: Swap[];
  adjustment: Adjustment;
}

/** Ce que les retours (et les remplacements) proposent pour une recette ; `tags` et `withSwaps` : le choix de la personne. */
export function adjustmentFor(db: Db, slug: string, opts: { tags?: TasteTag[]; withSwaps?: boolean; leadId?: string | null } = {}): AdjustView | null {
  const original = fullRecipeInput(db, slug);
  const id = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, slug)).get()?.id;
  if (!original || !id) return null;
  const { issues } = recipeFeedback(db, id);
  const swaps = latestSwaps(db, id);
  const tags = (opts.tags ?? issues).filter(isTag);
  const adjustment = adjustRecipe(original, tags, householdMembers(db, opts.leadId), opts.withSwaps === false ? [] : swaps);
  return { recipeId: id, issues, swaps, adjustment };
}

/** Enregistre la variante ajustée (refaite ici, jamais reprise du navigateur) : « à essayer », l'originale reste. */
export function saveAdjustedVariant(db: Db, slug: string, opts: { tags: TasteTag[]; withSwaps: boolean; leadId?: string | null }): { slug: string; name: string } {
  const v = adjustmentFor(db, slug, opts);
  if (!v) throw new FeedbackError("Recette inconnue.", 404);
  const a = v.adjustment;
  if (a.empty) throw new FeedbackError("Rien à ajuster.");
  const original = fullRecipeInput(db, slug)!;
  const naming = variantNaming(original, a.recipe, a);
  const explanation = `Ajustée d’après les retours (${a.changes.map((c) => c.text).join(" ; ")}).`;
  const newSlug = saveDraft(db, { ...a.recipe, slug: naming.slug, name: naming.name }, { parent: { slug: original.slug, name: original.name }, explanation: explanation.slice(0, 600), origin: "ajuster" });
  return { slug: newSlug, name: naming.name };
}

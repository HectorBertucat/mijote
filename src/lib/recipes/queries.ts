// Lectures de la bibliothèque (pages serveur).
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, cookUsages, equipment, people, recipeIngredients, recipeNotes, recipes, recipeSteps } from "@/lib/db/schema";
import { inSeason } from "./season";

export function listRecipes(db: Db) {
  return db
    .select({
      id: recipes.id,
      slug: recipes.slug,
      name: recipes.name,
      description: recipes.description,
      tags: recipes.tags,
      status: recipes.status,
      fridgeDays: recipes.fridgeDays,
      freezerOk: recipes.freezerOk,
      kcalUnit: recipes.kcalUnit,
      proteinUnit: recipes.proteinUnit,
      carbsUnit: recipes.carbsUnit,
      fatUnit: recipes.fatUnit,
      fiberUnit: recipes.fiberUnit,
      servingsUnits: recipes.servingsUnits,
      parentId: recipes.parentId,
      notesCount: sql<number>`(select count(*) from recipe_notes n where n.recipe_id = "recipes"."id")`,
      lastNoteAt: sql<string | null>`(select max(n.created_at) from recipe_notes n where n.recipe_id = "recipes"."id")`,
    })
    .from(recipes)
    .where(sql`${recipes.status} != 'archived'`)
    .orderBy(asc(recipes.name))
    .all();
}

/** Les ingrédients qui se voient le plus dans chaque recette (hors placard et facultatifs), pour ses dessins. */
export function listKeyIngredients(db: Db, max = 5) {
  const rows = db
    .select({ recipeId: recipeIngredients.recipeId, item: recipeIngredients.item, foodId: recipeIngredients.foodId, grams: recipeIngredients.grams, units: recipeIngredients.units })
    .from(recipeIngredients)
    .where(sql`${recipeIngredients.pantry} = 0 and ${recipeIngredients.optional} = 0 and coalesce(${recipeIngredients.foodId}, '') not in ('zero', 'huile')`)
    .all();
  const by = new Map<string, { item: string; foodId: string | null; weight: number }[]>();
  for (const r of rows) {
    const list = by.get(r.recipeId) ?? [];
    if (!list.some((x) => x.foodId != null && x.foodId === r.foodId)) list.push({ item: r.item, foodId: r.foodId, weight: r.grams ?? (r.units ?? 0) * 50 });
    by.set(r.recipeId, list);
  }
  return new Map([...by].map(([id, list]) => [id, list.sort((a, b) => b.weight - a.weight).slice(0, max)]));
}

/** Combien de fois chaque recette a été cuisinée (par id) : sessions terminées hors test, plus « J'ai cuisiné » sans session (un par jour). */
export function cookedCounts(db: Db): Map<string, number> {
  const idOf = new Map(db.select({ id: recipes.id, slug: recipes.slug }).from(recipes).all().map((r) => [r.slug, r.id]));
  const out = new Map<string, number>();
  const add = (id: string | undefined) => id && out.set(id, (out.get(id) ?? 0) + 1);
  for (const s of db.select({ plan: cookSessions.planJson }).from(cookSessions).where(sql`${cookSessions.status} = 'done' and ${cookSessions.test} = 0`).all()) {
    const rs = (s.plan as { recipes?: { slug: string }[] } | null)?.recipes ?? [];
    for (const r of rs) add(idOf.get(r.slug));
  }
  const solo = db
    .select({ recipeId: cookUsages.recipeId, day: sql<string>`substr(${cookUsages.cookedAt}, 1, 10)` })
    .from(cookUsages)
    .where(sql`${cookUsages.sessionId} is null`)
    .groupBy(cookUsages.recipeId, sql`substr(${cookUsages.cookedAt}, 1, 10)`)
    .all();
  for (const u of solo) add(u.recipeId);
  return out;
}

/** Les produits de saison de chaque recette pour le mois donné (cachet « De saison »). */
export function seasonalByRecipe(db: Db, month: number): Map<string, string[]> {
  const rows = db.select({ recipeId: recipeIngredients.recipeId, item: recipeIngredients.item, food: recipeIngredients.foodId, optional: recipeIngredients.optional }).from(recipeIngredients).all();
  const by = new Map<string, { item: string; food: string | null }[]>();
  for (const r of rows) if (!r.optional) by.set(r.recipeId, [...(by.get(r.recipeId) ?? []), r]);
  const out = new Map<string, string[]>();
  for (const [id, ings] of by) {
    const s = inSeason(ings, month);
    if (s.length) out.set(id, s);
  }
  return out;
}

export function getRecipe(db: Db, slug: string) {
  const recipe = db.select().from(recipes).where(eq(recipes.slug, slug)).get();
  if (!recipe) return null;
  const ingredients = db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipe.id))
    .orderBy(asc(recipeIngredients.position))
    .all();
  const steps = db
    .select({ step: recipeSteps, equipmentName: equipment.name })
    .from(recipeSteps)
    .leftJoin(equipment, eq(equipment.id, recipeSteps.equipmentId))
    .where(eq(recipeSteps.recipeId, recipe.id))
    .orderBy(asc(recipeSteps.order))
    .all();
  const notes = db
    .select({ note: recipeNotes, personName: people.name })
    .from(recipeNotes)
    .leftJoin(people, eq(people.id, recipeNotes.personId))
    .where(eq(recipeNotes.recipeId, recipe.id))
    .orderBy(desc(recipeNotes.createdAt))
    .all();
  return { recipe, ingredients, steps, notes };
}

export function listPeople(db: Db) {
  return db.select({ id: people.id, name: people.name, portionUnits: people.portionUnits }).from(people).orderBy(asc(people.rank), asc(people.name)).all();
}

/** Recettes avec leurs étapes, pour l'estimation d'une session (deux requêtes, pas une par recette). */
export function listRecipesWithSteps(db: Db) {
  const rs = listRecipes(db);
  const steps = db
    .select({
      recipeId: recipeSteps.recipeId,
      kind: recipeSteps.kind,
      durationMin: recipeSteps.durationMin,
      activeMin: recipeSteps.activeMin,
      equipmentId: recipeSteps.equipmentId,
      ovenTemp: recipeSteps.ovenTemp,
    })
    .from(recipeSteps)
    .orderBy(asc(recipeSteps.order))
    .all();
  const byRecipe = new Map<string, typeof steps>();
  for (const s of steps) byRecipe.set(s.recipeId, [...(byRecipe.get(s.recipeId) ?? []), s]);
  return rs.map((r) => ({ ...r, steps: byRecipe.get(r.id) ?? [] }));
}

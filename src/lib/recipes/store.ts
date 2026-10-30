// Écriture d'une recette au format standard. Réimporter une recette remplace ses
// ingrédients et ses étapes, mais garde son id et ses notes.
import { eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Db } from "@/lib/db/open";
import { recipeIngredients, recipes, recipeSteps } from "@/lib/db/schema";
import { RecipeInput } from "./format";
import { fallbackPhases, needsPhases, withPhases } from "./phases";
import { computeNutrition } from "@/lib/nutrition/compute";

export function upsertRecipe(db: Db, raw: unknown, fixtureHash: string | null = null): { id: string; created: boolean } {
  const parsed = RecipeInput.parse(raw);
  // Filet de sécurité : une étape de cuisson n'entre jamais en base sans ses sous-étapes chronométrées
  // (les fiches du dépôt les écrivent, tests/phases.test.ts ; l'atelier les complète avant).
  const r = { ...parsed, steps: withPhases(parsed.steps).steps };
  return db.transaction((tx) => {
    const existing = tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, r.slug)).get();
    const id = existing?.id ?? randomUUID();
    const n = computeNutrition(
      r.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })),
      r.servingsUnits
    );
    // Les macros calculées remplacent l'estimation de la fiche dès que 80 % des ingrédients sont connus.
    const computed = n.coverage >= 0.8;
    const fields = {
      name: r.name,
      description: r.description ?? null,
      servingsUnits: r.servingsUnits,
      tags: r.tags,
      fridgeDays: r.fridgeDays ?? null,
      freezerOk: r.freezerOk,
      kcalUnit: computed ? n.perUnit.kcal : (r.kcalUnit ?? null),
      proteinUnit: computed ? n.perUnit.protein : (r.proteinUnit ?? null),
      carbsUnit: computed ? n.perUnit.carbs : null,
      fatUnit: computed ? n.perUnit.fat : null,
      fiberUnit: computed ? n.perUnit.fiber : null,
      nutritionCoverage: n.coverage,
      fixtureHash,
      status: r.status,
      source: r.source ?? null,
      tips: r.tips ?? null,
    };
    const keepIds = new Map<number, string>();
    if (existing) {
      tx.update(recipes).set({ ...fields, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` }).where(eq(recipes.id, id)).run();
      // On garde les ids des ingrédients à la même position : les listes de courses et
      // les achats y sont liés (shopping_item_sources). Les lignes en trop sont supprimées.
      const kept = tx.select({ id: recipeIngredients.id, position: recipeIngredients.position }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).all();
      for (const k of kept) {
        if (k.position < r.ingredients.length) keepIds.set(k.position, k.id);
        else tx.delete(recipeIngredients).where(eq(recipeIngredients.id, k.id)).run();
      }
      tx.delete(recipeSteps).where(eq(recipeSteps.recipeId, id)).run();
    } else {
      tx.insert(recipes).values({ id, slug: r.slug, ...fields }).run();
    }
    r.ingredients.forEach((ing, i) => {
      const values = {
        recipeId: id,
        position: i,
        lineRaw: ing.lineRaw,
        item: ing.item,
        grams: ing.grams ?? null,
        units: ing.units ?? null,
        group: ing.group ?? null,
        optional: ing.optional ?? false,
        pantry: ing.pantry ?? false,
        side: ing.side ?? false,
        foodId: ing.food ?? null,
        yield: ing.yield ?? null,
      };
      const keep = keepIds.get(i);
      if (keep) tx.update(recipeIngredients).set(values).where(eq(recipeIngredients.id, keep)).run();
      else tx.insert(recipeIngredients).values({ id: randomUUID(), ...values }).run();
    });
    r.steps.forEach((s, i) =>
      tx
        .insert(recipeSteps)
        .values({
          id: randomUUID(),
          recipeId: id,
          order: i + 1,
          kind: s.kind,
          text: s.text,
          durationMin: s.durationMin ?? null,
          activeMin: s.activeMin ?? null,
          equipmentId: s.equipmentId ?? null,
          equipmentAlt: s.equipmentAlt?.length ? s.equipmentAlt : null,
          hobLevel: s.hobLevel ?? null,
          ovenTemp: s.ovenTemp ?? null,
          bowlRefs: s.bowls ?? [],
          cue: s.cue ?? null,
          phases: s.phases?.length ? s.phases : null,
        })
        .run()
    );
    return { id, created: !existing };
  });
}

/**
 * Les étapes de cuisson déjà en base sans sous-étapes (variantes et recettes de l'atelier d'avant
 * qu'elles soient obligatoires) les reçoivent, découpées dans leur texte. Idempotent : au démarrage.
 */
export function backfillPhases(db: Db): number {
  const rows = db.select().from(recipeSteps).where(isNull(recipeSteps.phases)).all();
  let n = 0;
  for (const s of rows) {
    const step = { kind: s.kind, text: s.text, durationMin: s.durationMin, activeMin: s.activeMin, hobLevel: s.hobLevel, bowls: s.bowlRefs };
    if (!needsPhases(step)) continue;
    db.update(recipeSteps).set({ phases: fallbackPhases(step) }).where(eq(recipeSteps.id, s.id)).run();
    n++;
  }
  return n;
}

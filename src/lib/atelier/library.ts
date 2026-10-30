// Lectures et écritures de l'atelier dans la base : recette au format RecipeInput,
// bibliothèque (pour les doublons et les restes), contexte du prompt, enregistrement.
import { and, asc, eq, like, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { equipment, people, preferences, recipeIngredients, recipes } from "@/lib/db/schema";
import { RecipeInput } from "@/lib/recipes/format";
import { getRecipe } from "@/lib/recipes/queries";
import { upsertRecipe } from "@/lib/recipes/store";
import { gramsOf } from "@/lib/nutrition/compute";
import type { PromptContext } from "./prompt";
import { householdMembers } from "@/lib/eaters/store";
import { storeLabel } from "@/lib/settings";
import type { LibraryRecipe } from "./verify";

export function loadRecipeInput(db: Db, slug: string): RecipeInput | null {
  const d = getRecipe(db, slug);
  if (!d) return null;
  const r = d.recipe;
  return RecipeInput.parse({
    slug: r.slug,
    name: r.name,
    description: r.description,
    servingsUnits: r.servingsUnits,
    tags: r.tags,
    fridgeDays: r.fridgeDays,
    freezerOk: r.freezerOk,
    kcalUnit: r.kcalUnit,
    proteinUnit: r.proteinUnit,
    status: r.status,
    source: r.source,
    tips: r.tips,
    ingredients: d.ingredients.map((i) => ({
      lineRaw: i.lineRaw,
      item: i.item,
      grams: i.grams,
      units: i.units,
      group: i.group,
      optional: i.optional,
      pantry: i.pantry,
      ...(i.side ? { side: true } : {}),
      food: i.foodId,
      yield: i.yield ?? null,
    })),
    steps: d.steps.map(({ step: s }) => ({
      kind: s.kind,
      text: s.text,
      durationMin: s.durationMin,
      activeMin: s.activeMin,
      equipmentId: s.equipmentId,
      equipmentAlt: s.equipmentAlt,
      hobLevel: s.hobLevel,
      ovenTemp: s.ovenTemp,
      bowls: s.bowlRefs,
      cue: s.cue,
    })),
  });
}

export function loadLibrary(db: Db): LibraryRecipe[] {
  const rs = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name, status: recipes.status }).from(recipes).orderBy(asc(recipes.name)).all();
  const ings = db
    .select({ recipeId: recipeIngredients.recipeId, item: recipeIngredients.item, food: recipeIngredients.foodId, grams: recipeIngredients.grams, units: recipeIngredients.units, pantry: recipeIngredients.pantry })
    .from(recipeIngredients)
    .orderBy(asc(recipeIngredients.position))
    .all();
  const by = new Map<string, LibraryRecipe["ingredients"]>();
  for (const { recipeId, ...i } of ings) by.set(recipeId, [...(by.get(recipeId) ?? []), i]);
  return rs.map((r) => ({ ...r, ingredients: by.get(r.id) ?? [] }));
}

/** Les ingrédients principaux d'une recette (les plus lourds hors placard), pour le prompt. */
export function mainIngredients(r: LibraryRecipe, n = 3): string[] {
  return r.ingredients
    .filter((i) => !i.pantry && i.food !== "zero")
    .map((i) => ({ i, g: gramsOf({ item: i.item, food: i.food, grams: i.grams, units: i.units }) ?? 0 }))
    .sort((a, b) => b.g - a.g)
    .slice(0, n)
    .map((x) => x.i.item.split(/[,(]/)[0].trim());
}

export function promptContext(db: Db, leadId?: string | null): PromptContext {
  const hobs = db.select({ dims: equipment.dimsJson, name: equipment.name }).from(equipment).where(and(eq(equipment.kind, "hob"), eq(equipment.owned, true))).all();
  const levels = hobs.map((h) => Number(h.dims?.levels)).find((n) => Number.isFinite(n) && n > 0) ?? null;
  const kind = hobs.map((h) => (typeof h.dims?.type === "string" ? h.dims.type : null)).find(Boolean) ?? null;
  const names = new Map(db.select({ id: people.id, name: people.name }).from(people).all().map((p) => [p.id, p.name]));
  return {
    preferences: db
      .select()
      .from(preferences)
      .orderBy(asc(preferences.id))
      .all()
      .map((p) => ({ who: p.personId ? (names.get(p.personId) ?? p.personId) : null, kind: p.kind, text: p.text })),
    equipment: db
      .select({ id: equipment.id, name: equipment.name, notes: equipment.notes, maxBatchG: equipment.maxBatchG, kind: equipment.kind })
      .from(equipment)
      .where(eq(equipment.owned, true))
      .orderBy(asc(equipment.id))
      .all()
      .filter((e) => e.kind !== "hob")
      .map(({ kind: _k, ...e }) => e),
    household: householdMembers(db, leadId),
    hob: { count: hobs.length, levels, kind },
    store: storeLabel(db),
  };
}

export function equipmentIds(db: Db): Set<string> {
  return new Set(db.select({ id: equipment.id }).from(equipment).where(eq(equipment.owned, true)).all().map((e) => e.id));
}

function uniqueSlug(db: Db, base: string): string {
  const taken = new Set(
    db
      .select({ slug: recipes.slug })
      .from(recipes)
      .where(or(eq(recipes.slug, base), like(recipes.slug, `${base}-%`)))
      .all()
      .map((r) => r.slug)
  );
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(`${base}-${k}`)) return `${base}-${k}`;
}

/** Texte lisible du lien variante → originale dans `source` ; le lien qui compte est `recipes.parent_id` (migration 0011). */
export const VARIANT_SOURCE = /^Variante de « (.+?) » \(\/recettes\/([a-z0-9-]+)\)/;

/**
 * Enregistre une nouvelle recette (statut « à essayer »), sans jamais écraser une
 * recette existante : le slug reçoit un suffixe s'il est pris.
 */
export function saveDraft(
  db: Db,
  draft: RecipeInput,
  opts: {
    parent?: { slug: string; name: string } | null;
    explanation?: string;
    unavailable?: boolean;
    origin: "ajuster" | "atelier" | "import";
    /** Import : le lien de la recette d'origine, gardé comme source. */
    source?: string | null;
    /** Quantités douteuses : la recette porte l'étiquette « à relire ». */
    review?: boolean;
  }
): string {
  // Une variante se rattache toujours à la racine : garder une variante de variante en fait une sœur.
  const root = opts.parent ? db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name, parentId: recipes.parentId }).from(recipes).where(eq(recipes.slug, opts.parent.slug)).get() : null;
  const top = root?.parentId ? db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name }).from(recipes).where(eq(recipes.id, root.parentId)).get() : root;
  const parent = top ? { slug: top.slug, name: top.name } : opts.parent;
  const base = parent && !draft.slug.startsWith(parent.slug) ? `${parent.slug}-${draft.slug}`.slice(0, 70) : draft.slug;
  const slug = uniqueSlug(db, base);
  const tags = draft.tags.filter((t) => t !== "indisponible" && t !== "à relire");
  tags.push(opts.origin === "ajuster" ? "variante" : opts.origin === "import" ? "importée" : "atelier");
  if (opts.unavailable) tags.push("indisponible");
  if (opts.review) tags.push("à relire");
  const source = parent
    ? `Variante de « ${parent.name} » (/recettes/${parent.slug}). ${opts.explanation ?? ""}`.trim()
    : opts.origin === "import"
      ? opts.source || "Importée depuis un texte collé."
      : `Créée dans l'atelier. ${opts.explanation ?? ""}`.trim();
  const { id } = upsertRecipe(db, { ...draft, slug, tags: [...new Set(tags)], status: "to_try", kcalUnit: null, proteinUnit: null, source });
  if (top) db.update(recipes).set({ parentId: top.id }).where(eq(recipes.id, id)).run();
  return slug;
}

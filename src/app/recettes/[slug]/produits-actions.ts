"use server";

// Onglet « Produits du drive » : accepter, refuser, préférer un produit pour un ingrédient,
// réglage propre au plat, recherche. Chaque action renvoie l'état à jour de l'ingrédient.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { recipeIngredients, recipes } from "@/lib/db/schema";
import { ALL } from "@/lib/products/core";
import { buyIngredients, ficheResolver, ingredientState, recipeIngredientStates, type IngredientProducts, type IngredientState } from "@/lib/products/fiche";
import { acceptProduct, dropOverride, forgetProduct, loadAssociations, refuseProduct, setPreferred, startOverride } from "@/lib/products/store";
import { resolveIngredient } from "@/lib/shopping/build";
import { productCard, searchCatalog, type CatalogChoice } from "@/lib/shopping/cart";
import { search } from "@/lib/chronocatalog";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof Error ? e.message : "Action impossible." });

function lineOf(slug: string, ingredientId: string) {
  const row = db
    .select({ ing: recipeIngredients })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(and(eq(recipes.slug, slug), eq(recipeIngredients.id, ingredientId)))
    .get();
  if (!row) throw new Error("Ingrédient inconnu.");
  return row.ing;
}

async function stateOf(slug: string, ingredientId: string): Promise<IngredientState> {
  const ing = lineOf(slug, ingredientId);
  const r = await resolveIngredient(ing, ficheResolver()).catch(() => null);
  return ingredientState(ing, r, loadAssociations(db));
}

async function done(slug: string, ingredientId: string): Promise<Result<{ state: IngredientProducts }>> {
  revalidatePath(`/recettes/${slug}`);
  return { ok: true, state: (await stateOf(slug, ingredientId)).view };
}

/** La carte complète d'un produit : déjà connue de l'ingrédient, sinon depuis la recherche. */
async function cardFor(s: IngredientState, productId: string, query?: string) {
  const known = s.cards.get(productId);
  if (known) return known;
  if (!query) throw new Error("Produit inconnu : relance la recherche.");
  const hits = await search(query, { limit: 30 }).catch(() => null);
  const hit = hits?.results.find((h) => (h.productId ?? h.id) === productId) ?? null;
  return productCard(productId, hit?.name ?? query, hit);
}

const scopeOf = (ingredientId: string, scope: "all" | "recipe") => (scope === "recipe" ? ingredientId : ALL);

export async function acceptAction(
  slug: string,
  ingredientId: string,
  productId: string,
  opts: { scope: "all" | "recipe"; query?: string; preferred?: boolean }
): Promise<Result<{ state: IngredientProducts }>> {
  try {
    const s = await stateOf(slug, ingredientId);
    const card = await cardFor(s, productId, opts.query);
    // Premier produit d'un réglage « pour ce plat » : on part des produits communs.
    if (opts.scope === "recipe" && !s.view.hasOverride) startOverride(db, { ...s.target, scope: ingredientId });
    acceptProduct(db, { ...s.target, scope: scopeOf(ingredientId, opts.scope) }, card, { preferred: opts.preferred });
    return done(slug, ingredientId);
  } catch (e) {
    return fail(e);
  }
}

export async function refuseAction(slug: string, ingredientId: string, productId: string, scope: "all" | "recipe"): Promise<Result<{ state: IngredientProducts }>> {
  try {
    const s = await stateOf(slug, ingredientId);
    refuseProduct(db, { ...s.target, scope: scopeOf(ingredientId, scope) }, await cardFor(s, productId));
    return done(slug, ingredientId);
  } catch (e) {
    return fail(e);
  }
}

/** Retirer un produit accepté (scope du réglage affiché) ou annuler un refus (commun). */
export async function forgetAction(slug: string, ingredientId: string, productId: string, what: "accepted" | "refused", scope: "all" | "recipe"): Promise<Result<{ state: IngredientProducts }>> {
  try {
    const s = await stateOf(slug, ingredientId);
    forgetProduct(db, s.target.key, what === "refused" ? ALL : scopeOf(ingredientId, scope), productId);
    return done(slug, ingredientId);
  } catch (e) {
    return fail(e);
  }
}

export async function preferAction(slug: string, ingredientId: string, productId: string, on: boolean, scope: "all" | "recipe"): Promise<Result<{ state: IngredientProducts }>> {
  try {
    const s = await stateOf(slug, ingredientId);
    if (scope === "recipe" && !s.view.hasOverride) startOverride(db, { ...s.target, scope: ingredientId });
    setPreferred(db, { ...s.target, scope: scopeOf(ingredientId, scope) }, await cardFor(s, productId), on);
    return done(slug, ingredientId);
  } catch (e) {
    return fail(e);
  }
}

/** Réglage propre au plat (copie des produits communs), ou retour au réglage commun. */
export async function overrideAction(slug: string, ingredientId: string, on: boolean): Promise<Result<{ state: IngredientProducts }>> {
  try {
    const s = await stateOf(slug, ingredientId);
    if (on) startOverride(db, { ...s.target, scope: ingredientId });
    else dropOverride(db, s.target.key, ingredientId);
    return done(slug, ingredientId);
  } catch (e) {
    return fail(e);
  }
}

/** « Accepter la proposition » : le premier produit proposé de chaque ingrédient encore à associer, en commun. */
export async function acceptBestAction(slug: string): Promise<Result<{ states: IngredientProducts[]; count: number }>> {
  try {
    const r = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, slug)).get();
    if (!r) throw new Error("Recette inconnue.");
    const ings = buyIngredients(db, r.id);
    const before = await recipeIngredientStates(db, ings);
    let count = 0;
    for (const s of before) {
      const v = s.view;
      if (v.nothingToBuy || v.accepted.length || !v.candidates.length) continue;
      const best = v.candidates.find((c) => c.tone !== "ko" && !c.otherType) ?? null;
      const card = best && s.cards.get(best.id);
      if (!card) continue;
      acceptProduct(db, { ...s.target, scope: ALL }, card);
      count++;
    }
    revalidatePath(`/recettes/${slug}`);
    const after = await recipeIngredientStates(db, ings);
    return { ok: true, states: after.map((s) => s.view), count };
  } catch (e) {
    return fail(e);
  }
}

/** « Ajouter un produit » : recherche dans le catalogue (GET /search, produits disponibles). */
export async function searchProductsAction(q: string): Promise<Result<{ results: CatalogChoice[] }>> {
  try {
    return { ok: true, results: await searchCatalog(q, 10) };
  } catch (e) {
    return fail(e);
  }
}

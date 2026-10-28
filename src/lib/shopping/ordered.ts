// Ce qui a été commandé pour chaque ligne de recette (contrat pour la session de cuisine,
// documenté dans docs/schema.md). Le lien recette → courses → achat passe par
// shopping_item_sources (ligne de recette ↔ ligne de courses) et purchases.shopping_item_id.
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { purchases, recipeIngredients, recipes, shoppingItems, shoppingItemSources, shoppingLists } from "@/lib/db/schema";
import type { ResolvedProduct } from "@/lib/chronocatalog";

export interface OrderedProduct {
  productId: string | null;
  name: string;
  brandName: string | null;
  quantityLabel: string | null;
  packs: number;
  packG: number | null;
  /** grammes achetés pour toute la ligne de courses (tous ingrédients et recettes confondus) */
  lineBoughtG: number | null;
  ordered: boolean; // true : figé dans purchases ; false : encore prévu sur la liste
}

export interface OrderedIngredient {
  recipeIngredientId: string | null;
  lineRaw: string;
  item: string;
  needG: number | null;
  needUnits: number | null;
  pantry: boolean;
  optional: boolean;
  product: OrderedProduct | null;
  /** part des grammes achetés qui revient à cet ingrédient (au prorata des besoins de la ligne) */
  boughtG: number | null;
  gapG: number | null; // boughtG − needG : < 0 manque, > 0 reste au placard
  status: "ok" | "short" | "surplus" | "pantry" | "missing" | "unknown";
}

export interface OrderedRecipe {
  recipeId: string;
  slug: string;
  name: string;
  servingsUnits: number;
  ingredients: OrderedIngredient[];
  /** plus petit ratio acheté / besoin parmi les ingrédients non facultatifs en manque (1 sinon) */
  coverage: number;
  /** unités de la recette conseillées si un ingrédient manque (prorata), sinon servingsUnits */
  suggestedUnits: number;
}

const TOL = 0.03; // ±3 % : ni manque ni surplus

/**
 * orderedIngredientsFor(db, listId) : pour chaque recette de la liste, chaque ingrédient avec le
 * produit commandé (nom, marque, format, paquets, grammes achetés) et l'écart avec le besoin.
 * Manque → coverage < 1 et suggestedUnits (unités de la recette au prorata) ; surplus → reste au placard.
 */
export function orderedIngredientsFor(db: Db, listId: string): OrderedRecipe[] {
  const list = db.select().from(shoppingLists).where(eq(shoppingLists.id, listId)).get();
  if (!list) return [];
  const items = db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();
  if (!items.length) return [];
  const itemIds = items.map((i) => i.id);
  const sources = db.select().from(shoppingItemSources).where(inArray(shoppingItemSources.itemId, itemIds)).all();
  const bought = db.select().from(purchases).where(inArray(purchases.shoppingItemId, itemIds)).all();
  const purchaseOf = new Map(bought.map((p) => [p.shoppingItemId!, p]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const sourcesOf = new Map<string, typeof sources>();
  for (const s of sources) sourcesOf.set(s.itemId, [...(sourcesOf.get(s.itemId) ?? []), s]);

  const recipeIds = [...new Set(sources.map((s) => s.recipeId))];
  const rs = recipeIds.length ? db.select().from(recipes).where(inArray(recipes.id, recipeIds)).all() : [];
  const order = new Map(list.recipeSlugs.map((s, i) => [s, i]));
  rs.sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
  const ings = recipeIds.length
    ? db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, recipeIds)).orderBy(asc(recipeIngredients.position)).all()
    : [];
  const ingById = new Map(ings.map((i) => [i.id, i]));

  return rs.map((r) => {
    const mine = sources.filter((s) => s.recipeId === r.id);
    const out: OrderedIngredient[] = mine.map((s) => {
      const it = itemById.get(s.itemId)!;
      const ing = s.recipeIngredientId ? ingById.get(s.recipeIngredientId) : undefined;
      const base = {
        recipeIngredientId: s.recipeIngredientId,
        lineRaw: s.lineRaw,
        item: ing?.item ?? it.item,
        needG: s.grams ?? ing?.grams ?? null,
        needUnits: s.units ?? ing?.units ?? null,
        pantry: it.pantry,
        optional: ing?.optional ?? false,
      };
      if (it.pantry) return { ...base, product: null, boughtG: null, gapG: null, status: "pantry" as const };
      const p = it.productJson as ResolvedProduct | null;
      const pur = purchaseOf.get(it.id);
      const ordered = list.status === "ordered" || list.status === "paid";
      if (!p || (ordered && !pur)) return { ...base, product: null, boughtG: null, gapG: null, status: "missing" as const };
      const packs = pur?.packs ?? it.packs ?? 0;
      const packG = pur?.packG ?? p.weightG ?? null;
      const lineBoughtG = packG != null ? packs * packG : null;
      const product: OrderedProduct = { productId: p.id, name: pur?.name ?? p.name, brandName: p.brandName, quantityLabel: p.quantityLabel, packs, packG, lineBoughtG, ordered: !!pur };
      // Prorata : la part de cet ingrédient dans les besoins de la ligne de courses.
      const siblings = sourcesOf.get(it.id) ?? [];
      const sum = siblings.reduce((t, x) => t + (x.grams ?? 0), 0);
      const share = sum > 0 && s.grams != null ? s.grams / sum : 1 / Math.max(1, siblings.length);
      const boughtG = lineBoughtG != null ? Math.round(lineBoughtG * share) : null;
      if (packs === 0) return { ...base, product, boughtG: 0, gapG: base.needG != null ? -base.needG : null, status: "missing" as const };
      if (boughtG == null || base.needG == null) return { ...base, product, boughtG, gapG: null, status: "unknown" as const };
      const gapG = boughtG - base.needG;
      const status = gapG < -TOL * base.needG ? "short" : gapG > TOL * base.needG && gapG >= 5 ? "surplus" : "ok";
      return { ...base, product, boughtG, gapG, status };
    });
    const ratios = out
      .filter((i) => !i.optional && (i.status === "short" || i.status === "missing") && i.needG)
      .map((i) => Math.max(0, (i.boughtG ?? 0) / i.needG!));
    const coverage = ratios.length ? Math.min(1, ...ratios) : 1;
    const suggestedUnits = coverage < 1 ? Math.max(1, Math.floor(r.servingsUnits * coverage)) : r.servingsUnits;
    return { recipeId: r.id, slug: r.slug, name: r.name, servingsUnits: r.servingsUnits, ingredients: out, coverage, suggestedUnits };
  });
}

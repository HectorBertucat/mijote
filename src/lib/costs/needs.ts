// Les besoins d'une recette, lus sur la dernière liste de courses qui la contient :
// par ligne de courses (type de produit), les grammes de cette recette et le prix du catalogue.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { shoppingItems, shoppingItemSources, shoppingLists } from "@/lib/db/schema";
import type { ResolvedProduct } from "@/lib/chronocatalog";

export interface RecipeNeed {
  itemId: string;
  item: string; // libellé de la ligne de courses (type chronocatalog) : clé de rapprochement avec les lots
  pantry: boolean;
  needG: number | null; // grammes pour cette recette
  share: number; // part de la ligne qui revient à cette recette (0 à 1)
  pricePerG: number | null; // prix effectif du catalogue / poids du paquet
  lineTotal: number | null; // paquets entiers de la ligne (prix)
}

/** Part de chaque recette dans une ligne de courses, au prorata des grammes (à parts égales sinon). */
export function sharesOf(sources: { recipeId: string; grams: number | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!sources.length) return out;
  const sum = sources.reduce((t, s) => t + (s.grams ?? 0), 0);
  const known = sources.every((s) => s.grams != null) && sum > 0;
  for (const s of sources) out.set(s.recipeId, (out.get(s.recipeId) ?? 0) + (known ? s.grams! / sum : 1 / sources.length));
  return out;
}

export function latestNeeds(db: Db, recipeId: string): { listId: string; needs: RecipeNeed[] } | null {
  const row = db
    .select({ listId: shoppingLists.id })
    .from(shoppingItemSources)
    .innerJoin(shoppingItems, eq(shoppingItems.id, shoppingItemSources.itemId))
    .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingItems.listId))
    .where(and(eq(shoppingItemSources.recipeId, recipeId), isNull(shoppingLists.buildError)))
    .orderBy(desc(shoppingLists.createdAt))
    .limit(1)
    .get();
  if (!row) return null;
  const items = db.select().from(shoppingItems).where(eq(shoppingItems.listId, row.listId)).all();
  const sources = db.select().from(shoppingItemSources).where(inArray(shoppingItemSources.itemId, items.map((i) => i.id))).all();
  const needs: RecipeNeed[] = [];
  for (const it of items) {
    const src = sources.filter((s) => s.itemId === it.id);
    const share = sharesOf(src).get(recipeId);
    if (share == null) continue;
    const mine = src.filter((s) => s.recipeId === recipeId);
    const g = mine.every((s) => s.grams != null) ? mine.reduce((t, s) => t + s.grams!, 0) : it.needG != null ? it.needG * share : null;
    const p = it.productJson as ResolvedProduct | null;
    const pricePerG = it.unitPrice != null && p?.weightG ? it.unitPrice / p.weightG : null;
    needs.push({ itemId: it.id, item: it.item, pantry: it.pantry, needG: g, share, pricePerG, lineTotal: it.totalPrice });
  }
  return { listId: row.listId, needs };
}

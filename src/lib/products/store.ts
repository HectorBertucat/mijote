// Lecture et écriture des associations ingrédient ↔ produit (table ingredient_products).
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { ResolvedProduct } from "@/lib/chronocatalog";
import type { Db } from "@/lib/db/open";
import { ingredientProducts } from "@/lib/db/schema";
import { ALL, type AssocRow } from "./core";

/**
 * Carte du jour du choix, avec l'âge recalculé : une carte gardée en base vieillit (au-delà de
 * 24 h, elle est « ancienne » et la pastille le dit).
 */
export function ageCard(p: ResolvedProduct, now = Date.now()): ResolvedProduct {
  const a = p.availability;
  if (!a?.lastCheckedAt) return p;
  const ageHours = Math.round(((now - Date.parse(a.lastCheckedAt)) / 3_600_000) * 10) / 10;
  return { ...p, availability: { ...a, ageHours, stale: ageHours > 24 } };
}

const toRow = (r: typeof ingredientProducts.$inferSelect): AssocRow => ({
  key: r.key,
  scope: r.scope,
  productId: r.productId,
  status: r.status,
  preferred: r.preferred,
  product: r.productJson ? ageCard(r.productJson as ResolvedProduct) : null,
  decidedAt: r.decidedAt,
});

/** Toutes les associations (la table reste petite : quelques centaines de lignes). */
export function loadAssociations(db: Db, keys?: string[]): AssocRow[] {
  if (keys && !keys.length) return [];
  const q = db.select().from(ingredientProducts);
  return (keys ? q.where(inArray(ingredientProducts.key, keys)) : q).all().map(toRow);
}

/** Une carte produit allégée pour la base (sans champs inutiles à la décision). */
function snapshot(p: ResolvedProduct): ResolvedProduct {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    productUrl: p.productUrl,
    imageUrl: p.imageUrl,
    brandName: p.brandName,
    quantityLabel: p.quantityLabel,
    weightG: p.weightG,
    isFrozen: p.isFrozen,
    currentPrice: p.currentPrice,
    currentPricePerKg: p.currentPricePerKg,
    promoPriceEur: p.promoPriceEur,
    stockStatus: p.stockStatus,
    source: p.source,
    isFavorite: p.isFavorite,
    ...(p.availability ? { availability: p.availability } : {}),
  };
}

export interface AssocTarget {
  key: string;
  label: string;
  foodId?: string | null;
  /** ALL ou un recipe_ingredient_id */
  scope: string;
}

function upsert(db: Db, t: AssocTarget, product: ResolvedProduct, status: "accepted" | "refused", preferred: boolean) {
  const at = new Date().toISOString();
  db.insert(ingredientProducts)
    .values({ id: randomUUID(), key: t.key, scope: t.scope, label: t.label, foodId: t.foodId ?? null, productId: product.id, status, preferred, productJson: snapshot(product), decidedAt: at })
    .onConflictDoUpdate({
      target: [ingredientProducts.key, ingredientProducts.scope, ingredientProducts.productId],
      set: { status, preferred, label: t.label, productJson: snapshot(product), decidedAt: at },
    })
    .run();
}

/** « Accepter » : le produit convient pour cet ingrédient (dans ce scope). Lève un refus commun si on accepte en commun. */
export function acceptProduct(db: Db, t: AssocTarget, product: ResolvedProduct, opts: { preferred?: boolean } = {}) {
  db.transaction((tx) => {
    const d = tx as unknown as Db;
    if (opts.preferred) clearPreferred(d, t.key, t.scope);
    const prev = d.select().from(ingredientProducts).where(and(eq(ingredientProducts.key, t.key), eq(ingredientProducts.scope, t.scope), eq(ingredientProducts.productId, product.id))).get();
    upsert(d, t, product, "accepted", opts.preferred ?? (prev?.status === "accepted" ? prev.preferred : false));
  });
}

/** « Ne correspond pas » : refus commun (exclu de toutes les recettes), et retiré du réglage de la ligne. */
export function refuseProduct(db: Db, t: AssocTarget, product: ResolvedProduct) {
  db.transaction((tx) => {
    const d = tx as unknown as Db;
    upsert(d, { ...t, scope: ALL }, product, "refused", false);
    if (t.scope !== ALL)
      d.delete(ingredientProducts).where(and(eq(ingredientProducts.key, t.key), eq(ingredientProducts.scope, t.scope), eq(ingredientProducts.productId, product.id))).run();
  });
}

/** Retire un produit accepté, ou annule un refus (le produit redevient une simple proposition). */
export function forgetProduct(db: Db, key: string, scope: string, productId: string) {
  db.delete(ingredientProducts).where(and(eq(ingredientProducts.key, key), eq(ingredientProducts.scope, scope), eq(ingredientProducts.productId, productId))).run();
}

function clearPreferred(db: Db, key: string, scope: string) {
  db.update(ingredientProducts).set({ preferred: false }).where(and(eq(ingredientProducts.key, key), eq(ingredientProducts.scope, scope))).run();
}

/** « Préféré » : un seul par ingrédient et par scope ; le produit est accepté au passage. `on=false` le retire. */
export function setPreferred(db: Db, t: AssocTarget, product: ResolvedProduct, on: boolean) {
  db.transaction((tx) => {
    const d = tx as unknown as Db;
    clearPreferred(d, t.key, t.scope);
    if (on) upsert(d, t, product, "accepted", true);
  });
}

/** Réglage propre à une ligne de recette : part des produits communs acceptés (copiés). */
export function startOverride(db: Db, t: AssocTarget) {
  const common = db
    .select()
    .from(ingredientProducts)
    .where(and(eq(ingredientProducts.key, t.key), eq(ingredientProducts.scope, ALL), eq(ingredientProducts.status, "accepted")))
    .all();
  db.transaction((tx) => {
    for (const r of common) if (r.productJson) upsert(tx as unknown as Db, t, r.productJson as ResolvedProduct, "accepted", r.preferred);
  });
  return common.length;
}

/** Revient au réglage commun : supprime le réglage propre à la ligne. */
export function dropOverride(db: Db, key: string, scope: string) {
  if (scope === ALL) return;
  db.delete(ingredientProducts).where(and(eq(ingredientProducts.key, key), eq(ingredientProducts.scope, scope))).run();
}

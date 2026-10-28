// Le panier : cocher une ligne, ajuster les paquets, changer de produit, valider la commande.
// Valider fige les prix (prix effectif = promo ?? prix) en `purchases`, et crée un lot de
// placard par achat (`pantry_lots`, grammes et valeur restants). Déterministe, sans IA.
import { randomUUID } from "crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookUsages, pantryLots, purchases, shoppingItems, shoppingLists } from "@/lib/db/schema";
import { effectivePrice, resolve, search, type ResolvedProduct, type SearchHit } from "@/lib/chronocatalog";
import { rejudge } from "./build";
import { packsFor } from "./rules";

const round2 = (v: number) => Math.round(v * 100) / 100;

function getItem(db: Db, itemId: string) {
  const it = db.select().from(shoppingItems).where(eq(shoppingItems.id, itemId)).get();
  if (!it) throw new Error("Ligne introuvable.");
  return it;
}

function assertDraft(db: Db, listId: string) {
  const l = db.select({ status: shoppingLists.status }).from(shoppingLists).where(eq(shoppingLists.id, listId)).get();
  if (!l) throw new Error("Liste introuvable.");
  if (l.status === "ordered" || l.status === "paid") throw new Error("Commande déjà validée.");
}

export function setInCart(db: Db, itemId: string, on: boolean) {
  const it = getItem(db, itemId);
  assertDraft(db, it.listId);
  db.update(shoppingItems).set({ inCartAt: on ? new Date().toISOString() : null }).where(eq(shoppingItems.id, itemId)).run();
  return it.listId;
}

/** Coche (ou décoche) toutes les lignes à acheter. */
export function setAllInCart(db: Db, listId: string, on: boolean) {
  assertDraft(db, listId);
  // Avec un catalogue : les lignes qui ont un produit ; sans : toutes les lignes à acheter.
  const hasProducts = db.select({ id: shoppingItems.id }).from(shoppingItems).where(and(eq(shoppingItems.listId, listId), isNotNull(shoppingItems.chronoProductId))).limit(1).get();
  db.update(shoppingItems)
    .set({ inCartAt: on ? new Date().toISOString() : null })
    .where(and(eq(shoppingItems.listId, listId), eq(shoppingItems.pantry, false), hasProducts ? isNotNull(shoppingItems.chronoProductId) : undefined))
    .run();
}

/** +/− paquets : prix et pastille recalculés (limite par commande, stock restant). */
export function setPacks(db: Db, itemId: string, packs: number) {
  const it = getItem(db, itemId);
  assertDraft(db, it.listId);
  const p = it.productJson as ResolvedProduct | null;
  if (!p) throw new Error("Pas de produit sur cette ligne.");
  const n = Math.max(0, Math.min(99, Math.round(packs)));
  db.update(shoppingItems).set(rejudge(it, p, n)).where(eq(shoppingItems.id, itemId)).run();
  return { listId: it.listId, packs: n };
}

/** Un produit trouvé par la recherche du catalogue, prêt à afficher. */
export interface CatalogChoice {
  id: string;
  name: string;
  brandName: string | null;
  quantityLabel: string | null;
  weightG: number | null;
  price: number | null;
  promo: boolean;
  pricePerKg: number | null;
  imageUrl: string | null;
  available: boolean;
}

export function toChoice(h: SearchHit): CatalogChoice | null {
  const id = h.productId ?? h.id;
  if (!id) return null;
  const price = effectivePrice({ promoPriceEur: h.promoPriceEur ?? null, currentPrice: h.currentPrice ?? null });
  return {
    id,
    name: h.name,
    brandName: h.brandName ?? null,
    quantityLabel: h.quantityLabel ?? null,
    weightG: h.weightG ?? null,
    price,
    promo: h.promoPriceEur != null,
    pricePerKg: h.currentPricePerKg ?? null,
    imageUrl: h.imageUrl ?? null,
    available: h.availability ? !["out_of_stock", "unavailable"].includes(h.availability.status) : h.isAvailable !== false,
  };
}

/** Recherche dans le catalogue (GET /search, produits disponibles). Jamais /live. */
export async function searchCatalog(q: string, limit = 12): Promise<CatalogChoice[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const r = await search(query, { limit, available: true });
  return r.results.map(toChoice).filter((c): c is CatalogChoice => c != null);
}

/**
 * La carte produit complète (lien, disponibilité) : /resolve sur le nom, puis le même id.
 * À défaut, une carte construite depuis le résultat de recherche.
 */
export async function productCard(hitId: string, name: string, fallback: SearchHit | null): Promise<ResolvedProduct> {
  const r = await resolve(name, { limit: 10 }).catch(() => null);
  const found = r?.matchedTypes.flatMap((t) => t.products).find((p) => p.id === hitId);
  if (found) return found;
  if (!fallback) throw new Error("Produit introuvable dans le catalogue.");
  return {
    id: hitId,
    name: fallback.name,
    slug: fallback.slug ?? "",
    productUrl: "",
    imageUrl: fallback.imageUrl ?? null,
    brandName: fallback.brandName ?? null,
    quantityLabel: fallback.quantityLabel ?? null,
    weightG: fallback.weightG ?? null,
    isFrozen: fallback.isFrozen ?? false,
    currentPrice: fallback.currentPrice ?? null,
    currentPricePerKg: fallback.currentPricePerKg ?? null,
    promoPriceEur: fallback.promoPriceEur ?? null,
    stockStatus: fallback.stockStatus ?? null,
    source: fallback.source ?? "chronodrive",
    isFavorite: false,
    availability: fallback.availability,
  };
}

/** Remplace le produit d'une ligne (même verte) : paquets recalculés depuis le besoin, pastille aussi. */
export function applyProduct(db: Db, itemId: string, next: ResolvedProduct) {
  const it = getItem(db, itemId);
  assertDraft(db, it.listId);
  const prev = it.productJson as ResolvedProduct | null;
  const alts = ((it.alternativesJson ?? []) as ResolvedProduct[]).filter((p) => p.id !== next.id);
  const packs = packsFor(next, it.needG, it.packs || 1);
  db.update(shoppingItems)
    .set({ ...rejudge(it, next, packs), alternativesJson: [...(prev && prev.id !== next.id ? [prev] : []), ...alts].slice(0, 4) })
    .where(eq(shoppingItems.id, itemId))
    .run();
  return it.listId;
}

export async function changeProduct(db: Db, itemId: string, productId: string, query: string) {
  const hits = await search(query, { limit: 30, available: true }).catch(() => null);
  const hit = hits?.results.find((h) => (h.productId ?? h.id) === productId) ?? null;
  const card = await productCard(productId, hit?.name ?? query, hit);
  return applyProduct(db, itemId, card);
}

/**
 * « Valider la commande » : les lignes cochées (toutes si aucune ne l'est) deviennent des
 * achats au prix effectif du moment, chacun avec son lot de placard. La liste passe en `ordered`.
 * pack_g = poids du paquet ; price_paid = total de la ligne. Un produit sans poids connu
 * donne un lot à la taille du besoin (need_g), consommé en entier s'il est inconnu.
 */
/** Prix payé pour une ligne sans produit du catalogue (saisi en magasin), pour toute la ligne ; null l'efface. */
export function setLinePrice(db: Db, itemId: string, totalEur: number | null) {
  const it = getItem(db, itemId);
  assertDraft(db, it.listId);
  if (it.productJson) throw new Error("Cette ligne a un produit du catalogue : son prix vient du catalogue.");
  if (totalEur != null && !(Number.isFinite(totalEur) && totalEur >= 0 && totalEur <= 1000)) throw new Error("Prix entre 0 et 1 000 €.");
  const v = totalEur == null ? null : round2(totalEur);
  db.update(shoppingItems).set({ totalPrice: v, unitPrice: v }).where(eq(shoppingItems.id, itemId)).run();
  return it.listId;
}

/**
 * Valide la commande : chaque ligne achetée devient un achat et un lot du placard (son prix sert au coût
 * des recettes). Une ligne du catalogue compte avec ses paquets ; une ligne sans produit (pas de catalogue
 * relié) compte si elle est cochée ou a un prix saisi, avec ce prix (sans prix : elle est achetée mais
 * ne compte pas dans les coûts). Les lignes cochées seules comptent quand il y en a.
 */
export function validateOrder(db: Db, listId: string, at = new Date().toISOString()) {
  assertDraft(db, listId);
  const items = db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();
  const buyable = items.filter((i) => !i.pantry && (i.productJson ? (i.packs ?? 0) > 0 : true));
  const ticked = buyable.filter((i) => i.inCartAt);
  const chosen = ticked.length ? ticked : buyable;
  if (!chosen.length) throw new Error("Rien à valider.");
  let total = 0;
  let unpriced = 0;
  db.transaction((tx) => {
    for (const it of chosen) {
      const p = it.productJson as ResolvedProduct | null;
      if (!p && it.totalPrice == null) {
        unpriced++;
        if (!it.inCartAt) tx.update(shoppingItems).set({ inCartAt: at }).where(eq(shoppingItems.id, it.id)).run();
        continue;
      }
      const packs = p ? (it.packs ?? 1) : 1;
      const paid = p ? round2((effectivePrice(p) ?? it.unitPrice ?? 0) * packs) : round2(it.totalPrice!);
      total += paid;
      const purchaseId = randomUUID();
      tx.insert(purchases)
        .values({
          id: purchaseId,
          listId,
          chronoProductId: p?.id ?? null,
          name: p?.name ?? it.item,
          boughtAt: at,
          packs,
          packG: p?.weightG ?? null,
          pricePaid: paid,
          promo: p?.promoPriceEur != null,
          shoppingItemId: it.id,
          item: it.item,
        })
        .run();
      const grams = p?.weightG ? packs * p.weightG : (it.needG ?? 0);
      tx.insert(pantryLots)
        .values({ id: randomUUID(), purchaseId, item: it.item, gramsLeft: grams, valueLeft: paid, gramsInitial: grams, valueInitial: paid, status: "ok" })
        .run();
      if (!it.inCartAt) tx.update(shoppingItems).set({ inCartAt: at }).where(eq(shoppingItems.id, it.id)).run();
    }
    tx.update(shoppingLists).set({ status: "ordered", orderedAt: at }).where(eq(shoppingLists.id, listId)).run();
  });
  return { purchases: chosen.length - unpriced, total: round2(total), skipped: buyable.length - chosen.length, unpriced };
}

/** Annule une validation tant qu'aucun lot n'a servi : achats et lots retirés, liste en brouillon. */
export function undoOrder(db: Db, listId: string) {
  const ps = db.select({ id: purchases.id }).from(purchases).where(eq(purchases.listId, listId)).all();
  const lots = ps.length ? db.select().from(pantryLots).where(inArray(pantryLots.purchaseId, ps.map((p) => p.id))).all() : [];
  const usedLots = lots.length ? db.select({ id: cookUsages.id }).from(cookUsages).where(inArray(cookUsages.lotId, lots.map((l) => l.id))).all() : [];
  if (usedLots.length || lots.some((l) => l.status !== "ok")) throw new Error("Des lots ont déjà servi : la commande reste validée.");
  db.transaction((tx) => {
    if (lots.length) tx.delete(pantryLots).where(inArray(pantryLots.id, lots.map((l) => l.id))).run();
    if (ps.length) tx.delete(purchases).where(inArray(purchases.id, ps.map((p) => p.id))).run();
    tx.update(shoppingLists).set({ status: "draft", orderedAt: null, chronoOrderId: null, orderStatus: null, orderError: null, orderImportedAt: null }).where(eq(shoppingLists.id, listId)).run();
  });
}

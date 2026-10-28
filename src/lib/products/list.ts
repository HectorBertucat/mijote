// Produits associés vus depuis une ligne de liste de courses : la feuille « Changer » montre
// d'abord les produits acceptés (préféré en tête), et « Ne correspond pas » refuse le produit
// de la ligne (refus commun) puis passe au meilleur produit accepté ou proposé.
import { eq } from "drizzle-orm";
import { effectivePrice, type ResolvedProduct } from "@/lib/chronocatalog";
import type { Db } from "@/lib/db/open";
import { shoppingItems } from "@/lib/db/schema";
import { applyProduct } from "@/lib/shopping/cart";
import { ALL, prefsFor, rankForNeed, type Prefs } from "./core";
import { loadAssociations, refuseProduct } from "./store";

type Item = typeof shoppingItems.$inferSelect;

export interface AcceptedChoice {
  id: string;
  label: string;
  price: number | null;
  preferred: boolean;
  current: boolean;
}

function prefsOfItem(db: Db, it: Pick<Item, "assocKey" | "assocScope">): Prefs | null {
  if (!it.assocKey) return null;
  return prefsFor(loadAssociations(db, [it.assocKey]), it.assocKey, it.assocScope && it.assocScope !== ALL ? it.assocScope : null);
}

/** Les produits acceptés d'une ligne, préféré d'abord (cartes de la liste quand elle les a, plus fraîches). */
export function acceptedForItem(db: Db, it: Item, prefs = prefsOfItem(db, it)): AcceptedChoice[] {
  if (!prefs) return [];
  const known = new Map([...((it.alternativesJson ?? []) as ResolvedProduct[]), ...(it.productJson ? [it.productJson as ResolvedProduct] : [])].map((p) => [p.id, p]));
  return prefs.accepted.map((saved) => {
    const p = known.get(saved.id) ?? saved;
    return { id: p.id, label: `${p.name} ${p.quantityLabel ?? ""}`.trim(), price: effectivePrice(p), preferred: p.id === prefs.preferredId, current: p.id === it.chronoProductId };
  });
}

/** Les produits acceptés de plusieurs lignes, en une lecture de la table. */
export function acceptedForItems(db: Db, items: Item[]): Map<string, AcceptedChoice[]> {
  const keys = [...new Set(items.map((i) => i.assocKey).filter((k): k is string => !!k))];
  const rows = loadAssociations(db, keys);
  return new Map(items.map((it) => [it.id, it.assocKey ? acceptedForItem(db, it, prefsFor(rows, it.assocKey, it.assocScope && it.assocScope !== ALL ? it.assocScope : null)) : []]));
}

function getItem(db: Db, itemId: string) {
  const it = db.select().from(shoppingItems).where(eq(shoppingItems.id, itemId)).get();
  if (!it) throw new Error("Ligne introuvable.");
  return it;
}

/** Prend un produit accepté pour la ligne (même s'il n'était pas dans ses alternatives). */
export function chooseAccepted(db: Db, itemId: string, productId: string) {
  const it = getItem(db, itemId);
  const prefs = prefsOfItem(db, it);
  const known = [...((it.alternativesJson ?? []) as ResolvedProduct[])].find((p) => p.id === productId) ?? prefs?.accepted.find((p) => p.id === productId);
  if (!known) throw new Error("Ce produit n'est plus accepté pour cet ingrédient.");
  return applyProduct(db, itemId, known);
}

/**
 * « Ne correspond pas » depuis la liste : le produit de la ligne est refusé pour l'ingrédient (toutes
 * les recettes), puis la ligne passe au meilleur produit accepté, sinon à la première alternative.
 */
export function refuseItemProduct(db: Db, itemId: string): { listId: string; next: string | null } {
  const it = getItem(db, itemId);
  const cur = it.productJson as ResolvedProduct | null;
  if (!cur || !it.assocKey) throw new Error("Rien à refuser sur cette ligne.");
  refuseProduct(db, { key: it.assocKey, label: it.item, scope: it.assocScope ?? ALL }, cur);
  const prefs = prefsOfItem(db, it);
  const alts = ((it.alternativesJson ?? []) as ResolvedProduct[]).filter((p) => p.id !== cur.id && !prefs?.refused.has(p.id));
  const fresh = new Map(alts.map((p) => [p.id, p]));
  const accepted = (prefs?.accepted ?? []).filter((p) => p.id !== cur.id).map((p) => fresh.get(p.id) ?? p);
  const pref = accepted.find((p) => p.id === prefs?.preferredId);
  const next = pref ?? rankForNeed(accepted, { needG: it.needG })[0]?.product ?? alts[0] ?? null;
  // Le produit refusé ne revient pas en alternative.
  db.update(shoppingItems).set({ alternativesJson: alts }).where(eq(shoppingItems.id, itemId)).run();
  if (next) applyProduct(db, itemId, next);
  // applyProduct remet l'ancien produit en tête des alternatives : on le retire.
  const after = getItem(db, itemId);
  db.update(shoppingItems)
    .set({ alternativesJson: ((after.alternativesJson ?? []) as ResolvedProduct[]).filter((p) => p.id !== cur.id) })
    .where(eq(shoppingItems.id, itemId))
    .run();
  return { listId: it.listId, next: next?.name ?? null };
}

// Produits du drive associés aux ingrédients : clé de l'ingrédient générique, réglages
// effectifs d'une ligne (commun + réglage de la recette), et classement des produits pour
// un besoin (dispo, coût pour couvrir le besoin, prix au kilo). Pur et testé
// (tests/produits.test.ts) ; la base est dans ./store.ts, la fiche dans ./fiche.ts.
import { effectivePrice, type ResolvedProduct, type ResolveResponse } from "@/lib/chronocatalog";

/** Réglage commun (toutes les recettes). Sinon le scope est un recipe_ingredient_id. */
export const ALL = "all";

export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * La clé de l'ingrédient générique : le type canonique chronocatalog de la ligne (« type:oignon_jaune »,
 * la même clé que l'agrégation de la liste de courses), à défaut l'aliment de la table nutrition
 * (« food:pulpe_tomate »), à défaut le nom lu (« item:baies de goji »). Le type d'abord : l'aliment
 * nutritionnel est trop large (« oignon » couvre le jaune et le rouge).
 */
export function associationKey(ing: { item: string; foodId?: string | null }, r: ResolveResponse | null): { key: string; label: string } {
  const type = r?.matchedTypes[0];
  if (type) return { key: `type:${type.slug}`, label: type.name };
  const item = r?.parsed?.item ?? ing.item;
  if (ing.foodId && ing.foodId !== "zero") return { key: `food:${ing.foodId}`, label: item };
  return { key: `item:${normName(item)}`, label: item };
}

/** Une ligne de la table ingredient_products, telle que lue. */
export interface AssocRow {
  key: string;
  scope: string;
  productId: string;
  status: "accepted" | "refused";
  preferred: boolean;
  product: ResolvedProduct | null;
  decidedAt: string;
}

/** Ce qui s'applique à une ligne de recette pour une clé. */
export interface Prefs {
  key: string;
  /** "recipe" : la ligne a son propre réglage (qui prime) ; "all" : le réglage commun ; "none" : rien d'accepté. */
  scope: "recipe" | "all" | "none";
  /** La ligne a des réglages propres (même de simples refus). */
  hasOverride: boolean;
  /** Produits acceptés (cartes du jour du choix), le préféré d'abord. */
  accepted: ResolvedProduct[];
  acceptedAt: Map<string, string>;
  refused: Set<string>;
  preferredId: string | null;
}

export const NO_PREFS = (key: string): Prefs => ({ key, scope: "none", hasOverride: false, accepted: [], acceptedAt: new Map(), refused: new Set(), preferredId: null });

/**
 * Réglage effectif : un refus commun exclut le produit partout (sauf s'il est accepté
 * explicitement pour cette recette) ; si la ligne a ses propres produits acceptés, ils
 * remplacent les produits communs ; un refus propre à la recette retire un produit commun.
 */
export function prefsFor(rows: AssocRow[], key: string, ingredientId?: string | null): Prefs {
  const mine = rows.filter((r) => r.key === key);
  const common = mine.filter((r) => r.scope === ALL);
  const own = ingredientId ? mine.filter((r) => r.scope === ingredientId) : [];
  const ownAccepted = own.filter((r) => r.status === "accepted");
  const ownAcceptedIds = new Set(ownAccepted.map((r) => r.productId));
  const refused = new Set([...common, ...own].filter((r) => r.status === "refused" && !ownAcceptedIds.has(r.productId)).map((r) => r.productId));
  const chosen = ownAccepted.length ? ownAccepted : common.filter((r) => r.status === "accepted" && !refused.has(r.productId));
  const withCard = chosen.filter((r) => r.product);
  const preferredId = withCard.find((r) => r.preferred)?.productId ?? null;
  const sorted = [...withCard].sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.decidedAt.localeCompare(b.decidedAt));
  return {
    key,
    scope: ownAccepted.length ? "recipe" : sorted.length ? "all" : "none",
    hasOverride: own.length > 0,
    accepted: sorted.map((r) => r.product!),
    acceptedAt: new Map(sorted.map((r) => [r.productId, r.decidedAt])),
    refused,
    preferredId,
  };
}

// ─── Classement pour un besoin ───

/** Produit vendu au poids au rayon, sans format fixe : le prix et le stock ne veulent rien dire. */
export function isCounterProduct(p: Pick<ResolvedProduct, "quantityLabel">) {
  return /au d[ée]tail|au choix|à la coupe/i.test(p.quantityLabel ?? "");
}

/** Commandable maintenant, vérifié il y a moins de 24 h, avec un format fixe. */
export function usable(p: ResolvedProduct) {
  const a = p.availability;
  if (isCounterProduct(p)) return false;
  if (a && (a.status === "out_of_stock" || a.status === "unavailable")) return false;
  if (a?.stale) return false;
  return true;
}

export function packsFor(product: Pick<ResolvedProduct, "weightG">, needG: number | null, fallback?: number): number {
  if (needG && product.weightG) return Math.max(1, Math.ceil(needG / product.weightG - 0.05));
  return fallback ?? 1;
}

/** Prix au kilo payé (promo comprise), depuis le poids du paquet ; celui du catalogue suit le prix barré. */
export function pricePerKg(p: ResolvedProduct): number | null {
  const price = effectivePrice(p);
  if (price == null) return null;
  if (p.weightG && p.weightG > 0) return Math.round((price / p.weightG) * 100000) / 100;
  return p.currentPricePerKg ?? null;
}

export interface Ranked {
  product: ResolvedProduct;
  usable: boolean;
  packs: number;
  /** ce que coûte le besoin avec ce produit (paquets entiers) */
  needCost: number | null;
  perKg: number | null;
  /** grammes achetés en trop */
  overG: number | null;
}

/** Le besoin d'une ligne : grammes, et pièces quand on les compte (« 2 oignons »). */
export interface NeedQty {
  needG: number | null;
  pieces?: number | null;
}

export function rankOne(p: ResolvedProduct, need: NeedQty): Ranked {
  const fallback = need.needG == null && need.pieces ? Math.ceil(need.pieces) : 1;
  const packs = packsFor(p, need.needG, fallback);
  const price = effectivePrice(p);
  return {
    product: p,
    usable: usable(p),
    packs,
    needCost: price != null ? Math.round(price * packs * 100) / 100 : null,
    perKg: pricePerKg(p),
    overG: need.needG != null && p.weightG ? Math.round(p.weightG * packs - need.needG) : null,
  };
}

/**
 * Produits du meilleur au moins bon pour ce besoin : commandables d'abord, puis le coût pour
 * couvrir le besoin (paquets entiers : le format compte), puis le prix au kilo, puis le moins
 * de reste. Sans prix connu : à la fin de leur groupe.
 */
export function rankForNeed(products: ResolvedProduct[], need: NeedQty): Ranked[] {
  const big = Number.POSITIVE_INFINITY;
  return products
    .map((p) => rankOne(p, need))
    .sort(
      (a, b) =>
        Number(b.usable) - Number(a.usable) ||
        Number(isCounterProduct(a.product)) - Number(isCounterProduct(b.product)) ||
        (a.needCost ?? big) - (b.needCost ?? big) ||
        (a.perKg ?? big) - (b.perKg ?? big) ||
        (a.overG ?? big) - (b.overG ?? big)
    );
}

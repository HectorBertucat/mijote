// Onglet « Produits du drive » d'une fiche : pour chaque ingrédient à acheter, sa clé générique,
// les produits acceptés (commun ou réglage du plat), refusés, et la proposition automatique
// (produits candidats de /resolve, classés pour le besoin de la recette). /resolve seulement
// (en cache 15 min), jamais /live.
import { asc, eq } from "drizzle-orm";
import { effectivePrice, type ResolvedProduct, type ResolveResponse } from "@/lib/chronocatalog";
import type { Db } from "@/lib/db/open";
import { recipeIngredients } from "@/lib/db/schema";
import { resolveIngredient, type Ing } from "@/lib/shopping/build";
import { pickProduct } from "@/lib/shopping/rules";
import { cachedResolver } from "@/lib/week/packs";
import { ALL, associationKey, isCounterProduct, prefsFor, rankForNeed, rankOne, type AssocRow, type Ranked } from "./core";
import { loadAssociations, type AssocTarget } from "./store";

export type Resolver = (q: string) => Promise<ResolveResponse>;

export interface ProductView {
  id: string;
  name: string;
  brand: string | null;
  quantityLabel: string | null;
  price: number | null;
  promo: boolean;
  perKg: number | null;
  packs: number;
  needCost: number | null;
  overG: number | null;
  tone: "ok" | "warn" | "ko";
  dispo: string;
  url: string | null;
  imageUrl: string | null;
  /** produit d'un autre type que celui de la ligne (ex. oignon rouge pour « oignon ») */
  otherType: string | null;
  /** carte gardée du jour du choix (le catalogue ne l'a pas renvoyée aujourd'hui) */
  savedAt: string | null;
}

export interface IngredientProducts {
  ingredientId: string;
  item: string;
  lineRaw: string;
  group: string | null;
  optional: boolean;
  needG: number | null;
  pieces: number | null;
  key: string;
  label: string;
  /** chronocatalog : rien à acheter (sel, eau…) */
  nothingToBuy: boolean;
  /** /resolve ne trouve aucun type */
  notFound: boolean;
  scope: "recipe" | "all" | "none";
  hasOverride: boolean;
  preferredId: string | null;
  /** le produit que la liste de courses prendrait aujourd'hui */
  chosenId: string | null;
  accepted: ProductView[];
  candidates: ProductView[];
  refused: ProductView[];
}

function dispoOf(p: ResolvedProduct): { tone: ProductView["tone"]; dispo: string } {
  const a = p.availability;
  if (isCounterProduct(p)) return { tone: "warn", dispo: "au détail" };
  if (!a) return { tone: "warn", dispo: "dispo inconnue" };
  if (a.status === "out_of_stock") return { tone: "ko", dispo: "en rupture" };
  if (a.status === "unavailable") return { tone: "ko", dispo: a.label ?? "indisponible" };
  if (a.stale || (a.ageHours != null && a.ageHours >= 24)) return { tone: "warn", dispo: `vérifié il y a ${Math.max(1, Math.round((a.ageHours ?? 24) / 24))} j` };
  if (a.status === "low_stock") return { tone: "warn", dispo: a.remainingStock != null ? `plus que ${a.remainingStock}` : "stock faible" };
  if (!a.lastCheckedAt) return { tone: "warn", dispo: "jamais vérifié" };
  return { tone: "ok", dispo: "en stock" };
}

function view(r: Ranked, extra: { otherType?: string | null; savedAt?: string | null } = {}): ProductView {
  const p = r.product;
  return {
    id: p.id,
    name: p.name,
    brand: p.brandName,
    quantityLabel: p.quantityLabel,
    price: effectivePrice(p),
    promo: p.promoPriceEur != null,
    perKg: r.perKg,
    packs: r.packs,
    needCost: r.needCost,
    overG: r.overG,
    ...dispoOf(p),
    url: p.productUrl || null,
    imageUrl: p.imageUrl,
    otherType: extra.otherType ?? null,
    savedAt: extra.savedAt ?? null,
  };
}

/** L'état d'un ingrédient, avec les cartes complètes (pour écrire une association depuis un id). */
export interface IngredientState {
  view: IngredientProducts;
  target: Omit<AssocTarget, "scope">;
  cards: Map<string, ResolvedProduct>;
}

const MAX_CANDIDATES = 24;

export function ingredientState(ing: Ing, r: ResolveResponse | null, rows: AssocRow[]): IngredientState {
  const { key, label } = associationKey(ing, r);
  const prefs = prefsFor(rows, key, ing.id);
  const needG = r?.quantity?.grams ?? ing.grams ?? null;
  const pieces = r?.quantity?.pieces ?? ing.units ?? null;
  const need = { needG, pieces };
  const types = r?.matchedTypes ?? [];
  const main = types[0];
  // Le second type compte s'il est du même rayon (oignon jaune → oignon rouge, pas oignon déshydraté).
  const second = types.slice(1).find((t) => main && t.broadCategory === main.broadCategory);
  const fresh = new Map<string, ResolvedProduct>();
  const typeOf = new Map<string, string>();
  for (const t of [main, second]) for (const p of t?.products ?? []) if (!fresh.has(p.id)) (fresh.set(p.id, p), typeOf.set(p.id, t!.name));
  const cards = new Map(fresh);

  const accepted = prefs.accepted.map((saved) => {
    const p = fresh.get(saved.id);
    if (!cards.has(saved.id)) cards.set(saved.id, saved);
    return view(rankOne(p ?? saved, need), { otherType: p && main && typeOf.get(p.id) !== main.name ? typeOf.get(p.id) : null, savedAt: p ? null : (prefs.acceptedAt.get(saved.id) ?? null) });
  });
  const refusedRows = rows.filter((x) => x.key === key && x.scope === ALL && x.status === "refused" && x.product);
  const refused = refusedRows.map((x) => {
    if (!cards.has(x.productId)) cards.set(x.productId, x.product!);
    return view(rankOne(fresh.get(x.productId) ?? x.product!, need));
  });
  const taken = new Set([...accepted.map((a) => a.id), ...prefs.refused]);
  const pool = [...fresh.values()].filter((p) => !taken.has(p.id) && !isCounterProduct(p));
  const candidates = rankForNeed(pool, need)
    .slice(0, MAX_CANDIDATES)
    .map((x) => view(x, { otherType: main && typeOf.get(x.product.id) !== main.name ? typeOf.get(x.product.id) : null }));
  const pick = r || prefs.accepted.length ? pickProduct(types, { prefs, needG, pieces }) : null;

  return {
    view: {
      ingredientId: ing.id,
      item: ing.item,
      lineRaw: ing.lineRaw,
      group: ing.group,
      optional: ing.optional,
      needG,
      pieces,
      key,
      label,
      nothingToBuy: !!(r?.none && r.none.reason !== "no_match"),
      notFound: !main,
      scope: prefs.scope,
      hasOverride: prefs.hasOverride,
      preferredId: prefs.preferredId,
      chosenId: pick?.product.id ?? null,
      accepted,
      candidates,
      refused,
    },
    target: { key, label, foodId: ing.foodId },
    cards,
  };
}

/** Les ingrédients à acheter d'une recette (le placard est vérifié à la maison, pas associé). */
export function buyIngredients(db: Db, recipeId: string): Ing[] {
  return db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.position))
    .all()
    .filter((i) => !i.pantry);
}

async function mapLimit<T, R>(items: T[], fn: (t: T) => Promise<R>, limit = 6): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/** /resolve de la ligne (20 produits par type : plusieurs formats et prix), en cache. */
export const ficheResolver = (): Resolver => cachedResolver(20);

export async function recipeIngredientStates(db: Db, ings: Ing[], res: Resolver = ficheResolver()): Promise<IngredientState[]> {
  const rs = await mapLimit(ings, (i) => resolveIngredient(i, res).catch(() => null));
  const rows = loadAssociations(db);
  return ings.map((ing, k) => ingredientState(ing, rs[k], rows));
}

/** L'onglet entier : un état par ingrédient à acheter, dans l'ordre de la fiche. */
export async function recipeProducts(db: Db, recipeId: string, res?: Resolver): Promise<IngredientProducts[]> {
  return (await recipeIngredientStates(db, buyIngredients(db, recipeId), res)).map((s) => s.view);
}

/** Ce qui reste à associer : ingrédients à acheter sans aucun produit accepté. */
export const toAssociate = (list: IngredientProducts[]) => list.filter((i) => !i.nothingToBuy && i.accepted.length === 0);

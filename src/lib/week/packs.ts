// Tailles de paquet des recettes, depuis chronocatalog /resolve (jamais /live) : le profil
// d'une recette donne, ligne par ligne, le type de produit (même clé que la liste de
// courses), les grammes de la fiche, le poids et le prix d'un paquet. Les réponses de
// /resolve sont gardées 15 min en mémoire : la Semaine et le Composer restent rapides.
import { effectivePrice, resolve, type ResolveResponse } from "@/lib/chronocatalog";
import { resolveIngredient, type Ing } from "@/lib/shopping/build";
import { aisleFor, pickProduct } from "@/lib/shopping/rules";
import { isPerishable, type PackLine, type PackProfiles } from "./waste";

export type Resolver = (q: string) => Promise<ResolveResponse>;

const TTL_MS = 15 * 60_000;
const MAX = 3000;
const g = globalThis as unknown as { __cuisineResolveCache?: Map<string, { at: number; p: Promise<ResolveResponse> }> };
const cache = (g.__cuisineResolveCache ??= new Map());

/** /resolve avec un cache mémoire (une promesse par requête : deux rendus ne doublent pas l'appel). */
export function cachedResolver(limit: number): Resolver {
  return (q) => {
    const k = `${limit}|${q.toLowerCase()}`;
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
    const p = resolve(q, { limit });
    p.catch(() => cache.delete(k));
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(k, { at: Date.now(), p });
    return p;
  };
}

export const lineResolver = () => cachedResolver(1);
export const totalResolver = () => cachedResolver(5);

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

/** Une ligne de recette → sa ligne de profil (null : placard, rien à acheter, ou produit inconnu). */
export function packLineOf(ing: Pick<Ing, "id" | "item" | "grams" | "units" | "pantry">, r: ResolveResponse | null): PackLine | null {
  if (ing.pantry || !r) return null;
  if (r.none && r.none.reason !== "no_match") return null;
  const type = r.matchedTypes[0];
  const key = type ? `type:${type.slug}` : `item:${(r.parsed?.item ?? ing.item).toLowerCase()}`;
  const label = type?.name ?? r.parsed?.item ?? ing.item;
  const pick = pickProduct(r.matchedTypes);
  const product = pick?.product ?? null;
  const aisle = aisleFor(type?.broadCategory, product);
  return {
    ingredientId: ing.id,
    key,
    label,
    grams: r.quantity?.grams ?? ing.grams ?? null,
    pieces: r.quantity?.pieces ?? ing.units ?? null,
    packG: product?.weightG ?? null,
    price: product ? effectivePrice(product) : null,
    perishable: isPerishable(aisle, label),
  };
}

/** Profils de paquet de plusieurs recettes (slug → lignes), avec un résolveur injectable. */
export async function buildProfiles(recipes: { slug: string; ingredients: Ing[] }[], res: Resolver = lineResolver()): Promise<PackProfiles> {
  const all = recipes.flatMap((r) => r.ingredients.filter((i) => !i.pantry).map((i) => ({ slug: r.slug, i })));
  const rs = await mapLimit(all, ({ i }) => resolveIngredient(i, res).catch(() => null));
  const out: PackProfiles = new Map(recipes.map((r) => [r.slug, []]));
  all.forEach(({ slug, i }, k) => {
    const l = packLineOf(i, rs[k]);
    if (l) out.get(slug)!.push(l);
  });
  return out;
}

// Génération d'une liste de courses depuis des recettes : agrégation par type de
// produit chronocatalog, choix du produit, paquets, rayon et pastille. Déterministe.
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { recipeIngredients, recipes, shoppingItems, shoppingItemSources, shoppingLists } from "@/lib/db/schema";
import { effectivePrice, live, LIVE_REFRESH_MAX, liveRequests, resolve, search, type MatchedType, type ResolveResponse, type ResolvedProduct } from "@/lib/chronocatalog";
import { associationKey, NO_PREFS, prefsFor, type AssocRow, type Prefs } from "@/lib/products/core";
import { loadAssociations } from "@/lib/products/store";
import { aisleFor, AISLES, guessAisle, judge, nameVariants, packsFor, pickProduct, qtyPrefix, type Aisle } from "./rules";
import { buyName } from "./label";
import { nameKey, partition, pieceGrams, pieceUnit, total, type QtyLine } from "./merge";

const CONCURRENCY = 6;

async function mapLimit<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

/** La ligne envoyée à /resolve : la ligne brute si elle porte une quantité, sinon le poids connu + le nom. */
export function queryLine(ing: { lineRaw: string; item: string; grams: number | null; units: number | null }): string {
  if (/\d/.test(ing.lineRaw)) return ing.lineRaw;
  const name = ing.lineRaw || ing.item;
  if (ing.grams) return `${Math.round(ing.grams)} g ${name}`;
  if (ing.units) return `${ing.units} ${name}`;
  return name;
}

interface Source {
  ing: { id: string; recipeId: string; lineRaw: string };
  grams: number | null;
  units: number | null;
}

export interface Need {
  key: string;
  label: string;
  grams: number | null;
  pieces: number | null;
  recipeIds: Set<string>;
  lines: string[];
  pantry: boolean;
  optional: boolean;
  allPieces: boolean; // on achète en pièces (« 2 oignons », « 7 gousses ») : merge.ts, total()
  /** Unité des pièces (« gousse »), null pour des pièces nues. */
  unit: string | null;
  sources: Source[];
  /** Produits du drive associés (src/lib/products) : commun, ou réglage propre à la ligne de recette. */
  prefs: Prefs;
}

/**
 * Cartes à jour de produits acceptés que /resolve n'a pas renvoyés (ajoutés par la recherche,
 * ou hors des premiers produits du type) : GET /search sur leur nom, même id. Jamais /live.
 */
export type ProductLookup = (cards: ResolvedProduct[]) => Promise<ResolvedProduct[]>;

export const searchLookup: ProductLookup = async (cards) => {
  const out = await Promise.all(
    cards.slice(0, 12).map(async (c): Promise<ResolvedProduct | null> => {
      const r = await search(c.name, { limit: 30 }).catch(() => null);
      const h = r?.results.find((x) => (x.productId ?? x.id) === c.id);
      if (!h) return null;
      return {
        ...c,
        currentPrice: h.currentPrice ?? c.currentPrice,
        currentPricePerKg: h.currentPricePerKg ?? c.currentPricePerKg,
        promoPriceEur: h.promoPriceEur !== undefined ? h.promoPriceEur : c.promoPriceEur,
        stockStatus: h.stockStatus ?? c.stockStatus,
        weightG: h.weightG ?? c.weightG,
        quantityLabel: h.quantityLabel ?? c.quantityLabel,
        availability: h.availability ?? c.availability,
      };
    })
  );
  return out.filter((p): p is ResolvedProduct => p != null);
};

export type Ing = typeof recipeIngredients.$inferSelect;

/**
 * Une ligne de recette passe par /resolve. Si chronocatalog ne trouve rien (« no_match »),
 * on réessaie avec des noms de plus en plus courts, avec la quantité, et on garde la
 * première variante qui trouve un type (« 2 kg sauté de porc sans os label rouge » → « 2000 g sauté de porc »).
 */
export async function resolveIngredient(
  ing: Pick<Ing, "lineRaw" | "item" | "grams" | "units">,
  res: (q: string) => Promise<ResolveResponse> = (q) => resolve(q, { limit: 1 })
): Promise<ResolveResponse | null> {
  const q = queryLine(ing);
  const r = await res(q).catch(() => null);
  if (r && (r.matchedTypes.length > 0 || (r.none && r.none.reason !== "no_match"))) return r;
  const tried = new Set([q.toLowerCase()]);
  for (const v of nameVariants(ing.lineRaw, ing.item).slice(0, 5)) {
    const q2 = qtyPrefix(ing) + v;
    if (tried.has(q2.toLowerCase())) continue;
    tried.add(q2.toLowerCase());
    const r2 = await res(q2).catch(() => null);
    if (r2?.matchedTypes.length) return r2;
  }
  return r;
}

/** Unités choisies : multiplicateur par recette (slug) et grammes ajoutés à une ligne (recipe_ingredient_id). */
export interface ListOptions {
  scales?: Record<string, number>;
  extras?: Record<string, number>;
  weekPlanId?: string | null;
  /** Résolveurs injectés (tests) ; par défaut chronocatalog /resolve. */
  resolveLine?: (q: string) => Promise<ResolveResponse>;
  resolveTotal?: (q: string) => Promise<ResolveResponse>;
  /** Cartes à jour des produits acceptés absents de /resolve (tests) ; par défaut /search. */
  lookup?: ProductLookup;
}

/** Crée une liste vide (en cours de construction) et renvoie son id. */
function createShell(db: Db, slugs: string[], opts: ListOptions = {}) {
  const rs = slugs.length ? db.select().from(recipes).where(inArray(recipes.slug, slugs)).all() : [];
  if (!rs.length) throw new Error("Aucune recette choisie.");
  const ings = db.select().from(recipeIngredients).where(inArray(recipeIngredients.recipeId, rs.map((r) => r.id))).all();
  const listId = randomUUID();
  const order = new Map(slugs.map((s, i) => [s, i]));
  rs.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
  const scales = Object.fromEntries(rs.filter((r) => opts.scales?.[r.slug] != null && opts.scales[r.slug] !== 1).map((r) => [r.slug, opts.scales![r.slug]]));
  const ingIds = new Set(ings.map((i) => i.id));
  const extras = Object.fromEntries(Object.entries(opts.extras ?? {}).filter(([id, g]) => ingIds.has(id) && g > 0));
  db.insert(shoppingLists)
    .values({
      id: listId,
      title: rs.map((r) => r.name).join(" + "),
      recipeSlugs: rs.map((r) => r.slug),
      buildDone: 0,
      buildTotal: ings.filter((i) => !i.pantry).length * 2,
      weekPlanId: opts.weekPlanId ?? null,
      recipeScales: scales,
      recipeExtras: extras,
    })
    .run();
  const slugOf = new Map(rs.map((r) => [r.id, r.slug]));
  const scaleOf: ScaleOf = (ing) => ({ factor: scales[slugOf.get(ing.recipeId) ?? ""] ?? 1, extraG: extras[ing.id] ?? 0 });
  return { listId, ings, scaleOf, resolveLine: opts.resolveLine, resolveTotal: opts.resolveTotal, lookup: opts.lookup, associations: loadAssociations(db) };
}

/** Génère la liste et attend la fin (scripts). */
export async function buildShoppingList(db: Db, slugs: string[], opts: ListOptions = {}): Promise<string> {
  const { listId, ...rest } = createShell(db, slugs, opts);
  await fillList(db, listId, rest);
  return listId;
}

/**
 * Crée la liste et la remplit en tâche de fond : la page affiche la progression
 * (build_done / build_total) pendant que les /resolve tournent, 6 à la fois.
 */
export function startShoppingList(db: Db, slugs: string[], opts: ListOptions = {}): string {
  const { listId, ...rest } = createShell(db, slugs, opts);
  fillList(db, listId, rest).catch((e) => {
    console.error("[courses] création de la liste :", e);
    db.update(shoppingLists).set({ buildError: e instanceof Error ? e.message : String(e) }).where(eq(shoppingLists.id, listId)).run();
  });
  return listId;
}

/** Multiplicateur de la recette et grammes ajoutés à la ligne. */
export type ScaleOf = (ing: Ing) => { factor: number; extraG: number };
const NO_SCALE: ScaleOf = () => ({ factor: 1, extraG: 0 });

/** Une ligne de courses prévue, avant écriture (partagée avec le calcul des paquets entamés). */
export interface PlannedLine {
  need: Need;
  q: string;
  r: ResolveResponse | null;
  product: ResolvedProduct | null;
  type: MatchedType | null;
  alternatives: ResolvedProduct[];
  needG: number | null;
  packs: number;
  aisle: Aisle;
  /** D'où vient le produit : préféré, meilleur des acceptés, ou choix du catalogue (aucun accepté). */
  via: "preferred" | "accepted" | "catalog" | null;
  notes: string[];
}

export interface PlannedList {
  lines: PlannedLine[];
  pantry: Need[];
  /** lignes de recette envoyées à /resolve (première passe) */
  buyCount: number;
}

/**
 * Le calcul de la liste, sans écrire : 1) chaque ligne de recette passe par /resolve (type
 * de produit et quantité lue), 2) agrégation par type × multiplicateur de la recette (+ grammes
 * ajoutés), 3) une requête par besoin agrégé pour le produit et les paquets.
 * La première passe porte la ligne de la fiche telle quelle : le multiplicateur s'applique
 * aux quantités lues (les pièces s'arrondissent au-dessus : on achète 5 oignons, pas 4,5).
 */
export interface PlanOptions {
  scaleOf?: ScaleOf;
  resolveLine?: (q: string) => Promise<ResolveResponse>;
  resolveTotal?: (q: string) => Promise<ResolveResponse>;
  /** Associations ingrédient ↔ produits (table ingredient_products) ; sans elles, le choix du catalogue. */
  associations?: AssocRow[];
  lookup?: ProductLookup;
  onTick?: () => void;
  onTotal?: (n: number) => void;
}

export async function planList(ings: Ing[], opts: PlanOptions = {}): Promise<PlannedList> {
  const scaleOf = opts.scaleOf ?? NO_SCALE;
  const tick = opts.onTick ?? (() => {});
  const lineRes = opts.resolveLine ?? ((q: string) => resolve(q, { limit: 1 }));
  // 20 produits par type : de quoi retrouver les produits acceptés et passer les refusés.
  const totalRes = opts.resolveTotal ?? ((q: string) => resolve(q, { limit: 20 }));
  const rows = opts.associations ?? [];
  const needs = new Map<string, Need>();

  // Une ligne de recette, quantités multipliées, avant regroupement (src/lib/shopping/merge.ts).
  interface Entry extends QtyLine {
    key: string;
    label: string;
    ing: Ing;
    pantry: boolean;
    prefs?: Prefs;
  }
  const entries: Entry[] = [];
  function add(key: string, label: string, grams: number | null, pieces: number | null, ing: Ing, pantry: boolean, prefs?: Prefs) {
    const { factor, extraG } = scaleOf(ing);
    if (grams != null) grams = grams * factor + extraG;
    else if (extraG > 0) grams = extraG;
    if (pieces != null) pieces = factor === 1 ? pieces : Math.ceil(pieces * factor - 1e-6);
    if (extraG > 0 && pieces != null && grams != null) pieces = null; // grammes ajoutés : on achète au poids
    const unit = pieces != null ? pieceUnit(ing.lineRaw) : null;
    entries.push({ key, label, grams, pieces, unit, pieceG: pieceGrams(ing.foodId, unit), ing, pantry, prefs });
  }

  // 1. Chaque ligne passe par /resolve pour savoir de quel type de produit il s'agit.
  const buy = ings.filter((i) => !i.pantry);
  const first = await mapLimit(buy, (i) => resolveIngredient(i, lineRes).finally(tick));

  // 2. Agrégation par type canonique, sinon par nom d'achat (« Ail, haché » et « Ail, râpé » : une ligne).
  // Une ligne que le catalogue n'a pas reconnue rejoint le type d'une ligne du même nom qu'il a reconnue.
  const typedByName = new Map<string, { base: string; label: string }>();
  buy.forEach((ing, k) => {
    const type = first[k]?.matchedTypes[0];
    const n = nameKey(ing.item);
    if (type && n && !typedByName.has(n)) typedByName.set(n, { base: `type:${type.slug}`, label: type.name });
  });
  buy.forEach((ing, k) => {
    const r = first[k];
    if (r?.none && r.none.reason !== "no_match") {
      // Rien à acheter selon chronocatalog (sel, eau…) : au placard.
      add(`placard:${ing.item}`, ing.item, null, null, ing, true);
      return;
    }
    const type = r?.matchedTypes[0];
    const read = r?.parsed?.item ?? ing.item;
    const same = type ? null : (typedByName.get(nameKey(ing.item)) ?? null);
    const base = type ? `type:${type.slug}` : (same?.base ?? `item:${nameKey(read) || read.toLowerCase()}`);
    const label = type?.name ?? same?.label ?? read;
    // Produits associés : la ligne qui a son propre réglage (« pulpe concassée pour ce plat ») a sa ligne de courses.
    const prefs = prefsFor(rows, associationKey(ing, r ?? null).key, ing.id);
    const key = prefs.hasOverride ? `${base}@${ing.id}` : base;
    add(key, label, r?.quantity?.grams ?? ing.grams, r?.quantity?.pieces ?? ing.units ?? null, ing, false, prefs);
  });
  // Le placard garde le nom entier (« Sel, poivre » n'est pas « Sel »).
  for (const ing of ings.filter((i) => i.pantry)) add(`placard:${ing.item.toLowerCase()}`, ing.item, ing.grams, ing.units, ing, true);

  // Un besoin par aliment ; deux unités impossibles à additionner (« 1 tête » et « 20 g » d'ail) : un besoin
  // par unité, côte à côte (même clé + « #n »).
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  for (const [key, list] of byKey) {
    const groups = partition(list);
    groups.forEach((idx, g) => {
      const es = idx.map((i) => list[i]);
      const t = total(es);
      const labels = new Set(es.map((e) => e.label));
      const k = groups.length > 1 && g > 0 ? `${key}#${g}` : key;
      needs.set(k, {
        key: k,
        label: labels.size > 1 ? buyName(es[0].label) : es[0].label,
        grams: t.grams,
        pieces: t.pieces,
        recipeIds: new Set(es.map((e) => e.ing.recipeId)),
        lines: es.map((e) => e.ing.lineRaw),
        pantry: es[0].pantry,
        optional: es.every((e) => e.ing.optional),
        allPieces: t.allPieces,
        sources: es.map((e) => ({ ing: e.ing, grams: e.grams, units: e.pieces })),
        prefs: es[0].prefs ?? NO_PREFS(key),
        unit: t.unit,
      });
    });
  }

  // 3. Une requête par besoin agrégé, avec la quantité totale, pour le choix du produit et les paquets.
  const toBuy = [...needs.values()].filter((n) => !n.pantry);
  opts.onTotal?.(buy.length + toBuy.length);
  const resolved = await mapLimit(toBuy, (n) => {
    const q =
      n.allPieces && n.pieces != null
        ? `${n.pieces} ${n.label}`
        : n.grams != null
          ? `${Math.round(n.grams)} g ${n.label}`
          : n.pieces != null
            ? `${n.pieces} ${n.label}`
            : n.label;
    return totalRes(q)
      .then((r) => ({ q, r }))
      .catch(() => ({ q, r: null as ResolveResponse | null }))
      .finally(tick);
  });

  // Produits acceptés que /resolve n'a pas renvoyés : leur carte à jour par la recherche.
  const seen = new Set(resolved.flatMap(({ r }) => r?.matchedTypes.flatMap((t) => t.products.map((p) => p.id)) ?? []));
  const missing = new Map<string, ResolvedProduct>();
  for (const n of toBuy) for (const p of n.prefs.accepted) if (!seen.has(p.id)) missing.set(p.id, p);
  const extra = missing.size ? await (opts.lookup ?? searchLookup)([...missing.values()]).catch(() => []) : [];

  const lines: PlannedLine[] = toBuy.map((n, k) => {
    const { q, r } = resolved[k];
    const needG0 = r?.purchase?.neededG ?? n.grams;
    const pick = r || n.prefs.accepted.length ? pickProduct(r?.matchedTypes ?? [], { prefs: n.prefs, needG: needG0, pieces: n.pieces, extra }) : null;
    const product = pick?.product ?? null;
    const samePick = product && r?.purchase?.productId === product.id;
    const needG = r?.purchase?.neededG ?? n.grams;
    const packs = product ? (samePick ? r!.purchase!.packs : packsFor(product, needG)) : 0;
    return {
      need: n,
      q,
      r,
      product,
      type: pick?.type ?? null,
      alternatives: pick?.alternatives ?? [],
      needG: needG ?? null,
      packs,
      aisle: product || pick?.type.broadCategory || r?.matchedTypes[0]?.broadCategory ? aisleFor(pick?.type.broadCategory || r?.matchedTypes[0]?.broadCategory, product) : guessAisle(n.label),
      via: pick?.via ?? null,
      notes: pick?.notes ?? [],
    };
  });
  return { lines, pantry: [...needs.values()].filter((n) => n.pantry), buyCount: buy.length };
}

async function fillList(
  db: Db,
  listId: string,
  o: { ings: Ing[]; scaleOf: ScaleOf; resolveLine?: ListOptions["resolveLine"]; resolveTotal?: ListOptions["resolveTotal"]; lookup?: ProductLookup; associations: AssocRow[] }
) {
  let done = 0;
  const tick = () => {
    done++;
    db.update(shoppingLists).set({ buildDone: done }).where(eq(shoppingLists.id, listId)).run();
  };
  const plan = await planList(o.ings, {
    scaleOf: o.scaleOf,
    resolveLine: o.resolveLine,
    resolveTotal: o.resolveTotal,
    associations: o.associations,
    lookup: o.lookup,
    onTick: tick,
    onTotal: (n) => db.update(shoppingLists).set({ buildTotal: n }).where(eq(shoppingLists.id, listId)).run(),
  });
  const total = plan.buyCount + plan.lines.length;

  db.transaction((tx) => {
    const sources = (itemId: string, n: Need) => {
      for (const s of n.sources)
        tx.insert(shoppingItemSources)
          .values({ id: randomUUID(), itemId, recipeIngredientId: s.ing.id, recipeId: s.ing.recipeId, lineRaw: s.ing.lineRaw, grams: s.grams, units: s.units })
          .run();
    };
    plan.lines.forEach((l, k) => {
      const { need: n, q, r, product, packs, aisle, needG } = l;
      // Un produit accepté à la main : la correspondance n'est plus « incertaine ».
      const j = judge({ product, packs, aisle, confidence: l.via === "catalog" ? r?.confidence : undefined });
      j.warnings.unshift(...l.notes);
      if (l.notes.length && j.state === "ok") j.state = "warn";
      if (n.optional) j.warnings.unshift("facultatif");
      const price = product ? effectivePrice(product) : null;
      const itemId = randomUUID();
      tx.insert(shoppingItems)
        .values({
          id: itemId,
          listId,
          item: n.label,
          needG: needG ?? null,
          recipeIds: [...n.recipeIds],
          chronoProductId: product?.id ?? null,
          packs,
          unitPrice: price,
          totalPrice: price != null ? Math.round(price * packs * 100) / 100 : null,
          checkedAt: product?.availability?.lastCheckedAt ?? null,
          availabilityJson: product?.availability ?? null,
          state: j.state,
          aisle,
          line: q,
          productJson: product,
          alternativesJson: l.alternatives,
          warnings: j.warnings,
          position: k,
          assocKey: n.prefs.key,
          assocScope: n.prefs.hasOverride ? n.sources[0].ing.id : "all",
        })
        .run();
      sources(itemId, n);
    });
    plan.pantry.forEach((n, k) => {
      const itemId = randomUUID();
      tx.insert(shoppingItems)
        .values({
          id: itemId,
          listId,
          item: n.label,
          needG: n.grams,
          recipeIds: [...n.recipeIds],
          aisle: "Placard",
          pantry: true,
          line: n.lines.join(" · "),
          position: 1000 + k,
        })
        .run();
      sources(itemId, n);
    });
    tx.update(shoppingLists).set({ buildDone: total, buildTotal: total }).where(eq(shoppingLists.id, listId)).run();
  });
}

/** Pastilles recalculées après une vérification en direct ou un changement de produit. */
export function rejudge(item: typeof shoppingItems.$inferSelect, product: ResolvedProduct, packs: number) {
  const j = judge({ product, packs, aisle: (item.aisle as Aisle) ?? "Épicerie" });
  const price = effectivePrice(product);
  return {
    chronoProductId: product.id,
    productJson: product,
    packs,
    unitPrice: price,
    totalPrice: price != null ? Math.round(price * packs * 100) / 100 : null,
    availabilityJson: product.availability ?? null,
    checkedAt: product.availability?.lastCheckedAt ?? null,
    state: j.state,
    warnings: j.warnings,
  };
}

export interface LiveClient {
  live: typeof live;
  liveRequests: typeof liveRequests;
}
const realLive: LiveClient = { live, liveRequests };

function applyCards(db: Db, items: (typeof shoppingItems.$inferSelect)[], cards: ResolvedProduct[], status: string) {
  const byId = new Map(cards.map((p) => [p.id, p]));
  let n = 0;
  db.transaction((tx) => {
    for (const it of items) {
      const p = byId.get(it.chronoProductId!);
      tx.update(shoppingItems)
        .set({ ...(p ? rejudge(it, p, it.packs ?? 1) : {}), liveStatus: status })
        .where(eq(shoppingItems.id, it.id))
        .run();
      if (p) n++;
    }
  });
  return n;
}

/**
 * « Vérifier en direct » : la viande et ce qui n'est pas vert d'abord, 20 produits au plus.
 * La demande part sans attendre (waitSeconds 0) ; pollLive() suit ensuite chaque ligne.
 */
export async function startLiveCheck(db: Db, listId: string, client: LiveClient = realLive) {
  const items = db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all().filter((i) => !i.pantry && i.chronoProductId);
  const rank = (i: (typeof items)[number]) => (i.aisle === "Boucherie" ? 0 : i.state === "ko" ? 1 : i.state === "warn" ? 2 : 3);
  const chosen = [...items].sort((a, b) => rank(a) - rank(b)).slice(0, LIVE_REFRESH_MAX);
  if (!chosen.length) return { asked: 0, pending: 0 };
  const res = await client.live({ refresh: chosen.map((i) => i.chronoProductId!), waitSeconds: 0 });
  const acks = new Map((res.refresh ?? []).map((a) => [a.productId ?? a.ref ?? "", a]));
  const askedAt = new Date().toISOString();
  const now: typeof chosen = [];
  db.transaction((tx) => {
    tx.update(shoppingItems).set({ liveAskedAt: null, liveStatus: null, liveRequestId: null }).where(eq(shoppingItems.listId, listId)).run();
    for (const it of chosen) {
      const a = acks.get(it.chronoProductId!);
      const pending = a?.requestId && (a.outcome === "queued" || a.outcome === "already_queued") && a.status !== "done";
      tx.update(shoppingItems)
        .set({ liveRequestId: a?.requestId ?? null, liveStatus: pending ? "pending" : (a?.outcome ?? "skipped"), liveAskedAt: askedAt })
        .where(eq(shoppingItems.id, it.id))
        .run();
      if (!pending) now.push(it);
    }
  });
  // Déjà frais (vérifié il y a moins de 10 min) : les cartes de la réponse sont à jour.
  if (now.length) applyCards(db, now, res.products ?? [], "fresh");
  return { asked: chosen.length, pending: chosen.length - now.length };
}

/**
 * Suit les demandes en cours (GET /live?ids=…). Pour celles qui sont faites, relit les cartes
 * produit : le même POST /live n'est pas remis en file (produit vérifié il y a moins de 10 min),
 * il renvoie juste les cartes à jour. Ne relance jamais une demande échouée.
 */
export async function pollLive(db: Db, listId: string, client: LiveClient = realLive) {
  const all = db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();
  const tracked = all.filter((i) => i.liveAskedAt);
  const pending = tracked.filter((i) => i.liveStatus === "pending" && i.liveRequestId);
  if (pending.length) {
    const { requests } = await client.liveRequests(pending.map((i) => i.liveRequestId!));
    const byReq = new Map(requests.map((r) => [r.id, r]));
    const done = pending.filter((i) => byReq.get(i.liveRequestId!)?.status === "done");
    const failed = pending.filter((i) => ["failed", "expired"].includes(byReq.get(i.liveRequestId!)?.status ?? ""));
    if (failed.length)
      db.transaction((tx) => {
        for (const it of failed) tx.update(shoppingItems).set({ liveStatus: "failed" }).where(eq(shoppingItems.id, it.id)).run();
      });
    if (done.length) {
      const res = await client.live({ refresh: done.map((i) => i.chronoProductId!), waitSeconds: 0 });
      applyCards(db, done, res.products ?? [], "done");
    }
  }
  const after = db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all().filter((i) => i.liveAskedAt);
  const stillPending = after.filter((i) => i.liveStatus === "pending").length;
  return { total: after.length, pending: stillPending, checked: after.length - stillPending };
}

/** Remplace le produit d'une ligne par une alternative (un tap sur une ligne rouge). */
export function swapProduct(db: Db, itemId: string, productId: string) {
  const it = db.select().from(shoppingItems).where(eq(shoppingItems.id, itemId)).get();
  if (!it) throw new Error("Ligne introuvable.");
  const alts = (it.alternativesJson ?? []) as ResolvedProduct[];
  const next = alts.find((p) => p.id === productId);
  if (!next) throw new Error("Alternative inconnue.");
  const prev = it.productJson as ResolvedProduct | null;
  const packs = packsFor(next, it.needG, it.packs ?? 1);
  db.update(shoppingItems)
    .set({ ...rejudge(it, next, packs), alternativesJson: [...alts.filter((p) => p.id !== productId), ...(prev ? [prev] : [])] })
    .where(eq(shoppingItems.id, itemId))
    .run();
  return it.listId;
}

export { AISLES };

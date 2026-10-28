// Vérification en code d'une recette proposée par l'IA (variante ou création) :
// diff avec l'original, chaque ingrédient de la recette passé au catalogue (/resolve)
// avec les produits du drive associés (src/lib/products : préféré, acceptés, jamais un
// refusé), nutrition recalculée (jamais celle de l'IA), restes de paquet, doublons.
// Pur : le résolveur, la bibliothèque et les associations sont injectés (tests sans réseau).
import type { ResolvedProduct, ResolveResponse } from "@/lib/chronocatalog";
import { effectivePrice } from "@/lib/chronocatalog";
import { SAMPLE_HOUSEHOLD, type Member } from "@/lib/eaters/core";
import { computeNutrition, eatenOf, gramsOf, round, scale, type Macros } from "@/lib/nutrition/compute";
import type { RecipeInput } from "@/lib/recipes/format";
import { phaseIssues } from "@/lib/recipes/phases";
import { resolveIngredient } from "@/lib/shopping/build";
import { associationKey, prefsFor, type AssocRow } from "@/lib/products/core";
import { judge, packsFor, pickProduct } from "@/lib/shopping/rules";

type Ing = RecipeInput["ingredients"][number];

export type Resolver = (q: string) => Promise<ResolveResponse>;

export interface LibraryRecipe {
  id: string;
  slug: string;
  name: string;
  status?: string;
  ingredients: { item: string; food: string | null; grams: number | null; units: number | null; pantry: boolean }[];
}

export interface IngCheck {
  state: "ok" | "warn" | "replace";
  product: { id: string; name: string; quantityLabel: string | null; price: number | null; url: string; imageUrl: string | null } | null;
  packs: number;
  notes: string[];
  /** Produits du drive associés à l'ingrédient : préféré, accepté, ou aucun (choix du catalogue). */
  association: "preferred" | "accepted" | "none";
}

export type DiffStatus = "same" | "changed" | "added" | "removed";

export interface DiffRow {
  key: string;
  status: DiffStatus;
  before: Ing | null;
  after: Ing | null;
  check: IngCheck | null; // tous les ingrédients de la recette (null : ingrédient retiré)
}

export interface Leftover {
  item: string;
  food: string | null;
  restG: number;
  orderedG: number;
  usedG: number;
  product: string;
  suggestions: { slug: string; name: string }[];
}

export interface Portions {
  /** La part de la personne de référence (la première du foyer : le profil actif). */
  lead: Macros;
  /** Une part par personne du foyer, à sa part de base. */
  people: { id: string; name: string; units: number; ref: Member["ref"]; macros: Macros }[];
  coverage: number;
}

export interface Verification {
  rows: DiffRow[];
  before: Portions | null;
  after: Portions;
  leftovers: Leftover[];
  /** Ingrédients indispensables sans produit ni remplaçant propre : la recette est indisponible. */
  blocked: string[];
  /** Ingrédients à acheter sans produit du drive associé (onglet « Produits » de la fiche). */
  unassociated: string[];
  warnings: string[];
}

// ─── Diff ───

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const qtyChanged = (a: Ing, b: Ing) => {
  const d = (x: number | null | undefined, y: number | null | undefined) =>
    (x ?? null) == null && (y ?? null) == null ? false : x == null || y == null ? true : Math.abs(x - y) > Math.max(0.5, 0.01 * Math.abs(x));
  return d(a.grams, b.grams) || d(a.units, b.units);
};

/** Associe les ingrédients avant/après : même nom, sinon même id nutrition s'il est unique des deux côtés. */
export function diffIngredients(before: Ing[], after: Ing[]): Omit<DiffRow, "check">[] {
  const usedB = new Set<number>();
  const pairOf = new Map<number, number>(); // index after → index before
  after.forEach((a, ia) => {
    const ib = before.findIndex((b, k) => !usedB.has(k) && norm(b.item) === norm(a.item));
    if (ib >= 0) {
      usedB.add(ib);
      pairOf.set(ia, ib);
    }
  });
  const uniqueFood = (list: Ing[], food: string) => list.filter((x) => x.food === food).length === 1;
  after.forEach((a, ia) => {
    if (pairOf.has(ia) || !a.food || a.food === "zero") return;
    if (!uniqueFood(after, a.food) || !uniqueFood(before, a.food)) return;
    const ib = before.findIndex((b, k) => !usedB.has(k) && b.food === a.food);
    if (ib >= 0) {
      usedB.add(ib);
      pairOf.set(ia, ib);
    }
  });
  const rows: Omit<DiffRow, "check">[] = [];
  // Ordre : celui de la nouvelle recette, les ingrédients retirés à leur ancienne place.
  let nextBefore = 0;
  const flushRemoved = (upTo: number) => {
    for (; nextBefore < upTo; nextBefore++)
      if (!usedB.has(nextBefore)) rows.push({ key: `b${nextBefore}`, status: "removed", before: before[nextBefore], after: null });
  };
  after.forEach((a, ia) => {
    const ib = pairOf.get(ia);
    if (ib != null) {
      flushRemoved(ib);
      const b = before[ib];
      rows.push({ key: `b${ib}`, status: qtyChanged(b, a) ? "changed" : "same", before: b, after: a });
    } else {
      rows.push({ key: `a${ia}`, status: "added", before: null, after: a });
    }
  });
  flushRemoved(before.length);
  return rows;
}

// ─── Catalogue ───

async function mapLimit<T, R>(items: T[], fn: (t: T) => Promise<R>, limit = 4): Promise<R[]> {
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

const productView = (p: ResolvedProduct) => ({
  id: p.id,
  name: p.name,
  quantityLabel: p.quantityLabel,
  price: effectivePrice(p),
  url: p.productUrl,
  imageUrl: p.imageUrl,
});

/** Un ingrédient passé au catalogue : produit, paquets, et verdict (ok, à vérifier, à remplacer). */
export async function checkIngredient(
  ing: Ing,
  res: Resolver,
  associations: AssocRow[] = []
): Promise<IngCheck & { weightG: number | null; orderedG: number | null; nothingToBuy: boolean }> {
  const r = await resolveIngredient({ lineRaw: ing.lineRaw, item: ing.item, grams: ing.grams ?? null, units: ing.units ?? null }, res);
  // Les réglages communs de l'ingrédient (une recette de l'atelier n'a pas encore de lignes à elle).
  const prefs = prefsFor(associations, associationKey({ item: ing.item, foodId: ing.food ?? null }, r).key);
  const need = gramsOf({ item: ing.item, food: ing.food ?? null, grams: ing.grams ?? null, units: ing.units ?? null });
  const nothingToBuy = !!(r?.none && r.none.reason !== "no_match");
  const pick = r || prefs.accepted.length ? pickProduct(r?.matchedTypes ?? [], { prefs, needG: need, pieces: ing.units ?? null }) : null;
  const association = pick && pick.via !== "catalog" ? pick.via : "none";
  // Sel, eau… : chronocatalog dit qu'il n'y a rien à acheter.
  if (nothingToBuy && !pick) return { state: "ok", product: null, packs: 0, notes: ["rien à acheter"], association, weightG: null, orderedG: null, nothingToBuy };
  if (!pick) return { state: "replace", product: null, packs: 0, notes: ["introuvable dans le catalogue"], association, weightG: null, orderedG: null, nothingToBuy };
  const packsOf = (p: ResolvedProduct) => (r?.purchase?.productId === p.id ? r.purchase.packs : packsFor(p, need, ing.units != null && need == null ? Math.ceil(ing.units) : 1));
  const packs = packsOf(pick.product);
  const j = judge({ product: pick.product, packs, aisle: "Épicerie", confidence: association === "none" ? r?.confidence : undefined });
  const assocNotes = association === "none" && !ing.pantry && !nothingToBuy ? ["aucun produit du drive associé"] : [];
  if (j.state !== "ko") {
    return {
      state: j.state,
      product: productView(pick.product),
      packs,
      notes: [...pick.notes, ...j.warnings, ...assocNotes],
      association,
      weightG: pick.product.weightG,
      orderedG: pick.product.weightG != null ? pick.product.weightG * packs : null,
      nothingToBuy,
    };
  }
  // En rupture : un remplaçant du même type, disponible, fait l'affaire.
  for (const alt of pick.alternatives) {
    const ap = packsOf(alt);
    const ja = judge({ product: alt, packs: ap, aisle: "Épicerie" });
    if (ja.state !== "ko")
      return {
        state: "warn",
        product: productView(alt),
        packs: ap,
        notes: [`${pick.product.name} : ${j.warnings[0] ?? "indisponible"}, remplacé par ce produit`, ...ja.warnings, ...assocNotes],
        association,
        weightG: alt.weightG,
        orderedG: alt.weightG != null ? alt.weightG * ap : null,
        nothingToBuy,
      };
  }
  return {
    state: "replace",
    product: productView(pick.product),
    packs,
    notes: [...j.warnings, "aucun remplaçant disponible", ...assocNotes],
    association,
    weightG: pick.product.weightG,
    orderedG: null,
    nothingToBuy,
  };
}

// ─── Nutrition ───

export function portions(r: Pick<RecipeInput, "ingredients" | "servingsUnits">, household: Member[] = SAMPLE_HOUSEHOLD): Portions {
  const n = computeNutrition(
    r.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, yield: i.yield ?? null })),
    r.servingsUnits
  );
  const list = household.length ? household : SAMPLE_HOUSEHOLD;
  const people = list.map((m) => ({ id: m.id, name: m.name, units: m.units, ref: m.ref, macros: round(scale(n.perUnit, m.units)) }));
  return { lead: people[0].macros, people, coverage: n.coverage };
}

// ─── Restes de paquet ───

const LEFTOVER_MIN_G = 80;

function recipesUsing(library: LibraryRecipe[], ing: Ing, exclude: Set<string>) {
  const key = norm(ing.item).split(" ").filter((w) => w.length >= 4)[0];
  return library
    .filter((r) => !exclude.has(r.slug) && r.status !== "archived")
    .filter((r) =>
      r.ingredients.some((x) => (ing.food && ing.food !== "zero" ? x.food === ing.food : key ? norm(x.item).includes(key) : false))
    )
    .slice(0, 3)
    .map((r) => ({ slug: r.slug, name: r.name }));
}

// ─── Doublons ───

const STOP = new Set(["avec", "sans", "sauce", "facon", "maison", "plat", "recette", "minute", "pour", "dans", "les", "des", "aux"]);
const tokens = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/s$/, "")));

function mainKeys(ings: { item: string; food: string | null; grams: number | null; units: number | null; pantry?: boolean }[]) {
  return ings
    .filter((i) => !i.pantry && i.food !== "zero")
    .map((i) => ({ k: i.food ?? norm(i.item).split(" ")[0], g: gramsOf({ item: i.item, food: i.food, grams: i.grams, units: i.units }) ?? 0 }))
    .sort((a, b) => b.g - a.g)
    .slice(0, 3)
    .map((x) => x.k);
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Une recette trop proche d'une recette de la bibliothèque (nom, ou mêmes ingrédients principaux). */
export function findDuplicate(
  draft: Pick<RecipeInput, "name" | "ingredients">,
  library: LibraryRecipe[]
): { slug: string; name: string; why: string } | null {
  const mk = mainKeys(draft.ingredients.map((i) => ({ item: i.item, food: i.food ?? null, grams: i.grams ?? null, units: i.units ?? null, pantry: i.pantry })));
  const nt = tokens(draft.name);
  for (const r of library) {
    if (r.status === "archived") continue;
    const nameSim = jaccard(nt, tokens(r.name));
    const rk = new Set(mainKeys(r.ingredients));
    const overlap = mk.filter((k) => rk.has(k)).length;
    if (nameSim >= 0.5) return { slug: r.slug, name: r.name, why: "nom presque identique" };
    if (overlap >= 3 || (overlap >= 2 && nameSim >= 0.25))
      return { slug: r.slug, name: r.name, why: `mêmes ingrédients principaux (${overlap} sur 3)` };
  }
  return null;
}

/**
 * L'IA ne voit pas le rendement des lignes (parure, gras dans la poêle, part du paquet) :
 * on le reprend de la version précédente pour chaque ingrédient apparié. Si la quantité
 * change, seule la parure et la perte à la poêle suivent (propres à l'aliment).
 */
export function carryYield(before: Ing[], after: Ing[]): Ing[] {
  const rows = diffIngredients(before, after);
  const byAfter = new Map<Ing, Ing>();
  for (const r of rows) if (r.before && r.after) byAfter.set(r.after, r.before);
  return after.map((a) => {
    const b = byAfter.get(a);
    if (!b?.yield || a.yield) return a;
    if (b.food !== a.food) return a;
    const { usedGrams: _g, usedPct: _p, ...kept } = b.yield;
    return { ...a, yield: qtyChanged(b, a) ? kept : b.yield };
  });
}

// ─── Vérification complète ───

export async function verifyRecipe(input: {
  draft: RecipeInput;
  original: RecipeInput | null;
  library: LibraryRecipe[];
  resolve: Resolver;
  /** Produits du drive associés aux ingrédients (table ingredient_products) : valent pour tous les ingrédients. */
  associations?: AssocRow[];
  /** Le foyer, personne de référence en tête (src/lib/eaters). */
  household?: Member[];
}): Promise<Verification> {
  const { draft, original, library } = input;
  const rows0 = original
    ? diffIngredients(original.ingredients, draft.ingredients)
    : draft.ingredients.map((a, k) => ({ key: `a${k}`, status: "added" as const, before: null, after: a }));
  // Tous les ingrédients à acheter passent au catalogue (un ingrédient inchangé peut être
  // en rupture, ou sans produit associé) ; les restes de paquet ne regardent que ce qui change.
  // Le placard inchangé (sel, poivre, huile) reste à vérifier chez soi : pas de détour par le catalogue.
  const toCheck = rows0.filter((r) => r.after && !(r.status === "same" && r.after.pantry));
  const checks = await mapLimit(toCheck, (r) => checkIngredient(r.after!, input.resolve, input.associations ?? []));
  const byKey = new Map(toCheck.map((r, k) => [r.key, checks[k]]));
  const unassociated = toCheck.filter((r, k) => !r.after!.pantry && !checks[k].nothingToBuy && checks[k].association === "none").map((r) => r.after!.item);

  const blocked: string[] = [];
  const warnings: string[] = [];
  const leftovers: Leftover[] = [];
  const exclude = new Set([draft.slug, ...(original ? [original.slug] : [])]);

  const rows: DiffRow[] = rows0.map((r) => {
    const c = byKey.get(r.key);
    if (!c) return { ...r, check: null };
    const ing = r.after!;
    const essential = !ing.optional && !ing.pantry;
    // Au placard, un produit introuvable n'empêche rien : on le signale seulement.
    const state = c.state === "replace" && !essential ? "warn" : c.state;
    if (state === "replace") blocked.push(ing.item);
    // Ce qui sort vraiment du paquet (rendement de la ligne : « la moitié du pot »).
    const forN = { item: ing.item, food: ing.food ?? null, grams: ing.grams ?? null, units: ing.units ?? null, yield: ing.yield ?? null };
    const used = eatenOf(forN)?.usedG ?? gramsOf(forN);
    if (r.status !== "same" && !ing.pantry && c.orderedG != null && used != null && used >= 50) {
      const rest = Math.round(c.orderedG - used);
      if (rest >= LEFTOVER_MIN_G && rest >= 0.2 * (c.weightG ?? 0))
        leftovers.push({
          item: ing.item,
          food: ing.food ?? null,
          restG: rest,
          orderedG: Math.round(c.orderedG),
          usedG: Math.round(used),
          product: c.product?.name ?? ing.item,
          suggestions: recipesUsing(library, ing, exclude),
        });
    }
    const { weightG: _w, orderedG: _o, nothingToBuy: _n, ...check } = c;
    return { ...r, check: { ...check, state } };
  });

  for (const s of draft.steps) {
    if (s.kind === "sear" && (s.hobLevel == null || !s.cue)) warnings.push(`Saisie sans ${s.hobLevel == null ? "niveau" : "repère visuel"} : « ${s.text.slice(0, 60)}… »`);
  }
  for (const i of phaseIssues(draft)) warnings.push(`Sous-étapes, étape ${i.step} : ${i.issue}.`);
  const after = portions(draft, input.household);
  if (after.coverage < 0.8) warnings.push(`Nutrition partielle : ${Math.round(after.coverage * 100)} % des ingrédients sont dans la table.`);
  if (unassociated.length)
    warnings.push(
      `${unassociated.length} ingrédient${unassociated.length > 1 ? "s" : ""} sans produit du drive associé (choix du catalogue) : ${unassociated.join(", ")}.`
    );

  return { rows, before: original ? portions(original, input.household) : null, after, leftovers, blocked, unassociated, warnings };
}

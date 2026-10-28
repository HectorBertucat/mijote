// Coûts d'une recette, en code (pas d'IA). docs/vision.md §4.6.
//
// Réel (la recette a été cuisinée, cook_usages) :
//   - théorique = Σ valeur des grammes consommés (grammes × prix au gramme payé du lot ;
//     sans lot, prix du catalogue de la dernière liste), moyenne par cuisson ;
//   - pratique = théorique + la part de la recette dans les lots marqués « perdu » parmi ceux
//     achetés pour elle. Un reste encore au placard (ok) ou marqué « utilisé » sert ailleurs :
//     il n'est pas compté. Ainsi pratique = paquets entiers − restes qui serviront ailleurs.
// Estimé (pas encore cuisinée, dernière liste) :
//   - théorique = Σ grammes de la recette × prix au gramme du catalogue ;
//   - pratique = Σ part de la recette × prix des paquets entiers.
// Par part : coût × unités de la part (people.portion_units) / unités de la fiche.
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookUsages, pantryLots, people, purchases, recipes, shoppingItemSources } from "@/lib/db/schema";
import { latestNeeds, sharesOf } from "./needs";

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface CostPair {
  theoretical: number;
  practical: number;
}

export interface RecipeCost {
  recipeId: string;
  slug: string;
  name: string;
  servingsUnits: number;
  kind: "real" | "estimate" | "none";
  cooks: number;
  lastCookedAt: string | null;
  /** pour une fournée à la taille de la fiche */
  batch: CostPair | null;
  /** La part de la première personne du foyer (people.rank), à sa part de base. */
  partLead: CostPair | null;
  /** Une part par personne du foyer, à sa part de base. */
  parts: { personId: string; name: string; units: number; cost: CostPair }[];
  /** pratique − théorique : le gaspillage (formats, restes perdus) */
  waste: number | null;
  /** part des lignes de la recette dont on connaît le prix (0 à 1) */
  coverage: number;
}

export function perPart(c: CostPair, servingsUnits: number, units: number): CostPair {
  const k = units / Math.max(1, servingsUnits);
  return { theoretical: round2(c.theoretical * k), practical: round2(c.practical * k) };
}

/** Coût estimé depuis la dernière liste de courses de la recette. */
export function estimateCost(db: Db, recipeId: string): { cost: CostPair; coverage: number } | null {
  const latest = latestNeeds(db, recipeId);
  if (!latest) return null;
  const buy = latest.needs.filter((n) => !n.pantry);
  if (!buy.length) return null;
  let theoretical = 0;
  let practical = 0;
  let known = 0;
  for (const n of buy) {
    const whole = n.lineTotal != null ? n.lineTotal * n.share : null;
    if (whole == null) continue;
    known++;
    practical += whole;
    theoretical += n.pricePerG != null && n.needG != null ? Math.min(whole, n.needG * n.pricePerG) : whole;
  }
  return { cost: { theoretical: round2(theoretical), practical: round2(practical) }, coverage: known / buy.length };
}

/** Coût réel moyen par cuisson, depuis cook_usages et les lots perdus. */
export function realCost(db: Db, recipeId: string): { cost: CostPair; cooks: number; lastCookedAt: string; coverage: number; lost: number } | null {
  const us = db.select().from(cookUsages).where(eq(cookUsages.recipeId, recipeId)).all();
  if (!us.length) return null;
  const cooks = new Set(us.map((u) => u.sessionId ?? u.cookedAt));
  const theoretical = us.reduce((t, u) => t + (u.value ?? 0), 0);
  const coverage = us.filter((u) => u.value != null).length / us.length;

  // Lots perdus achetés (en partie) pour cette recette.
  const mySources = db.select({ itemId: shoppingItemSources.itemId }).from(shoppingItemSources).where(eq(shoppingItemSources.recipeId, recipeId)).all();
  let lost = 0;
  const itemIds = [...new Set(mySources.map((s) => s.itemId))];
  if (itemIds.length) {
    const lostLots = db
      .select({ value: pantryLots.valueLeft, itemId: purchases.shoppingItemId })
      .from(pantryLots)
      .innerJoin(purchases, eq(purchases.id, pantryLots.purchaseId))
      .where(eq(pantryLots.status, "lost"))
      .all()
      .filter((l) => l.itemId && itemIds.includes(l.itemId));
    if (lostLots.length) {
      const src = db.select().from(shoppingItemSources).where(inArray(shoppingItemSources.itemId, lostLots.map((l) => l.itemId!))).all();
      for (const l of lostLots) lost += l.value * (sharesOf(src.filter((s) => s.itemId === l.itemId)).get(recipeId) ?? 0);
    }
  }
  const n = cooks.size;
  return {
    cost: { theoretical: round2(theoretical / n), practical: round2((theoretical + lost) / n) },
    cooks: n,
    lastCookedAt: us.reduce((m, u) => (u.cookedAt > m ? u.cookedAt : m), ""),
    coverage,
    lost: round2(lost),
  };
}

export function recipeCost(db: Db, recipeId: string): RecipeCost | null {
  const r = db.select().from(recipes).where(eq(recipes.id, recipeId)).get();
  if (!r) return null;
  const base = { recipeId: r.id, slug: r.slug, name: r.name, servingsUnits: r.servingsUnits };
  const real = realCost(db, r.id);
  const est = real ? null : estimateCost(db, r.id);
  const batch = real?.cost ?? est?.cost ?? null;
  const household = db.select({ id: people.id, name: people.name, portionUnits: people.portionUnits }).from(people).orderBy(asc(people.rank), asc(people.name)).all();
  return {
    ...base,
    kind: real ? "real" : est ? "estimate" : "none",
    cooks: real?.cooks ?? 0,
    lastCookedAt: real?.lastCookedAt ?? null,
    batch,
    partLead: batch && household[0] ? perPart(batch, r.servingsUnits, household[0].portionUnits) : null,
    parts: batch ? household.map((p) => ({ personId: p.id, name: p.name, units: p.portionUnits, cost: perPart(batch, r.servingsUnits, p.portionUnits) })) : [],
    waste: batch ? round2(batch.practical - batch.theoretical) : null,
    coverage: real?.coverage ?? est?.coverage ?? 0,
  };
}

export function allRecipeCosts(db: Db): RecipeCost[] {
  return db
    .select({ id: recipes.id })
    .from(recipes)
    .all()
    .map((r) => recipeCost(db, r.id)!)
    .sort((a, b) => (a.kind === "none" ? 1 : 0) - (b.kind === "none" ? 1 : 0) || (b.partLead?.practical ?? 0) - (a.partLead?.practical ?? 0));
}

export function spendingTotals(db: Db) {
  const ps = db.select({ paid: purchases.pricePaid, promo: purchases.promo }).from(purchases).all();
  return { purchases: ps.length, spent: round2(ps.reduce((t, p) => t + p.paid, 0)) };
}

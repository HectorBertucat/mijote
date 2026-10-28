// « J'ai cuisiné » : ce que la recette a consommé (cook_usages) et les lots du placard décrémentés.
// Contrat pour la session de cuisine : planCookUsage() propose, recordCookUsage() enregistre.
import { randomUUID } from "crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookUsages, pantryLots, purchases } from "@/lib/db/schema";
import { latestNeeds } from "./needs";

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface CookUsageLine {
  lotId: string | null; // null : pas de lot au placard, prix du catalogue (dernière liste)
  grams: number;
  value?: number | null; // pour lotId null : valeur estimée ; pour un lot, calculée au prorata du lot
  item?: string | null;
}

export interface CookUsageInput {
  sessionId?: string | null;
  recipeId: string;
  cookedAt?: string;
  usages: CookUsageLine[];
}

export interface PlannedUsage extends CookUsageLine {
  item: string;
  lotName: string | null;
  value: number | null;
  source: "lot" | "catalogue" | "unknown";
}

/**
 * La consommation par défaut d'une recette : pour chaque ligne de sa dernière liste de courses,
 * les grammes de la fiche (au prorata si la ligne sert plusieurs recettes), pris dans les lots
 * « ok » du même produit, les plus anciens d'abord. Ce qui n'est pas au placard est compté au
 * prix du catalogue de la dernière liste. Les lignes « placard » (sel, huile…) sans lot sont ignorées.
 */
export function planCookUsage(db: Db, recipeId: string): PlannedUsage[] {
  const latest = latestNeeds(db, recipeId);
  if (!latest) return [];
  const lots = db
    .select({ lot: pantryLots, name: purchases.name, boughtAt: purchases.boughtAt })
    .from(pantryLots)
    .leftJoin(purchases, eq(purchases.id, pantryLots.purchaseId))
    .where(eq(pantryLots.status, "ok"))
    .orderBy(asc(purchases.boughtAt))
    .all();
  const left = new Map(lots.map((l) => [l.lot.id, l.lot.gramsLeft]));
  const out: PlannedUsage[] = [];
  for (const n of latest.needs) {
    const mine = lots.filter((l) => l.lot.item === n.item);
    if (n.needG == null) {
      // Sans grammes connus (pièces sans poids) : le lot entier le plus ancien, s'il y en a un.
      const l = mine.find((x) => (left.get(x.lot.id) ?? 0) >= 0);
      if (l) {
        out.push({ lotId: l.lot.id, grams: l.lot.gramsLeft, item: n.item, lotName: l.name, value: round2(l.lot.valueLeft), source: "lot" });
        left.set(l.lot.id, -1);
      } else if (!n.pantry && n.lineTotal != null) {
        out.push({ lotId: null, grams: 0, item: n.item, lotName: null, value: round2(n.lineTotal * n.share), source: "catalogue" });
      }
      continue;
    }
    let need = n.needG;
    for (const l of mine) {
      if (need <= 0) break;
      const g = left.get(l.lot.id) ?? 0;
      if (l.lot.gramsInitial === 0 && g >= 0) {
        // Lot sans poids connu : consommé en entier.
        out.push({ lotId: l.lot.id, grams: 0, item: n.item, lotName: l.name, value: round2(l.lot.valueLeft), source: "lot" });
        left.set(l.lot.id, -1);
        need = 0;
        break;
      }
      if (g <= 0) continue;
      const take = Math.min(g, need);
      out.push({ lotId: l.lot.id, grams: Math.round(take), item: n.item, lotName: l.name, value: round2((take * l.lot.valueLeft) / g), source: "lot" });
      left.set(l.lot.id, g - take);
      need -= take;
    }
    if (need > 0.5 && !n.pantry) {
      out.push({
        lotId: null,
        grams: Math.round(need),
        item: n.item,
        lotName: null,
        value: n.pricePerG != null ? round2(need * n.pricePerG) : null,
        source: n.pricePerG != null ? "catalogue" : "unknown",
      });
    }
  }
  return out;
}

/**
 * Enregistre une cuisson : une ligne cook_usages par lot (grammes, valeur figée au prorata de ce
 * qui restait dans le lot), et décrémente les lots. Un lot vidé passe en « used ».
 * sessionId est facultatif (« J'ai cuisiné » depuis la fiche recette). Synchrone, une transaction.
 */
export function recordCookUsage(db: Db, input: CookUsageInput) {
  const cookedAt = input.cookedAt ?? new Date().toISOString();
  let total = 0;
  let lotsTouched = 0;
  db.transaction((tx) => {
    for (const u of input.usages) {
      let grams = Math.max(0, u.grams);
      let value = u.value ?? null;
      if (u.lotId) {
        const lot = tx.select().from(pantryLots).where(eq(pantryLots.id, u.lotId)).get();
        if (!lot) throw new Error(`Lot inconnu : ${u.lotId}`);
        if (lot.status !== "ok") throw new Error(`Lot déjà ${lot.status === "used" ? "utilisé" : "perdu"} : ${lot.item}`);
        const whole = lot.gramsInitial === 0 || grams >= lot.gramsLeft - 0.5;
        grams = whole ? lot.gramsLeft : grams;
        value = whole ? lot.valueLeft : (grams * lot.valueLeft) / lot.gramsLeft;
        const gramsLeft = whole ? 0 : lot.gramsLeft - grams;
        const valueLeft = whole ? 0 : lot.valueLeft - value;
        tx.update(pantryLots)
          .set(whole ? { gramsLeft, valueLeft, status: "used", closedAt: cookedAt, openedAt: lot.openedAt ?? cookedAt } : { gramsLeft, valueLeft, openedAt: lot.openedAt ?? cookedAt })
          .where(and(eq(pantryLots.id, lot.id), eq(pantryLots.status, "ok")))
          .run();
        lotsTouched++;
        u.item ??= lot.item;
      }
      if (value != null) total += value;
      tx.insert(cookUsages)
        .values({ id: randomUUID(), sessionId: input.sessionId ?? null, recipeId: input.recipeId, lotId: u.lotId, grams, cookedAt, value: value != null ? round2(value) : null, item: u.item ?? null })
        .run();
    }
  });
  return { cookedAt, total: round2(total), lotsTouched, lines: input.usages.length };
}

/** La cuisson par défaut d'une recette (le bouton « J'ai cuisiné »). */
export function cookRecipe(db: Db, recipeId: string, sessionId?: string | null) {
  const plan = planCookUsage(db, recipeId);
  if (!plan.length) throw new Error("Aucune liste de courses pour cette recette : rien à décompter.");
  return recordCookUsage(db, { recipeId, sessionId, usages: plan.map(({ lotId, grams, value, item }) => ({ lotId, grams, value, item })) });
}

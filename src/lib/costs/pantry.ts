// Le placard : lots restants d'un achat, marqués utilisés ou perdus d'un tap.
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { pantryLots, purchases } from "@/lib/db/schema";

export function listLots(db: Db, status: "ok" | "closed" = "ok") {
  const where = status === "ok" ? eq(pantryLots.status, "ok") : inArray(pantryLots.status, ["used", "lost"]);
  return db
    .select({ lot: pantryLots, name: purchases.name, boughtAt: purchases.boughtAt, packs: purchases.packs, packG: purchases.packG, promo: purchases.promo })
    .from(pantryLots)
    .leftJoin(purchases, eq(purchases.id, pantryLots.purchaseId))
    .where(where)
    .orderBy(status === "ok" ? desc(purchases.boughtAt) : desc(pantryLots.closedAt))
    .limit(status === "ok" ? 500 : 30)
    .all();
}

/**
 * Clôt un lot. « used » : le reste a servi ailleurs (pas compté à la recette) ;
 * « lost » : jeté, sa valeur revient aux recettes pour lesquelles il a été acheté.
 * grams_left et value_left gardent ce qui restait au moment de la clôture.
 */
export function closeLot(db: Db, lotId: string, status: "used" | "lost") {
  const lot = db.select().from(pantryLots).where(eq(pantryLots.id, lotId)).get();
  if (!lot) throw new Error("Lot introuvable.");
  db.update(pantryLots).set({ status, closedAt: new Date().toISOString() }).where(eq(pantryLots.id, lotId)).run();
  return lot;
}

/** Annule une clôture faite par erreur. */
export function reopenLot(db: Db, lotId: string) {
  db.update(pantryLots).set({ status: "ok", closedAt: null }).where(eq(pantryLots.id, lotId)).run();
}

export function pantryTotals(db: Db) {
  return db
    .select({
      okCount: sql<number>`sum(case when ${pantryLots.status} = 'ok' then 1 else 0 end)`,
      okValue: sql<number>`coalesce(sum(case when ${pantryLots.status} = 'ok' then ${pantryLots.valueLeft} else 0 end), 0)`,
      lostValue: sql<number>`coalesce(sum(case when ${pantryLots.status} = 'lost' then ${pantryLots.valueLeft} else 0 end), 0)`,
    })
    .from(pantryLots)
    .get()!;
}

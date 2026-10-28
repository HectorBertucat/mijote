// Le vrai panier Chronodrive et la commande passée, par le compte drive configuré (tâches du worker de
// chronocatalog, POST /api/v1/account/jobs). Cuisine n'appelle jamais chronodrive.com.
//
// 1. « Envoyer au panier » : chaque ligne à acheter part avec son nombre de paquets (mode
//    « ensure » : ce qui est déjà au panier compte, renvoyer ne double rien). Le worker relit
//    le panier : chaque ligne dit ce qui y est vraiment (ajouté, partiel, indisponible).
// 2. On paie et choisit son créneau sur chronodrive.com (pas automatisé).
// 3. « Relire ma commande » : la commande récente qui ressemble le plus à la liste devient la
//    vérité : la liste est validée si elle ne l'était pas, et chaque achat prend le prix
//    réellement payé (le prix estimé reste à côté, pour l'écart).
// Les fonctions pures (cartPayload, cartUpdates, matchOrder, orderUpdates) sont testées.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { pantryLots, purchases, shoppingItems, shoppingLists } from "@/lib/db/schema";
import { accountJob, accountJobs, type CartAddResult, type ChronoOrder, type OrdersResult, type ResolvedProduct } from "@/lib/chronocatalog";
import { validateOrder } from "./cart";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** « …-P409519 » (productUrl documenté de chronocatalog) → « P409519 ». */
export const chronoIdFromUrl = (url: string | null | undefined) => {
  const m = /-P(\d+)(?:[/?#]|$)/.exec(url ?? "");
  return m ? `P${m[1]}` : null;
};

export interface DriveItem {
  id: string;
  pantry: boolean;
  packs: number | null;
  productJson: unknown;
  chronoId?: string | null;
}

/** Ce qui part au panier : lignes à acheter avec un produit du drive, paquets cumulés par produit. */
export function cartPayload(items: DriveItem[]): { productId: string; quantity: number }[] {
  const by = new Map<string, number>();
  for (const it of items) {
    const p = it.productJson as ResolvedProduct | null;
    if (it.pantry || !p || p.source === "manual" || !((it.packs ?? 0) > 0)) continue;
    by.set(p.id, (by.get(p.id) ?? 0) + Math.min(50, it.packs!));
  }
  return [...by].map(([productId, quantity]) => ({ productId, quantity: Math.min(50, quantity) }));
}

export interface ItemDrive {
  outcome: string;
  qty: number | null;
  chronoId: string | null;
}

/** Le rapport du panier, ligne de courses par ligne de courses (par id de produit). */
export function cartUpdates(items: DriveItem[], result: CartAddResult): Map<string, ItemDrive> {
  const byRef = new Map<string, CartAddResult["lines"][number]>();
  for (const l of result.lines) for (const r of l.refs) byRef.set(r, l);
  const skipped = new Set((result.skipped ?? []).map((s) => s.ref));
  const out = new Map<string, ItemDrive>();
  for (const it of items) {
    const p = it.productJson as ResolvedProduct | null;
    if (it.pantry || !p || !((it.packs ?? 0) > 0)) continue;
    const l = byRef.get(p.id);
    if (l) out.set(it.id, { outcome: l.outcome, qty: l.after, chronoId: l.chronoId });
    else if (skipped.has(p.id) || p.source === "manual") out.set(it.id, { outcome: "skipped", qty: null, chronoId: null });
  }
  return out;
}

/** La commande récente qui partage le plus de produits avec la liste (au moins un). */
export function matchOrder(orders: ChronoOrder[], chronoIds: Set<string>): { order: ChronoOrder; matched: number } | null {
  let best: { order: ChronoOrder; matched: number } | null = null;
  for (const o of orders) {
    const matched = new Set(o.items.map((i) => i.chronoId).filter((c) => chronoIds.has(c))).size;
    if (matched > 0 && (!best || matched > best.matched)) best = { order: o, matched };
  }
  return best;
}

export interface PurchaseLike {
  id: string;
  chronoId: string | null;
  packs: number;
  pricePaid: number;
}

/** Prix et paquets réellement payés, par achat (les produits absents de la commande restent tels quels). */
export function orderUpdates(ps: PurchaseLike[], order: ChronoOrder): { updates: Map<string, { packs: number; pricePaid: number }>; missing: string[] } {
  const paid = new Map<string, { qty: number; total: number }>();
  for (const i of order.items) {
    const cur = paid.get(i.chronoId) ?? { qty: 0, total: 0 };
    cur.qty += i.quantity;
    cur.total += i.totalAmount ?? (i.unitPrice ?? 0) * i.quantity;
    paid.set(i.chronoId, cur);
  }
  const updates = new Map<string, { packs: number; pricePaid: number }>();
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const p of ps) {
    const got = p.chronoId ? paid.get(p.chronoId) : undefined;
    if (!got) {
      missing.push(p.id);
      continue;
    }
    // Deux achats du même produit (rare) : le premier prend la ligne de commande.
    if (seen.has(p.chronoId!)) continue;
    seen.add(p.chronoId!);
    updates.set(p.id, { packs: got.qty, pricePaid: round2(got.total) });
  }
  return { updates, missing };
}

// ─── Base ───

function getList(db: Db, listId: string) {
  const l = db.select().from(shoppingLists).where(eq(shoppingLists.id, listId)).get();
  if (!l) throw new Error("Liste introuvable.");
  return l;
}

const itemsOf = (db: Db, listId: string) => db.select().from(shoppingItems).where(eq(shoppingItems.listId, listId)).all();

/** « Envoyer au panier » : une tâche pour le worker ; le suivi passe par pollDrive. */
export async function sendToDrive(db: Db, listId: string) {
  const l = getList(db, listId);
  if (l.status === "ordered" || l.status === "paid") throw new Error("Commande déjà validée : rien à envoyer.");
  const items = itemsOf(db, listId);
  const payload = cartPayload(items);
  if (!payload.length) throw new Error("Aucune ligne avec un produit du drive à envoyer.");
  const { job } = await accountJob("cart_add", { items: payload, mode: "ensure" });
  db.update(shoppingLists).set({ driveJobId: job.id, driveStatus: "pending", driveAt: new Date().toISOString(), driveError: null }).where(eq(shoppingLists.id, listId)).run();
  return { products: payload.length, packs: payload.reduce((s, x) => s + x.quantity, 0) };
}

/** Suivi de l'envoi : à la fin, chaque ligne dit ce que le panier en a fait, et se coche. */
export async function pollDrive(db: Db, listId: string): Promise<{ status: "pending" | "done" | "failed" | null; summary: Record<string, number> | null; error: string | null }> {
  const l = getList(db, listId);
  if (!l.driveJobId || l.driveStatus !== "pending") return { status: l.driveStatus, summary: l.driveSummary, error: l.driveError };
  const { jobs } = await accountJobs([l.driveJobId]);
  const job = jobs[0];
  if (!job || job.status === "pending") return { status: "pending", summary: null, error: null };
  if (job.status === "failed") {
    db.update(shoppingLists).set({ driveStatus: "failed", driveError: job.error ?? "échec" }).where(eq(shoppingLists.id, listId)).run();
    return { status: "failed", summary: null, error: job.error };
  }
  const result = job.result as CartAddResult;
  const items = itemsOf(db, listId);
  const ups = cartUpdates(items, result);
  const at = new Date().toISOString();
  const summary = { ...result.summary, skipped: [...ups.values()].filter((u) => u.outcome === "skipped").length, total: result.totalCartAmount ?? 0 };
  db.transaction((tx) => {
    for (const [id, u] of ups) {
      const inCart = (u.qty ?? 0) > 0;
      tx.update(shoppingItems)
        .set({ driveOutcome: u.outcome, driveQty: u.qty, chronoId: u.chronoId, ...(inCart ? { inCartAt: at } : {}) })
        .where(eq(shoppingItems.id, id))
        .run();
    }
    tx.update(shoppingLists).set({ driveStatus: "done", driveSummary: summary }).where(eq(shoppingLists.id, listId)).run();
  });
  return { status: "done", summary, error: null };
}

/** « Relire ma commande » : les dernières commandes, sauf celles déjà relues pour une autre liste. */
export async function readOrder(db: Db, listId: string) {
  getList(db, listId);
  const known = db
    .select({ id: shoppingLists.chronoOrderId })
    .from(shoppingLists)
    .where(isNotNull(shoppingLists.chronoOrderId))
    .all()
    .map((r) => r.id!)
    .filter(Boolean);
  const { job } = await accountJob("orders", { limit: 3, knownIds: known });
  db.update(shoppingLists).set({ orderJobId: job.id, orderStatus: "pending", orderError: null }).where(eq(shoppingLists.id, listId)).run();
}

export async function pollOrder(db: Db, listId: string): Promise<{ status: "pending" | "done" | "failed" | null; message: string | null }> {
  const l = getList(db, listId);
  if (!l.orderJobId || l.orderStatus !== "pending") return { status: l.orderStatus, message: l.orderError };
  const { jobs } = await accountJobs([l.orderJobId]);
  const job = jobs[0];
  if (!job || job.status === "pending") return { status: "pending", message: null };
  const failWith = (msg: string) => {
    db.update(shoppingLists).set({ orderStatus: "failed", orderError: msg }).where(eq(shoppingLists.id, listId)).run();
    return { status: "failed" as const, message: msg };
  };
  if (job.status === "failed") return failWith(job.error ?? "échec");
  const res = job.result as OrdersResult;
  const items = itemsOf(db, listId);
  const ids = new Set(items.map((i) => i.chronoId ?? chronoIdFromUrl((i.productJson as ResolvedProduct | null)?.productUrl)).filter((c): c is string => !!c));
  const best = matchOrder(res.orders, ids);
  if (!best) return failWith(res.orders.length ? "Aucune commande récente ne contient les produits de cette liste." : "Pas de nouvelle commande sur ton compte : passe-la sur chronodrive.com, puis relis-la.");
  return { status: "done", message: applyOrder(db, listId, best.order) };
}

/** Valide la liste si besoin, puis met les prix payés sur les achats et leurs lots. */
export function applyOrder(db: Db, listId: string, order: ChronoOrder, at = new Date().toISOString()): string {
  let l = getList(db, listId);
  if (l.status !== "ordered" && l.status !== "paid") {
    validateOrder(db, listId, order.createdAt ?? at);
    l = getList(db, listId);
  }
  const items = itemsOf(db, listId);
  const chronoOf = new Map(items.map((i) => [i.id, i.chronoId ?? chronoIdFromUrl((i.productJson as ResolvedProduct | null)?.productUrl)]));
  const ps = db.select().from(purchases).where(eq(purchases.listId, listId)).all();
  const { updates, missing } = orderUpdates(
    ps.map((p) => ({ id: p.id, chronoId: p.shoppingItemId ? chronoOf.get(p.shoppingItemId) ?? null : null, packs: p.packs, pricePaid: p.pricePaid })),
    order
  );
  const lots = ps.length ? db.select().from(pantryLots).where(inArray(pantryLots.purchaseId, ps.map((p) => p.id))).all() : [];
  let before = 0;
  let after = 0;
  db.transaction((tx) => {
    for (const p of ps) {
      const u = updates.get(p.id);
      const estimated = p.priceEstimated ?? p.pricePaid;
      before += estimated;
      after += u?.pricePaid ?? p.pricePaid;
      if (!u) continue;
      tx.update(purchases).set({ priceEstimated: estimated, pricePaid: u.pricePaid, packs: u.packs, chronoOrderId: order.id }).where(eq(purchases.id, p.id)).run();
      for (const lot of lots.filter((x) => x.purchaseId === p.id)) {
        const k = p.pricePaid > 0 ? u.pricePaid / p.pricePaid : 1;
        const untouched = lot.status === "ok" && lot.gramsInitial != null && Math.abs(lot.gramsLeft - lot.gramsInitial) < 0.5;
        const grams = untouched && p.packG && u.packs !== p.packs ? u.packs * p.packG : null;
        tx.update(pantryLots)
          .set({
            valueInitial: u.pricePaid,
            valueLeft: round2(lot.valueLeft * k),
            ...(grams != null ? { gramsInitial: grams, gramsLeft: grams } : {}),
          })
          .where(eq(pantryLots.id, lot.id))
          .run();
      }
    }
    tx.update(shoppingLists).set({ orderStatus: "done", chronoOrderId: order.id, orderImportedAt: at, orderError: null }).where(eq(shoppingLists.id, listId)).run();
  });
  const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;
  const gap = round2(after - before);
  return `Commande du ${order.createdAt ? new Date(order.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }) : "?"} relue : ${updates.size} achats au prix payé (${eur(after)}, ${gap === 0 ? "comme estimé" : `${gap > 0 ? "+" : "−"}${eur(Math.abs(gap))} sur l'estimation`})${missing.length ? `, ${missing.length} absent${missing.length > 1 ? "s" : ""} de la commande` : ""}.`;
}

/** Les achats de la liste : estimé, payé, et si la commande a été relue. */
export function orderSummary(db: Db, listId: string) {
  const ps = db.select({ estimated: purchases.priceEstimated, paid: purchases.pricePaid, order: purchases.chronoOrderId }).from(purchases).where(and(eq(purchases.listId, listId))).all();
  if (!ps.length || !ps.some((p) => p.order)) return null;
  const paid = round2(ps.reduce((s, p) => s + p.paid, 0));
  const estimated = round2(ps.reduce((s, p) => s + (p.estimated ?? p.paid), 0));
  return { paid, estimated, matched: ps.filter((p) => p.order).length, total: ps.length };
}

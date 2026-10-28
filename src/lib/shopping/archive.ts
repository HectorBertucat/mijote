// Ranger les listes de courses : archiver (restaurable) ou supprimer. Une liste qui a servi
// (commande validée, achats, session de cuisine) n'est jamais effacée : elle est archivée,
// pour garder le placard et les coûts justes.
import { inArray, isNotNull, isNull, and } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, purchases, shoppingItems, shoppingItemSources, shoppingLists } from "@/lib/db/schema";

export function archiveLists(db: Db, ids: string[]): number {
  if (!ids.length) return 0;
  return db.update(shoppingLists).set({ archivedAt: new Date().toISOString() }).where(and(inArray(shoppingLists.id, ids), isNull(shoppingLists.archivedAt))).run().changes;
}

export function restoreLists(db: Db, ids: string[]): number {
  if (!ids.length) return 0;
  return db.update(shoppingLists).set({ archivedAt: null }).where(and(inArray(shoppingLists.id, ids), isNotNull(shoppingLists.archivedAt))).run().changes;
}

/** Les listes qu'on peut effacer : rien d'acheté ni de cuisiné à partir d'elles. */
export function deletableLists(db: Db, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  const lists = db.select({ id: shoppingLists.id, status: shoppingLists.status }).from(shoppingLists).where(inArray(shoppingLists.id, ids)).all();
  const bought = new Set(db.select({ id: purchases.listId }).from(purchases).where(inArray(purchases.listId, ids)).all().map((r) => r.id));
  const cooked = new Set(db.select({ id: cookSessions.shoppingListId }).from(cookSessions).where(inArray(cookSessions.shoppingListId, ids)).all().map((r) => r.id));
  return new Set(lists.filter((l) => (l.status === "draft" || l.status === "checked") && !bought.has(l.id) && !cooked.has(l.id)).map((l) => l.id));
}

/** Supprime ce qui peut l'être, archive le reste. */
export function deleteLists(db: Db, ids: string[]): { deleted: number; archived: number } {
  const ok = [...deletableLists(db, ids)];
  const keep = ids.filter((id) => !ok.includes(id));
  db.transaction((tx) => {
    if (ok.length) {
      const items = tx.select({ id: shoppingItems.id }).from(shoppingItems).where(inArray(shoppingItems.listId, ok)).all().map((r) => r.id);
      if (items.length) tx.delete(shoppingItemSources).where(inArray(shoppingItemSources.itemId, items)).run();
      tx.delete(shoppingItems).where(inArray(shoppingItems.listId, ok)).run();
      tx.delete(shoppingLists).where(inArray(shoppingLists.id, ok)).run();
    }
  });
  return { deleted: ok.length, archived: archiveLists(db, keep) };
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { pollLive, startLiveCheck, startShoppingList, swapProduct } from "@/lib/shopping/build";
import { chooseAccepted, refuseItemProduct } from "@/lib/products/list";
import { parseSelection } from "@/lib/week/selection";
import { archiveLists, deleteLists, restoreLists } from "@/lib/shopping/archive";
import { pollDrive, pollOrder, readOrder, sendToDrive } from "@/lib/shopping/drive";
import { changeProduct, searchCatalog, setAllInCart, setInCart, setLinePrice, setPacks, undoOrder, validateOrder, type CatalogChoice } from "@/lib/shopping/cart";

type Result<T = object> = ({ ok: true; message?: string } & T) | { ok: false; message: string };
const fail = (e: unknown): { ok: false; message: string } => ({ ok: false, message: e instanceof Error ? e.message : "Action impossible." });
const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

/** Crée la liste et redirige tout de suite : la page suit la progression des /resolve. */
export async function createList(formData: FormData) {
  // Depuis le Composer : « r » et « x » portent les unités choisies (src/lib/week/selection.ts).
  const sel = parseSelection(String(formData.get("r") ?? formData.get("slugs") ?? ""), String(formData.get("x") ?? ""));
  const id = startShoppingList(db, sel.slugs, { scales: sel.scales, extras: sel.extras });
  revalidatePath("/courses");
  redirect(`/courses/${id}`);
}

export async function checkLive(listId: string): Promise<Result<{ pending: number; asked: number }>> {
  try {
    const r = await startLiveCheck(db, listId);
    revalidatePath(`/courses/${listId}`);
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}

export async function followLive(listId: string): Promise<Result<{ pending: number; checked: number; total: number }>> {
  try {
    const r = await pollLive(db, listId);
    revalidatePath(`/courses/${listId}`);
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}

export async function chooseAlternative(itemId: string, productId: string) {
  const listId = swapProduct(db, itemId, productId);
  revalidatePath(`/courses/${listId}`);
}

export async function toggleCart(itemId: string, on: boolean): Promise<Result> {
  try {
    const listId = setInCart(db, itemId, on);
    revalidatePath(`/courses/${listId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cartAll(listId: string, on: boolean): Promise<Result> {
  try {
    setAllInCart(db, listId, on);
    revalidatePath(`/courses/${listId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function changePacks(itemId: string, packs: number): Promise<Result> {
  try {
    const r = setPacks(db, itemId, packs);
    revalidatePath(`/courses/${r.listId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function searchProducts(q: string): Promise<Result<{ results: CatalogChoice[] }>> {
  try {
    return { ok: true, results: await searchCatalog(q) };
  } catch (e) {
    return fail(e);
  }
}

export async function pickProduct(itemId: string, productId: string, query: string): Promise<Result> {
  try {
    const listId = await changeProduct(db, itemId, productId, query);
    revalidatePath(`/courses/${listId}`);
    return { ok: true, message: "Produit changé, paquets recalculés." };
  } catch (e) {
    return fail(e);
  }
}

export async function validateList(listId: string): Promise<Result> {
  try {
    const r = validateOrder(db, listId);
    revalidatePath(`/courses/${listId}`);
    revalidatePath("/courses");
    revalidatePath("/placard");
    const noPrice = r.unpriced ? ` ${r.unpriced} ligne${r.unpriced > 1 ? "s" : ""} sans prix (hors des coûts).` : "";
    return { ok: true, message: `Commande validée : ${r.purchases} article${r.purchases > 1 ? "s" : ""}, ${eur(r.total)}. Le placard est à jour.${noPrice}` };
  } catch (e) {
    return fail(e);
  }
}

/** Prix payé d'une ligne sans produit du catalogue (saisi en magasin) ; vide = effacé. */
export async function setLinePriceAction(itemId: string, totalEur: number | null): Promise<Result> {
  try {
    const listId = setLinePrice(db, itemId, totalEur);
    revalidatePath(`/courses/${listId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelOrder(listId: string): Promise<Result> {
  try {
    undoOrder(db, listId);
    revalidatePath(`/courses/${listId}`);
    revalidatePath("/placard");
    return { ok: true, message: "Validation annulée." };
  } catch (e) {
    return fail(e);
  }
}

/** Feuille « Changer » : prendre un produit accepté pour l'ingrédient (onglet Produits de la fiche). */
export async function chooseAcceptedProduct(itemId: string, productId: string): Promise<Result> {
  try {
    const listId = chooseAccepted(db, itemId, productId);
    revalidatePath(`/courses/${listId}`);
    return { ok: true, message: "Produit changé, paquets recalculés." };
  } catch (e) {
    return fail(e);
  }
}

/** « Ne correspond pas » : refus pour l'ingrédient dans toutes les recettes, puis le meilleur produit accepté ou proposé. */
export async function refuseItemProductAction(itemId: string): Promise<Result> {
  try {
    const r = refuseItemProduct(db, itemId);
    revalidatePath(`/courses/${r.listId}`);
    return { ok: true, message: r.next ? `Refusé partout. Remplacé par ${r.next}.` : "Refusé partout. Cherche un autre produit." };
  } catch (e) {
    return fail(e);
  }
}

/** Ranger des listes (sélection sur /courses) : archiver, restaurer, supprimer (ce qui a servi est archivé). */
export async function archiveListsAction(ids: string[]): Promise<Result<{ count: number }>> {
  try {
    const count = archiveLists(db, ids);
    revalidatePath("/courses");
    return { ok: true, count, message: count > 1 ? `${count} listes archivées.` : "Liste archivée." };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreListsAction(ids: string[]): Promise<Result<{ count: number }>> {
  try {
    const count = restoreLists(db, ids);
    revalidatePath("/courses");
    for (const id of ids) revalidatePath(`/courses/${id}`);
    return { ok: true, count, message: count > 1 ? `${count} listes restaurées.` : "Liste restaurée." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteListsAction(ids: string[]): Promise<Result<{ deleted: number; archived: number }>> {
  try {
    const r = deleteLists(db, ids);
    revalidatePath("/courses");
    const parts = [r.deleted ? `${r.deleted > 1 ? `${r.deleted} listes supprimées` : "Liste supprimée"}` : null, r.archived ? `${r.archived} déjà commandée${r.archived > 1 ? "s" : ""}, archivée${r.archived > 1 ? "s" : ""} à la place` : null];
    return { ok: true, ...r, message: `${parts.filter(Boolean).join(" · ")}.` };
  } catch (e) {
    return fail(e);
  }
}

/** Bandeau « Liste archivée » de la page d'une liste. */
export async function restoreListForm(formData: FormData) {
  const id = String(formData.get("listId") ?? "");
  restoreLists(db, [id]);
  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
}

// ─── Panier Chronodrive (compte drive, par le worker de chronocatalog : facultatif) ───

export async function sendDrive(listId: string): Promise<Result<{ products: number; packs: number }>> {
  try {
    const r = await sendToDrive(db, listId);
    revalidatePath(`/courses/${listId}`);
    return { ok: true, ...r };
  } catch (e) {
    return fail(e);
  }
}

export async function followDrive(listId: string): Promise<Result<{ status: string | null; summary: Record<string, number> | null }>> {
  try {
    const r = await pollDrive(db, listId);
    if (r.status !== "pending") revalidatePath(`/courses/${listId}`);
    if (r.status === "failed") return { ok: false, message: `Panier : ${r.error ?? "échec"}` };
    return { ok: true, status: r.status, summary: r.summary };
  } catch (e) {
    return fail(e);
  }
}

export async function askOrder(listId: string): Promise<Result> {
  try {
    await readOrder(db, listId);
    revalidatePath(`/courses/${listId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function followOrder(listId: string): Promise<Result<{ status: string | null }>> {
  try {
    const r = await pollOrder(db, listId);
    if (r.status !== "pending") {
      revalidatePath(`/courses/${listId}`);
      revalidatePath("/couts");
    }
    if (r.status === "failed") return { ok: false, message: r.message ?? "Commande non relue." };
    return { ok: true, status: r.status, message: r.message ?? undefined };
  } catch (e) {
    return fail(e);
  }
}

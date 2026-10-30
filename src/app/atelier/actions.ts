"use server";

import { revalidatePath } from "next/cache";
import { AiCapReachedError, monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { proposeCreation, saveDraft, type CreationRequest, type Proposal } from "@/lib/atelier";
import { loadLibrary } from "@/lib/atelier/library";
import { loadAssociations } from "@/lib/products/store";
import { findDuplicate, verifyRecipe } from "@/lib/atelier/verify";
import { resolve, search } from "@/lib/chronocatalog";
import { db } from "@/lib/db/client";
import { RecipeInput } from "@/lib/recipes/format";
import { householdMembers } from "@/lib/eaters/store";
import { cleanUrl, importQuota, proposeImport, quantityIssues, type ImportProposal } from "@/lib/atelier/import";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const budget = () => ({ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() });

function message(e: unknown) {
  if (e instanceof AiCapReachedError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  return m.includes("ANTHROPIC_API_KEY") ? "IA non configurée ici (ANTHROPIC_API_KEY manquante)." : m;
}

export async function proposeCreationAction(
  request: CreationRequest,
  current: unknown
): Promise<Result<{ proposal: Proposal; budget: ReturnType<typeof budget> }>> {
  try {
    const cur = current == null ? null : RecipeInput.parse(current);
    const proposal = await proposeCreation(
      db,
      {
        envie: String(request.envie ?? ""),
        add: (request.add ?? []).map(String).slice(0, 10),
        remove: (request.remove ?? []).map(String).slice(0, 20),
        avoid: (request.avoid ?? []).map(String).slice(0, 5),
      },
      cur
    );
    return { ok: true, proposal, budget: budget() };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

export interface CatalogHit {
  id: string;
  name: string;
  quantityLabel: string | null;
  price: number | null;
  imageUrl: string | null;
  available: boolean;
}

/** Recherche dans le catalogue local de chronocatalog (jamais live). */
export async function searchCatalogAction(q: string): Promise<CatalogHit[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const r = await search(query, { limit: 8 }).catch(() => null);
  return (r?.results ?? []).map((h) => ({
    id: h.productId ?? h.id ?? h.name,
    name: h.name,
    quantityLabel: h.quantityLabel ?? null,
    price: h.promoPriceEur ?? h.currentPrice ?? null,
    imageUrl: h.imageUrl ?? null,
    available: h.availability ? h.availability.status === "available" || h.availability.status === "low_stock" : h.isAvailable !== false,
  }));
}

export async function saveCreationAction(raw: unknown, explanation: string): Promise<Result<{ slug: string }>> {
  const parsed = RecipeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Recette invalide." };
  const library = loadLibrary(db);
  const dup = findDuplicate(parsed.data, library);
  if (dup) return { ok: false, error: `Trop proche de « ${dup.name} » (${dup.why}).` };
  const v = await verifyRecipe({ draft: parsed.data, original: null, library, resolve: (q) => resolve(q, { limit: 5 }), associations: loadAssociations(db) }).catch(() => null);
  if (!v) return { ok: false, error: "Catalogue injoignable : réessaie dans un instant." };
  const slug = saveDraft(db, parsed.data, { origin: "atelier", explanation: explanation.slice(0, 600), unavailable: v.blocked.length > 0 });
  revalidatePath("/recettes");
  return { ok: true, slug };
}

// ─── Importer une recette (texte collé + lien) ───

const importLimits = () => ({ ...importQuota(db), ...budget() });
export type ImportLimits = ReturnType<typeof importLimits>;

export async function proposeImportAction(text: string, url: string): Promise<Result<{ proposal: ImportProposal; limits: ImportLimits }>> {
  try {
    const proposal = await proposeImport(db, { text: String(text ?? "").slice(0, 50_000), url: String(url ?? "") });
    return { ok: true, proposal, limits: importLimits() };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Enregistre l'import « à essayer » : le lien en source, « à relire » si les quantités sont douteuses (revérifiées ici). */
export async function saveImportAction(raw: unknown, url: string | null): Promise<Result<{ slug: string }>> {
  const parsed = RecipeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Recette invalide." };
  let source: string | null;
  try {
    source = cleanUrl(url);
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  const household = householdMembers(db);
  const v = await verifyRecipe({ draft: parsed.data, original: null, library: loadLibrary(db), resolve: (q) => resolve(q, { limit: 5 }), associations: loadAssociations(db), household }).catch(() => null);
  if (!v) return { ok: false, error: "Catalogue injoignable : réessaie dans un instant." };
  const slug = saveDraft(db, parsed.data, { origin: "import", source, review: quantityIssues(parsed.data, household).length > 0, unavailable: v.blocked.length > 0 });
  revalidatePath("/recettes");
  return { ok: true, slug };
}

// Atelier de recettes : « Ajuster » une fiche et créer une recette. L'IA rédige
// (structured(), Sonnet), le code vérifie (catalogue, nutrition, restes, doublons).
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { recipes } from "@/lib/db/schema";
import { familySlugs } from "@/lib/recipes/variants";
import { MODELS, structured } from "@/lib/ai";
import { resolve } from "@/lib/chronocatalog";
import { loadAssociations } from "@/lib/products/store";
import type { RecipeInput } from "@/lib/recipes/format";
import { withPhases } from "@/lib/recipes/phases";
import { equipmentIds, loadLibrary, loadRecipeInput, mainIngredients, promptContext } from "./library";
import { mockAdjust, mockCreate } from "./mock";
import { adjustOptions } from "./options";
import { adjustPrompt, creationPrompt, systemPrompt, type CreationRequest } from "./prompt";
import { AdjustOutput, AtelierOutput, normalizeRecipe } from "./schema";
import { carryYield, diffIngredients, findDuplicate, verifyRecipe, type Resolver, type Verification } from "./verify";
import { queryLine } from "@/lib/shopping/build";
import { householdMembers } from "@/lib/eaters/store";
import { rankLeftovers, type RankedLeftover } from "./leftovers";
import { loadProposal, saveProposal, type Stored } from "./proposals";

export { adjustOptions, type AdjustOption } from "./options";
export type { CreationRequest } from "./prompt";
export type { DiffRow, Leftover, Verification } from "./verify";
export type { LeftoverSuggestion, RankedLeftover } from "./leftovers";
export { clearProposal, loadProposal, type Exchange, type Stored } from "./proposals";

const defaultResolver: Resolver = (q) => resolve(q, { limit: 5 });

// Effort moyen : la recette demande du soin, pas une longue réflexion. 16 000 jetons
// laissent la place à une recette complète (≈ 3 000 à 5 000 jetons) et au raisonnement.
const AI = { model: MODELS.plan, effort: "medium" as const, maxTokens: 16000 };

export interface Proposal {
  draft: RecipeInput;
  explanation: string;
  changes: string[];
  verification: Verification;
  duplicate: { slug: string; name: string; why: string } | null;
}

/** Une variante proposée : restes de paquet classés (une recette de la bibliothèque avant l'atelier). */
export interface AdjustProposal extends Proposal {
  verification: Omit<Verification, "leftovers"> & { leftovers: RankedLeftover[] };
}

/** Étapes réelles d'un ajustement, pour le chargement : la vérification compte les ingrédients passés au catalogue. */
export type AdjustPhase = { phase: "read" } | { phase: "ai" } | { phase: "verify"; done: number; total: number };

export interface AdjustInput {
  optionId?: string;
  text?: string;
  /** Affiner la proposition en cours (sinon on repart de l'originale). */
  refine?: boolean;
}

export async function proposeAdjustment(
  db: Db,
  slug: string,
  input: AdjustInput,
  deps: { resolve?: Resolver; onPhase?: (p: AdjustPhase) => void; base?: { draft: RecipeInput; asks: string[] } | null; leadId?: string | null } = {}
): Promise<AdjustProposal> {
  deps.onPhase?.({ phase: "read" });
  const original = loadRecipeInput(db, slug);
  if (!original) throw new Error("Recette inconnue.");
  const household = householdMembers(db, deps.leadId);
  const option = input.optionId ? adjustOptions(original, household).find((o) => o.id === input.optionId) : null;
  const free = input.text?.trim().slice(0, 600) ?? "";
  if (!option && !free) throw new Error("Choisis une option ou écris ta demande.");
  const base = input.refine && deps.base ? deps.base : null;
  const ask = [option?.instruction, free && `Demande : ${free}`].filter(Boolean).join("\n");
  // Affiner : l'IA part de la proposition en cours, qui garde ses changements.
  const request = base
    ? `Cette recette est déjà une proposition ajustée (demandes précédentes : ${base.asks.map((a) => `« ${a} »`).join(" ; ") || "aucune"}). Garde ses changements et applique en plus :\n${ask}`
    : ask;
  const current = base?.draft ?? original;

  deps.onPhase?.({ phase: "ai" });
  const out = await structured({
    db,
    screen: "ajuster",
    ...AI,
    system: systemPrompt(promptContext(db, deps.leadId)),
    prompt: adjustPrompt(current, request),
    schema: AdjustOutput,
    devMock: () => mockAdjust(current, request),
  });
  const draft = normalizeRecipe(out.recipe, { equipmentIds: equipmentIds(db) });
  const filled = fillPhases(draft);
  draft.servingsUnits = original.servingsUnits; // les parts ne bougent pas : on compare à portion égale
  draft.ingredients = carryYield(original.ingredients, draft.ingredients);

  // Vérification au drive : les mêmes lignes que verifyRecipe (tout sauf le placard inchangé). Un ingrédient compte
  // une fois, à sa première requête (/resolve peut être réessayé avec des noms plus courts).
  const lines = diffIngredients(original.ingredients, draft.ingredients).filter((r) => r.after && !(r.status === "same" && r.after.pantry));
  const firstQueries = new Map(lines.map((r) => [queryLine({ lineRaw: r.after!.lineRaw, item: r.after!.item, grams: r.after!.grams ?? null, units: r.after!.units ?? null }), 0]));
  const total = lines.length;
  let done = 0;
  deps.onPhase?.({ phase: "verify", done, total });
  const res = deps.resolve ?? defaultResolver;
  const counted: Resolver = async (q) => {
    try {
      return await res(q);
    } finally {
      if (firstQueries.has(q)) deps.onPhase?.({ phase: "verify", done: Math.min(total, ++done), total });
    }
  };
  const library = loadLibrary(db);
  const verification = await verifyRecipe({ draft, original, library, resolve: counted, associations: loadAssociations(db), household });
  const recipeId = getRecipeId(db, slug);
  const exclude = recipeId ? familySlugs(db, recipeId) : new Set([slug]);
  exclude.add(draft.slug);
  return {
    draft,
    explanation: out.explanation,
    changes: out.changes,
    verification: { ...verification, warnings: [...filled, ...verification.warnings], leftovers: rankLeftovers(verification.leftovers, library, exclude) },
    duplicate: null,
  };
}

/**
 * Ajustement complet : propose (en affinant la proposition gardée si demandé), puis l'enregistre
 * comme proposition en cours de la recette, avant de répondre (une navigation ne la perd pas).
 */
export async function runAdjustment(
  db: Db,
  slug: string,
  input: AdjustInput & { label: string },
  deps: { resolve?: Resolver; onPhase?: (p: AdjustPhase) => void; leadId?: string | null } = {}
): Promise<Stored<AdjustProposal>> {
  const recipeId = getRecipeId(db, slug);
  if (!recipeId) throw new Error("Recette inconnue.");
  const kept = input.refine ? loadProposal<AdjustProposal>(db, recipeId) : null;
  const base = kept ? { draft: kept.proposal.draft, asks: kept.exchanges.map((e) => e.ask) } : null;
  const proposal = await proposeAdjustment(db, slug, { ...input, refine: Boolean(base) }, { ...deps, base });
  return saveProposal(db, recipeId, proposal, { ask: input.label.slice(0, 200), optionId: input.optionId ?? null, refine: Boolean(base), answer: proposal.explanation });
}

function getRecipeId(db: Db, slug: string) {
  return db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, slug)).get()?.id ?? null;
}

export async function proposeCreation(
  db: Db,
  request: CreationRequest,
  current: RecipeInput | null,
  deps: { resolve?: Resolver; leadId?: string | null } = {}
): Promise<Proposal> {
  const envie = request.envie.trim().slice(0, 600);
  if (!envie && !current) throw new Error("Décris ton envie.");
  const library = loadLibrary(db).filter((r) => r.status !== "archived");
  const run = async (avoid: string[]) => {
    const req = { ...request, envie, avoid };
    const out = await structured({
      db,
      screen: "atelier",
      ...AI,
      system: systemPrompt(promptContext(db, deps.leadId)),
      prompt: creationPrompt({ request: req, library: library.map((r) => ({ name: r.name, main: mainIngredients(r) })), current, household: householdMembers(db, deps.leadId) }),
      schema: AtelierOutput,
      devMock: () => mockCreate(req, current),
    });
    const draft = normalizeRecipe(out.recipe, { equipmentIds: equipmentIds(db) });
    const filled = fillPhases(draft);
    if (current) draft.ingredients = carryYield(current.ingredients, draft.ingredients);
    return { out, draft, filled, duplicate: findDuplicate(draft, library) };
  };
  let res = await run(request.avoid);
  // Un doublon : une seule nouvelle tentative, en nommant la recette à éviter.
  if (res.duplicate && !current) res = await run([...request.avoid, res.duplicate.name]);
  const verification = await verifyRecipe({ draft: res.draft, original: current, library, resolve: deps.resolve ?? defaultResolver, associations: loadAssociations(db), household: householdMembers(db, deps.leadId) });
  return { draft: res.draft, explanation: res.out.explanation, changes: [], verification: { ...verification, warnings: [...res.filled, ...verification.warnings] }, duplicate: res.duplicate };
}

/**
 * Sous-étapes obligatoires : celles que l'IA a oubliées sont découpées par le code dans le texte de
 * l'étape (src/lib/recipes/phases.ts). Rend l'avertissement à montrer, vide si l'IA les a toutes écrites.
 */
function fillPhases(draft: RecipeInput): string[] {
  const { steps, filled } = withPhases(draft.steps);
  draft.steps = steps;
  return filled.length ? [`Sous-étapes écrites par le code (l'IA les a oubliées) pour l'étape${filled.length > 1 ? "s" : ""} ${filled.join(", ")} : relis leurs durées.`] : [];
}

export { loadRecipeInput, saveDraft, VARIANT_SOURCE } from "./library";

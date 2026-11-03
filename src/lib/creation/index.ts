// Créer une recette d'après des recettes publiées : la base et l'IA. Une création (table recipe_creations)
// garde l'envie, la recherche et les propositions ; chaque étape est un appel séparé (l'interface montre
// les sources pendant que les recettes se composent). L'IA propose (structured(), research()), le code
// vérifie tout (core.ts) avant d'afficher, et revérifie avant d'enregistrer dans la bibliothèque.
import { randomUUID } from "crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { equipment, people, recipeCreations, recipeNotes, recipes } from "@/lib/db/schema";
import { MODELS, monthlyCapUsd, research, spentThisMonth, structured } from "@/lib/ai";
import { catalogEnabled, resolve } from "@/lib/chronocatalog";
import { householdMembers } from "@/lib/eaters/store";
import { fitLine, recipeFits } from "@/lib/week/fit";
import { loadAssociations } from "@/lib/products/store";
import type { RecipeInput } from "@/lib/recipes/format";
import { equipmentIds, loadLibrary, mainIngredients, promptContext, saveDraft } from "@/lib/atelier/library";
import { mockAdjust, mockCreate } from "@/lib/atelier/mock";
import { systemPrompt } from "@/lib/atelier/prompt";
import { fillPhases, toAiRecipe } from "@/lib/atelier/schema";
import { findDuplicate, verifyRecipe, type Resolver, type Verification } from "@/lib/atelier/verify";
import {
  BLOCKED_DOMAINS,
  budgetRefusal,
  checkCreation,
  COMPOSE_SCREEN,
  composePrompt,
  envieKey,
  estimateComposeUsd,
  estimateCreationUsd,
  estimateRefineUsd,
  figuresOf,
  keepSources,
  LIMITS,
  normalizeCreation,
  ProposalOut,
  sourceIds,
  RefineOutput,
  refinePrompt,
  RESEARCH_SCREEN,
  ResearchReport,
  researchPrompt,
  researchSystem,
  type CreationRecipe,
  type Defect,
  type Figure,
  type KitchenItem,
  type Research,
  type Source,
  type Taste,
} from "./core";

export * from "./core";

export class CreationRefused extends Error {}

export interface CreationProposal {
  id: string;
  draft: RecipeInput;
  pitch: string;
  /** Ce qui change par rapport aux sources. */
  changes: string[];
  /** Ids des sources dont elle s'inspire (seulement des sources gardées). */
  inspiredBy: string[];
  verification: Verification;
  defects: Defect[];
  figures: Figure[];
  /** Adéquation aux repères, en une ligne (src/lib/week/fit.ts). */
  fit: string;
  asks: { ask: string; answer: string; at: string }[];
  savedSlug: string | null;
}

export interface Creation {
  id: string;
  envie: string;
  research: Research | null;
  /** Vrai si la recherche vient du cache (même envie, déjà cherchée) : rien n'a été payé pour elle. */
  cached: boolean;
  proposals: CreationProposal[];
  costUsd: number;
  updatedAt: string;
}

export interface Deps {
  resolve?: Resolver;
  leadId?: string | null;
  now?: Date;
}

// Effort bas : à effort moyen, le raisonnement doublait la sortie (≈ 15 000 jetons, 0,17 $ la recette, mesuré
// le 03/11/2026) et une sur deux était tronquée. 20 000 jetons : le plus haut sans flux pour le SDK.
const COMPOSE_AI = { model: MODELS.plan, effort: "low" as const, maxTokens: 20000 };

const defaultResolver: Resolver = (q) => resolve(q, { limit: 5 });

// ─── Lectures ───

/** L'équipement de la cuisine, pour vérifier les étapes. */
export function kitchenOf(db: Db): KitchenItem[] {
  return db
    .select({ id: equipment.id, kind: equipment.kind, name: equipment.name, dims: equipment.dimsJson, capacityL: equipment.capacityL })
    .from(equipment)
    .where(eq(equipment.owned, true))
    .all()
    .map((e) => ({ id: e.id, kind: e.kind, name: e.name, capacityL: e.capacityL ?? null, ...(e.dims && "ovenSafe" in e.dims ? { ovenSafe: Number(e.dims.ovenSafe) === 1 } : {}) }));
}

/**
 * Les goûts appris : plats aimés de la bibliothèque, et retours de goût notés sur les fiches (notes « Goût »,
 * avec leur note sur 5). C'est le branchement des retours de goût par recette : ce qui s'y ajoute arrive ici.
 */
export function tasteOf(db: Db): Taste {
  const liked = db.select({ name: recipes.name }).from(recipes).where(eq(recipes.status, "liked")).orderBy(desc(recipes.updatedAt)).limit(20).all().map((r) => r.name);
  const feedback = db
    .select({ recipe: recipes.name, who: people.name, rating: recipeNotes.rating, text: recipeNotes.text })
    .from(recipeNotes)
    .innerJoin(recipes, eq(recipes.id, recipeNotes.recipeId))
    .leftJoin(people, eq(people.id, recipeNotes.personId))
    .where(eq(recipeNotes.category, "taste"))
    .orderBy(desc(recipeNotes.createdAt))
    .limit(15)
    .all()
    .map((f) => ({ recipe: f.recipe, who: f.who ?? null, rating: f.rating ?? null, text: f.text.slice(0, 200) }));
  return { liked, feedback };
}

type Row = typeof recipeCreations.$inferSelect;

const view = (r: Row): Creation => {
  const research = (r.research ?? null) as (Research & { cachedFrom?: string }) | null;
  return { id: r.id, envie: r.envie, research, cached: Boolean(research?.cachedFrom), proposals: (r.proposals ?? []) as CreationProposal[], costUsd: r.costUsd, updatedAt: r.updatedAt };
};

export function loadCreation(db: Db, id: string): Creation | null {
  const r = db.select().from(recipeCreations).where(eq(recipeCreations.id, id)).get();
  return r ? view(r) : null;
}

/** La création à reprendre en revenant sur la page : la plus récente de la semaine qui a des propositions. */
export function latestCreation(db: Db, now = new Date()): Creation | null {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const rows = db.select().from(recipeCreations).where(gte(recipeCreations.updatedAt, since)).orderBy(desc(recipeCreations.updatedAt)).limit(5).all();
  const r = rows.find((x) => ((x.proposals ?? []) as unknown[]).length > 0);
  return r ? view(r) : null;
}

/** « Nouvelle envie » : la création ne revient plus, sa recherche reste en cache. */
export function closeCreation(db: Db, id: string) {
  db.update(recipeCreations).set({ proposals: [], updatedAt: new Date().toISOString() }).where(eq(recipeCreations.id, id)).run();
}

/** Une recherche déjà faite pour la même envie, encore fraîche. */
function cachedResearch(db: Db, key: string, now: Date): Research | null {
  const since = new Date(now.getTime() - LIMITS.researchDays * 86_400_000).toISOString();
  const rows = db.select({ research: recipeCreations.research }).from(recipeCreations).where(and(eq(recipeCreations.envieKey, key), gte(recipeCreations.createdAt, since))).orderBy(desc(recipeCreations.createdAt)).limit(5).all();
  for (const r of rows) {
    const res = r.research as Research | null;
    if (res?.sources?.length) return res;
  }
  return null;
}

function addCost(db: Db, id: string, usd: number) {
  const row = db.select({ c: recipeCreations.costUsd }).from(recipeCreations).where(eq(recipeCreations.id, id)).get();
  db.update(recipeCreations).set({ costUsd: (row?.c ?? 0) + usd }).where(eq(recipeCreations.id, id)).run();
}

function guardBudget(db: Db, estimate: number, now?: Date) {
  const refusal = budgetRefusal(spentThisMonth(db, now), monthlyCapUsd(), estimate);
  if (refusal) throw new CreationRefused(refusal);
}

// ─── 1. Recherche ───

/** Commence une création : la recherche (ou celle du cache pour la même envie), sans proposition encore. */
export async function startCreation(db: Db, envieRaw: string, deps: Deps = {}): Promise<Creation> {
  const envie = envieRaw.replace(/\s+/g, " ").trim().slice(0, 400);
  if (envie.length < 4) throw new CreationRefused("Décris ton envie : un plat, un ingrédient, une façon de cuire.");
  const now = deps.now ?? new Date();
  const key = envieKey(envie);
  const hit = cachedResearch(db, key, now);
  guardBudget(db, estimateCreationUsd(Boolean(hit)), now);
  const id = randomUUID();
  db.insert(recipeCreations).values({ id, envie, envieKey: key, research: null, proposals: [], costUsd: 0 }).run();
  if (hit) {
    db.update(recipeCreations).set({ research: { ...hit, cachedFrom: hit.at } }).where(eq(recipeCreations.id, id)).run();
    return loadCreation(db, id)!;
  }
  const out = await research({
    db,
    screen: RESEARCH_SCREEN,
    model: MODELS.small,
    system: researchSystem(),
    prompt: researchPrompt(envie),
    web: { searches: LIMITS.searches, fetches: LIMITS.fetches, pageTokens: LIMITS.pageTokens, blockedDomains: BLOCKED_DOMAINS, country: "FR" },
    report: { name: "noter_sources", description: "Rendre les recettes publiées trouvées, résumées dans tes mots, avec leur adresse exacte.", schema: ResearchReport },
    effort: "low",
    devMock: () => mockResearch(envie),
    onCost: (usd) => addCost(db, id, usd),
  });
  const kept = keepSources(out.report, out.pages);
  const res: Research = { envie, sources: kept.sources, notes: out.report.notes.slice(0, 400), queries: out.queries.slice(0, 8), dropped: kept.dropped, searches: out.searches, costUsd: out.costUsd, at: now.toISOString() };
  db.update(recipeCreations).set({ research: res, updatedAt: new Date().toISOString() }).where(eq(recipeCreations.id, id)).run();
  return loadCreation(db, id)!;
}

// ─── 2. Composition, retouches ───

/** Une proposition passée au crible : catalogue, nutrition, équipement, quantités, service, doublons. */
export async function assess(
  db: Db,
  draft: RecipeInput,
  deps: Deps & { warnings?: string[] } = {}
): Promise<Pick<CreationProposal, "verification" | "defects" | "figures" | "fit">> {
  const household = householdMembers(db, deps.leadId);
  const library = loadLibrary(db).filter((r) => r.status !== "archived");
  const checked = await verifyRecipe({ draft, original: null, library, resolve: deps.resolve ?? defaultResolver, associations: loadAssociations(db), household });
  // Sans catalogue relié, rien n'est cherché au drive : ni verdict par ingrédient, ni « indisponible » (règle 6).
  const offline = !deps.resolve && !catalogEnabled();
  const verification: Verification = offline ? { ...checked, rows: checked.rows.map((r) => ({ ...r, check: null })), blocked: [], unassociated: [], leftovers: [], warnings: checked.warnings.filter((w) => !/drive associé/.test(w)) } : checked;
  const defects = checkCreation(draft, { kitchen: kitchenOf(db), household, coverage: verification.after.coverage });
  const dup = findDuplicate(draft, library);
  if (dup) defects.unshift({ level: "ko", topic: "bibliothèque", text: `Trop proche de « ${dup.name} », déjà dans tes recettes (${dup.why}).` });
  if (verification.blocked.length) defects.push({ level: "warn", topic: "aliments", text: `Introuvable au drive : ${verification.blocked.join(", ")}. Elle sera marquée « indisponible ».` });
  for (const w of deps.warnings ?? []) defects.push({ level: "warn", topic: "durées", text: w });
  const figures = figuresOf(verification);
  const people = verification.after.people;
  const lead = people[0];
  const fit = lead?.units
    ? fitLine(recipeFits(people.map((m) => ({ id: m.id, name: m.name, baseUnits: m.units, ref: m.ref })), { kcalUnit: lead.macros.kcal / lead.units, proteinUnit: lead.macros.protein / lead.units }))
    : "";
  return { verification, defects, figures, fit };
}

async function toProposal(db: Db, id: string, ai: CreationRecipe, meta: { pitch: string; changes: string[]; inspiredBy: string[] }, sources: Source[], deps: Deps): Promise<CreationProposal> {
  const draft = normalizeCreation(ai, { equipmentIds: equipmentIds(db) });
  const warnings = fillPhases(draft);
  const known = new Set(sources.map((s) => s.id));
  return {
    id,
    draft,
    pitch: meta.pitch.trim().slice(0, 500),
    changes: meta.changes.map((c) => c.trim()).filter(Boolean).slice(0, 8),
    inspiredBy: [...new Set(meta.inspiredBy)].filter((s) => known.has(s)),
    ...(await assess(db, draft, { ...deps, warnings })),
    asks: [],
    savedSlug: null,
  };
}

function saveProposals(db: Db, id: string, proposals: CreationProposal[]) {
  db.update(recipeCreations).set({ proposals, updatedAt: new Date().toISOString() }).where(eq(recipeCreations.id, id)).run();
}

/** Compose les premières propositions (2), ou une de plus (jusqu'à 3), d'après la recherche. */
export async function composeProposals(db: Db, id: string, deps: Deps = {}): Promise<Creation> {
  const c = loadCreation(db, id);
  if (!c?.research) throw new CreationRefused("Création introuvable : recommence par l'envie.");
  const have = c.proposals.length;
  if (have >= LIMITS.max) throw new CreationRefused(`${LIMITS.max} propositions au plus : retouche l'une d'elles, ou repars d'une nouvelle envie.`);
  const count = have ? 1 : LIMITS.first;
  guardBudget(db, estimateComposeUsd(count), deps.now);
  const library = loadLibrary(db).filter((r) => r.status !== "archived");
  const household = householdMembers(db, deps.leadId);
  const system = systemPrompt(promptContext(db, deps.leadId));
  const taste = tasteOf(db);
  const lib = library.map((r) => ({ name: r.name, main: mainIngredients(r) }));
  const avoid = c.proposals.map((p) => p.draft.name);
  // Un appel par proposition, en parallèle ; une qui échoue n'emporte pas l'autre (son erreur est journalisée).
  const outs = await Promise.allSettled(
    Array.from({ length: count }, (_, k) =>
      structured({
        db,
        screen: COMPOSE_SCREEN,
        ...COMPOSE_AI,
        system,
        prompt: composePrompt({ envie: c.envie, sources: c.research!.sources, taste, household, library: lib, slot: have + k, avoid }),
        schema: ProposalOut,
        devMock: () => mockCompose(c.envie, have + k),
        onCost: (usd) => addCost(db, id, usd),
      })
    )
  );
  const ok = outs.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
  if (!ok.length) throw (outs[0] as PromiseRejectedResult).reason;
  const fresh = await Promise.all(ok.map((p, k) => toProposal(db, `p${have + k + 1}`, p.recipe, { ...p, inspiredBy: sourceIds(p.inspiredBy) }, c.research!.sources, deps)));
  saveProposals(db, id, [...c.proposals, ...fresh]);
  return loadCreation(db, id)!;
}

/** Retouche une proposition (« plus de sauce », « sans crème »), ou corrige ses défauts (ask vide, fix). */
export async function refineProposal(db: Db, id: string, proposalId: string, input: { ask: string; fix?: boolean }, deps: Deps = {}): Promise<Creation> {
  const c = loadCreation(db, id);
  const p = c?.proposals.find((x) => x.id === proposalId);
  if (!c || !p) throw new CreationRefused("Proposition introuvable.");
  if (p.savedSlug) throw new CreationRefused("Déjà dans tes recettes : retouche-la depuis sa fiche (Ajuster).");
  if (p.asks.length >= LIMITS.refines) throw new CreationRefused(`${LIMITS.refines} retouches au plus pour une proposition : enregistre-la, ou demande une autre idée.`);
  const ask = input.ask.replace(/\s+/g, " ").trim().slice(0, 300);
  const defects = input.fix ? p.defects : [];
  if (!ask && !defects.length) throw new CreationRefused("Dis ce qu'il faut changer.");
  guardBudget(db, estimateRefineUsd(), deps.now);
  const request = ask || "Corrige les défauts relevés, sans changer l'esprit du plat.";
  const out = await structured({
    db,
    screen: COMPOSE_SCREEN,
    ...COMPOSE_AI,
    system: systemPrompt(promptContext(db, deps.leadId)),
    prompt: refinePrompt({ recipe: p.draft, ask: request, sources: c.research?.sources ?? [], asks: p.asks.map((a) => a.ask), defects }),
    schema: RefineOutput,
    devMock: () => mockRefine(p.draft, request),
    onCost: (usd) => addCost(db, id, usd),
  });
  // Le même nombre d'unités, avant de chiffrer : les parts de chacun restent comparables d'une retouche à l'autre.
  const recipe = { ...out.recipe, servingsUnits: p.draft.servingsUnits };
  const next = await toProposal(db, p.id, recipe, { pitch: p.pitch, changes: out.changes, inspiredBy: p.inspiredBy }, c.research?.sources ?? [], deps);
  next.asks = [...p.asks, { ask: ask || "Corriger les défauts", answer: out.answer.slice(0, 400), at: new Date().toISOString() }];
  saveProposals(db, id, c.proposals.map((x) => (x.id === p.id ? next : x)));
  return loadCreation(db, id)!;
}

// ─── 3. Enregistrement ───

/** Le texte de la source d'une fiche créée : les recettes dont elle s'inspire, avec leur lien. */
export function sourceText(sources: Source[], ids: string[]): string {
  const used = sources.filter((s) => ids.includes(s.id));
  if (!used.length) return "Créée dans l'atelier.";
  return `Créée dans l'atelier, inspirée de : ${used.map((s) => `« ${s.title} » (${s.site}, ${s.url})`).join(" ; ")}.`.slice(0, 1000);
}

/**
 * Enregistre une proposition dans la bibliothèque, « à essayer », après une nouvelle vérification complète :
 * un défaut bloquant (ou un doublon apparu entre-temps) refuse l'enregistrement.
 */
export async function saveCreation(db: Db, id: string, proposalId: string, deps: Deps = {}): Promise<{ slug: string; creation: Creation }> {
  const c = loadCreation(db, id);
  const p = c?.proposals.find((x) => x.id === proposalId);
  if (!c || !p) throw new CreationRefused("Proposition introuvable.");
  if (p.savedSlug) return { slug: p.savedSlug, creation: c };
  const again = await assess(db, p.draft, deps);
  const blocking = again.defects.filter((d) => d.level === "ko");
  if (blocking.length) {
    saveProposals(db, id, c.proposals.map((x) => (x.id === p.id ? { ...x, ...again } : x)));
    throw new CreationRefused(`À corriger avant d'enregistrer : ${blocking.map((d) => d.text).join(" ")}`);
  }
  const slug = saveDraft(db, p.draft, { origin: "atelier", source: sourceText(c.research?.sources ?? [], p.inspiredBy), unavailable: again.verification.blocked.length > 0 });
  saveProposals(db, id, c.proposals.map((x) => (x.id === p.id ? { ...x, ...again, savedSlug: slug } : x)));
  return { slug, creation: loadCreation(db, id)! };
}

// ─── Réponses simulées (MIJOTE_AI_MOCK, jamais en production) ───

function mockResearch(envie: string) {
  const pages = [
    { url: "https://cuisine.exemple.test/poulet-pois-chiches-one-pot", title: "Poulet aux pois chiches en une cocotte", pageAge: null, via: "search" as const },
    { url: "https://blog.exemple.test/curry-pois-chiches-epinards", title: "Curry de pois chiches aux épinards", pageAge: null, via: "search" as const },
    { url: "https://magazine.exemple.test/plaque-four-paprika", title: "Plaque au four paprika et citron", pageAge: null, via: "fetch" as const },
  ];
  const report: ResearchReport = {
    sources: pages.map((p, k) => ({
      url: p.url,
      title: p.title,
      site: new URL(p.url).hostname,
      servings: 4,
      keyIngredients: ["600 g de hauts de cuisse", "400 g de pois chiches", "1 oignon", "paprika fumé"],
      technique: k === 1 ? "Une base d'oignon et d'épices qui compote, puis les pois chiches mijotent dans le lait de coco." : "La viande saisie d'abord, puis tout mijote ensemble à couvert.",
      whyGood: "Des sucs bien pris et une sauce qui nappe.",
      batch: k === 0 ? "Se garde 3 jours, se congèle." : null,
    })),
    notes: `Réponse simulée (MIJOTE_AI_MOCK) pour « ${envie.slice(0, 60)} ».`,
  };
  return { report, pages, queries: [envie.slice(0, 60)] };
}

function mockCompose(envie: string, slot: number): ProposalOut {
  const variants = [envie, `${envie} porc`, `${envie} poulet bis`];
  const base = mockCreate({ envie: variants[slot % 3], add: [], remove: [], avoid: slot > 1 ? ["x"] : [] }, null);
  return { recipe: base.recipe, pitch: "Réponse simulée (MIJOTE_AI_MOCK) : une base fixe, pour tester le parcours sans appeler l'API.", inspiredBy: `s${(slot % 3) + 1}`, changes: ["Four plutôt que cocotte", "Quantités pour le foyer"] };
}

function mockRefine(draft: RecipeInput, ask: string): RefineOutput {
  const out = mockAdjust(draft, ask);
  return { recipe: { ...out.recipe, slug: draft.slug, name: draft.name }, changes: out.changes, answer: out.changes.join(", ") };
}

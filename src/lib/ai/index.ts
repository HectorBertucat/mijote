// Point d'entrée unique de l'IA : tout appel à Claude passe par structured() ou chat().
// Chacun vérifie le plafond, impose un schéma (sortie structurée, ou outils stricts dont le code
// revalide l'entrée) et journalise chaque appel dans ai_calls, réussi ou non.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { assertUnderCap } from "./budget";
import { MOCK_NOTE } from "./durations";
import { costUsd, MODELS, WEB_SEARCH_USD, type ModelId, type Usage } from "./pricing";
import { demoEnabled } from "@/lib/demo/core";

/** En démo, aucun appel à l'IA, même avec une clé : le message montré à qui essaie. */
export const DEMO_NO_AI = "Pas d'IA dans la démo : installe Mijote avec ta clé pour l'essayer.";

export { AiCapReachedError, assertUnderCap, spentThisMonth, monthlyCapUsd } from "./budget";
export { expectedDurationMs } from "./durations";
export { MODELS, WEB_SEARCH_USD } from "./pricing";

type ApiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
};

/** Un évènement du flux (seuls les morceaux de texte nous intéressent en route). */
export interface AiStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
}

/** Le message complet en fin de flux. */
export interface AiFinalMessage {
  usage: ApiUsage;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string; name?: string; input?: unknown }[];
}

/** Ce dont structured() et chat() ont besoin du SDK : messages.parse et messages.stream. Les tests injectent un faux client. */
export interface AiClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{
      usage: ApiUsage;
      stop_reason: string | null;
      stop_details?: { category?: string | null } | null;
      parsed_output?: unknown;
    }>;
    stream?(params: Record<string, unknown>): AsyncIterable<AiStreamEvent> & { finalMessage(): Promise<AiFinalMessage> };
    /** Un appel simple, sans flux ni schéma de sortie (recherche web : outils serveur et outil de rapport). */
    create?(params: Record<string, unknown>): Promise<AiMessage>;
  };
}

/** Un bloc de réponse tel que l'API le rend (texte, appel d'outil, résultat d'un outil serveur). */
export interface AiBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

export interface AiMessage {
  usage: ApiUsage;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
  content: AiBlock[];
}

let client: Anthropic | null = null;
let override: AiClient | null = null;

/** Remplace le client (tests). null rétablit le vrai SDK. */
export function setAiClient(c: AiClient | null) {
  override = c;
}

/** Faux client de dev (MIJOTE_AI_MOCK=1), jamais en production. */
export function aiMockEnabled() {
  return process.env.MIJOTE_AI_MOCK === "1" && process.env.NODE_ENV !== "production" && !demoEnabled();
}

function getClient(): AiClient {
  if (override) return override;
  if (demoEnabled()) throw new Error(DEMO_NO_AI);
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY manquante : la mettre dans .env.local (dev) ou dans le fichier .env de Docker.");
  }
  client ??= new Anthropic();
  return client as unknown as AiClient;
}

function mockClient(make: () => unknown): AiClient {
  return {
    messages: {
      parse: async () => {
        await new Promise((r) => setTimeout(r, 900)); // pour voir l'état « en cours » en dev
        return { usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "end_turn", parsed_output: make() };
      },
    },
  };
}

export interface StructuredCall<S extends z.ZodType> {
  db: Db;
  screen: string; // écran d'origine, pour le suivi du budget
  model?: ModelId;
  system: string; // stable : mis en cache
  prompt: string;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Réponse simulée, utilisée seulement si MIJOTE_AI_MOCK=1 hors production. */
  devMock?: () => z.infer<S>;
  /** Le coût de l'appel, en $, une fois journalisé (réussi ou non). */
  onCost?: (usd: number) => void;
}

/** Ligne de ai_calls, écrite à la fin de l'appel (réussi ou non). */
function logger(db: Db, screen: string, model: ModelId) {
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const t0 = performance.now();
  const take = (u: ApiUsage) => {
    usage.inputTokens = u.input_tokens;
    usage.outputTokens = u.output_tokens;
    usage.cacheReadTokens = u.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens = u.cache_creation_input_tokens ?? 0;
  };
  const log = (ok: boolean, error?: string) =>
    db
      .insert(aiCalls)
      .values({ id: randomUUID(), screen, model, ...usage, costUsd: costUsd(model, usage), ok, error: error ?? null, durationMs: Math.round(performance.now() - t0) })
      .run();
  return { take, log };
}

export async function structured<S extends z.ZodType>(call: StructuredCall<S>): Promise<z.infer<S>> {
  const model = call.model ?? MODELS.plan;
  assertUnderCap(call.db);
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const t0 = performance.now();
  const log = (ok: boolean, error?: string) => {
    const cost = costUsd(model, usage);
    call.db
      .insert(aiCalls)
      .values({
        id: randomUUID(),
        screen: call.screen,
        model,
        ...usage,
        costUsd: cost,
        ok,
        error: error ?? null,
        durationMs: Math.round(performance.now() - t0),
      })
      .run();
    call.onCost?.(cost);
  };

  try {
    const mocked = Boolean(call.devMock && aiMockEnabled() && !override);
    const c = mocked ? mockClient(call.devMock!) : getClient();
    const res = await c.messages.parse({
      model,
      max_tokens: call.maxTokens ?? 16000,
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.prompt }],
      output_config: {
        format: zodOutputFormat(call.schema),
        ...(call.effort ? { effort: call.effort } : {}),
      },
    });
    usage.inputTokens = res.usage.input_tokens;
    usage.outputTokens = res.usage.output_tokens;
    usage.cacheReadTokens = res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens = res.usage.cache_creation_input_tokens ?? 0;
    if (res.stop_reason === "refusal") throw new Error(`refus du modèle (${res.stop_details?.category ?? "?"})`);
    if (res.stop_reason === "max_tokens") throw new Error("réponse tronquée (max_tokens)");
    if (res.parsed_output == null) throw new Error("sortie non conforme au schéma");
    log(true, mocked ? MOCK_NOTE : undefined);
    return res.parsed_output as z.infer<S>;
  } catch (e) {
    log(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ─── Conversation en flux (assistant) ───

/** Un outil proposé au modèle : nom, description, schéma JSON (outil strict). */
export interface ChatTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatCall {
  db: Db;
  screen: string;
  model?: ModelId;
  /** Blocs du system, du plus stable au moins stable : chacun porte un point de cache. */
  system: string[];
  messages: { role: "user" | "assistant"; content: string }[];
  tools: ChatTool[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  /** Chaque morceau de texte, dès qu'il arrive. */
  onText?: (text: string) => void;
  /** Réponse simulée, utilisée seulement si MIJOTE_AI_MOCK=1 hors production. */
  devMock?: () => { text: string; toolCalls: { name: string; input: unknown }[] };
}

export interface ChatResult {
  model: ModelId;
  text: string;
  /** Appels d'outils bruts : le code les revalide (schéma, existence, bornes) avant d'en faire quoi que ce soit. */
  toolCalls: { name: string; input: unknown }[];
}

function mockStream(make: NonNullable<ChatCall["devMock"]>): AiClient {
  return {
    messages: {
      parse: async () => {
        throw new Error("parse non simulé");
      },
      stream: () => {
        const out = make();
        const words = out.text.split(/(?<= )/);
        return {
          async *[Symbol.asyncIterator]() {
            for (const w of words) {
              await new Promise((r) => setTimeout(r, 30));
              yield { type: "content_block_delta", delta: { type: "text_delta", text: w } };
            }
          },
          finalMessage: async () => ({
            usage: { input_tokens: 0, output_tokens: 0 },
            stop_reason: out.toolCalls.length ? "tool_use" : "end_turn",
            content: [{ type: "text", text: out.text }, ...out.toolCalls.map((c) => ({ type: "tool_use", name: c.name, input: c.input }))],
          }),
        };
      },
    },
  };
}

/**
 * Un tour de conversation en flux, avec des outils stricts : le texte arrive morceau par morceau
 * (onText), les appels d'outils à la fin. Plafond vérifié avant, appel journalisé après.
 */
export async function chat(call: ChatCall): Promise<ChatResult> {
  const model = call.model ?? MODELS.small;
  assertUnderCap(call.db);
  const { take, log } = logger(call.db, call.screen, model);
  try {
    const mocked = Boolean(call.devMock && aiMockEnabled() && !override);
    const c = mocked ? mockStream(call.devMock!) : getClient();
    if (!c.messages.stream) throw new Error("client IA sans flux");
    const stream = c.messages.stream({
      model,
      max_tokens: call.maxTokens ?? 4000,
      system: call.system.map((text) => ({ type: "text", text, cache_control: { type: "ephemeral" } })),
      tools: call.tools.map((t) => ({ ...t, strict: true })),
      tool_choice: { type: "auto" },
      messages: call.messages,
      ...(call.effort ? { output_config: { effort: call.effort } } : {}),
    });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) call.onText?.(ev.delta.text);
    }
    const msg = await stream.finalMessage();
    take(msg.usage);
    if (msg.stop_reason === "refusal") throw new Error(`refus du modèle (${msg.stop_details?.category ?? "?"})`);
    if (msg.stop_reason === "max_tokens") throw new Error("réponse tronquée (max_tokens)");
    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const toolCalls = msg.content.filter((b) => b.type === "tool_use" && b.name).map((b) => ({ name: b.name!, input: b.input }));
    log(true, mocked ? MOCK_NOTE : undefined);
    return { model, text, toolCalls };
  } catch (e) {
    log(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ─── Recherche web (outils serveur) ───

/** Les bornes de la recherche : nombre de recherches et de pages lues, taille d'une page lue. */
export interface WebLimits {
  searches: number;
  fetches: number;
  /** Jetons gardés d'une page lue, au plus (le reste est tronqué par l'API). */
  pageTokens: number;
  /** Domaines jamais cherchés ni lus (réseaux sociaux illisibles, par exemple). */
  blockedDomains?: string[];
  /** Pays des résultats (code ISO), pour des recettes d'ici. */
  country?: string;
}

/** Une page vue pendant la recherche : renvoyée par l'API, jamais écrite par le modèle. */
export interface WebPage {
  url: string;
  title: string | null;
  pageAge: string | null;
  via: "search" | "fetch";
}

export interface ResearchCall<S extends z.ZodType> {
  db: Db;
  screen: string;
  model?: ModelId;
  system: string;
  prompt: string;
  web: WebLimits;
  /** L'outil strict par lequel le modèle rend ce qu'il a trouvé ; le code revalide son entrée. */
  report: { name: string; description: string; schema: S };
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  devMock?: () => { report: z.infer<S>; pages: WebPage[]; queries: string[] };
  onCost?: (usd: number) => void;
}

export interface ResearchResult<T> {
  report: T;
  /** Les pages que l'API a vraiment renvoyées (recherches et lectures), dans l'ordre. */
  pages: WebPage[];
  queries: string[];
  searches: number;
  costUsd: number;
}

/** Tours au plus : la reprise d'un tour en pause (pause_turn) et une relance si le rapport manque. */
const RESEARCH_TURNS = 4;

/** Les pages et requêtes d'une réponse : blocs server_tool_use, web_search_tool_result, web_fetch_tool_result. */
export function webPagesOf(content: AiBlock[]): { pages: WebPage[]; queries: string[] } {
  const pages: WebPage[] = [];
  const queries: string[] = [];
  for (const b of content) {
    if (b.type === "server_tool_use" && b.name === "web_search") {
      const q = (b.input as { query?: unknown } | null)?.query;
      if (typeof q === "string") queries.push(q);
    }
    // Une erreur d'outil serveur arrive comme un objet (pas une liste) : rien à garder.
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type?: string; url?: unknown; title?: unknown; page_age?: unknown }[])
        if (r?.type === "web_search_result" && typeof r.url === "string")
          pages.push({ url: r.url, title: typeof r.title === "string" ? r.title : null, pageAge: typeof r.page_age === "string" ? r.page_age : null, via: "search" });
    }
    if (b.type === "web_fetch_tool_result") {
      const r = b.content as { type?: string; url?: unknown; content?: { title?: unknown } } | null;
      if (r?.type === "web_fetch_result" && typeof r.url === "string")
        pages.push({ url: r.url, title: typeof r.content?.title === "string" ? r.content.title : null, pageAge: null, via: "fetch" });
    }
  }
  return { pages, queries };
}

/**
 * Une recherche sur le web, bornée : recherches (web_search) et pages lues (web_fetch) en nombre fixé, puis
 * un rapport par un outil strict (jamais exécuté : son entrée est revalidée par le schéma). Un tour en pause
 * (pause_turn) reprend ; un modèle qui s'arrête sans rapporter est relancé une fois. Plafond vérifié avant,
 * une ligne dans ai_calls après, coût des recherches compris (10 $ les 1 000).
 */
export async function research<S extends z.ZodType>(call: ResearchCall<S>): Promise<ResearchResult<z.infer<S>>> {
  const model = call.model ?? MODELS.small;
  assertUnderCap(call.db);
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let searches = 0;
  const t0 = performance.now();
  const log = (ok: boolean, error?: string) => {
    const cost = costUsd(model, usage) + searches * WEB_SEARCH_USD;
    call.db
      .insert(aiCalls)
      .values({ id: randomUUID(), screen: call.screen, model, ...usage, costUsd: cost, ok, error: error ?? null, durationMs: Math.round(performance.now() - t0) })
      .run();
    call.onCost?.(cost);
    return cost;
  };
  try {
    if (call.devMock && aiMockEnabled() && !override) {
      await new Promise((r) => setTimeout(r, 900));
      const out = call.devMock();
      log(true, MOCK_NOTE);
      return { ...out, searches: 0, costUsd: 0 };
    }
    const c = getClient();
    if (!c.messages.create) throw new Error("client IA sans appel simple");
    const { $schema: _s, ...input_schema } = z.toJSONSchema(call.report.schema) as Record<string, unknown>;
    const w = call.web;
    const tools = (searchesLeft: number) => [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: Math.max(1, searchesLeft),
        ...(w.blockedDomains?.length ? { blocked_domains: w.blockedDomains } : {}),
        ...(w.country ? { user_location: { type: "approximate", country: w.country } } : {}),
      },
      { type: "web_fetch_20250910", name: "web_fetch", max_uses: Math.max(1, w.fetches), max_content_tokens: w.pageTokens, ...(w.blockedDomains?.length ? { blocked_domains: w.blockedDomains } : {}) },
      { name: call.report.name, description: call.report.description, input_schema, strict: true },
    ];
    const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: call.prompt }];
    const pages: WebPage[] = [];
    const queries: string[] = [];
    let nudged = false;
    for (let turn = 0; turn < RESEARCH_TURNS; turn++) {
      const res = await c.messages.create({
        model,
        max_tokens: call.maxTokens ?? 8000,
        system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
        messages,
        tools: tools(w.searches - searches),
        tool_choice: { type: "auto" },
        ...(call.effort ? { output_config: { effort: call.effort } } : {}),
      });
      usage.inputTokens += res.usage.input_tokens;
      usage.outputTokens += res.usage.output_tokens;
      usage.cacheReadTokens += res.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += res.usage.cache_creation_input_tokens ?? 0;
      const seen = webPagesOf(res.content);
      pages.push(...seen.pages);
      queries.push(...seen.queries);
      searches += res.usage.server_tool_use?.web_search_requests ?? seen.queries.length;
      if (res.stop_reason === "refusal") throw new Error(`refus du modèle (${res.stop_details?.category ?? "?"})`);
      if (res.stop_reason === "max_tokens") throw new Error("réponse tronquée (max_tokens)");
      const reported = res.content.find((b) => b.type === "tool_use" && b.name === call.report.name);
      if (reported) {
        const parsed = call.report.schema.safeParse(reported.input);
        if (!parsed.success) throw new Error("rapport de recherche non conforme au schéma");
        const costUsd = log(true);
        return { report: parsed.data, pages, queries, searches, costUsd };
      }
      messages.push({ role: "assistant", content: res.content });
      // En pause : l'API reprend d'elle-même quand on renvoie le tour tel quel, sans message en plus.
      if (res.stop_reason === "pause_turn") continue;
      if (nudged) break;
      nudged = true;
      messages.push({ role: "user", content: `Appelle maintenant l'outil ${call.report.name} avec ce que tu as trouvé, sans chercher davantage.` });
    }
    throw new Error("la recherche n'a rien rapporté");
  } catch (e) {
    log(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** L'assistant n'existe que si l'IA est configurée (clé, ou faux client de dev). */
export const aiEnabled = () => !demoEnabled() && (Boolean(process.env.ANTHROPIC_API_KEY) || aiMockEnabled());

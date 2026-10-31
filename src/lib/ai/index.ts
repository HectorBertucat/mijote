// Point d'entrée unique de l'IA : tout appel à Claude passe par structured() ou chat().
// Chacun vérifie le plafond, impose un schéma (sortie structurée, ou outils stricts dont le code
// revalide l'entrée) et journalise chaque appel dans ai_calls, réussi ou non.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { randomUUID } from "crypto";
import type { z } from "zod";
import type { Db } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { assertUnderCap } from "./budget";
import { MOCK_NOTE } from "./durations";
import { costUsd, MODELS, type ModelId, type Usage } from "./pricing";
import { demoEnabled } from "@/lib/demo/core";

/** En démo, aucun appel à l'IA, même avec une clé : le message montré à qui essaie. */
export const DEMO_NO_AI = "Pas d'IA dans la démo : installe Mijote avec ta clé pour l'essayer.";

export { AiCapReachedError, assertUnderCap, spentThisMonth, monthlyCapUsd } from "./budget";
export { expectedDurationMs } from "./durations";
export { MODELS } from "./pricing";

type ApiUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

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
  };
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
  const log = (ok: boolean, error?: string) =>
    call.db
      .insert(aiCalls)
      .values({
        id: randomUUID(),
        screen: call.screen,
        model,
        ...usage,
        costUsd: costUsd(model, usage),
        ok,
        error: error ?? null,
        durationMs: Math.round(performance.now() - t0),
      })
      .run();

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

/** L'assistant n'existe que si l'IA est configurée (clé, ou faux client de dev). */
export const aiEnabled = () => !demoEnabled() && (Boolean(process.env.ANTHROPIC_API_KEY) || aiMockEnabled());

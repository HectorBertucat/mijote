// Point d'entrée unique de l'IA : tout appel à Claude passe par structured().
// Il vérifie le plafond, impose un schéma de sortie (structured outputs) et
// journalise chaque appel dans ai_calls, réussi ou non.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { randomUUID } from "crypto";
import type { z } from "zod";
import type { Db } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { assertUnderCap } from "./budget";
import { MOCK_NOTE } from "./durations";
import { costUsd, MODELS, type ModelId, type Usage } from "./pricing";

export { AiCapReachedError, assertUnderCap, spentThisMonth, monthlyCapUsd } from "./budget";
export { expectedDurationMs } from "./durations";
export { MODELS } from "./pricing";

/** Ce dont structured() a besoin du SDK : messages.parse. Les tests injectent un faux client. */
export interface AiClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<{
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
      stop_reason: string | null;
      stop_details?: { category?: string | null } | null;
      parsed_output?: unknown;
    }>;
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
  return process.env.MIJOTE_AI_MOCK === "1" && process.env.NODE_ENV !== "production";
}

function getClient(): AiClient {
  if (override) return override;
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

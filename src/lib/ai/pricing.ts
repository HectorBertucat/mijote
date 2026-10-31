// Prix en $ par million de jetons (skill claude-api, tableau du 2026-10-06).
// Écriture du cache = 1,25 × l'entrée (TTL 5 min).
export const MODELS = {
  plan: "claude-sonnet-5-5", // planifier, créer ou adapter une recette
  small: "claude-haiku-5-5", // petites tâches : ranger une note, l'assistant au quotidien
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

const PRICES: Record<ModelId, { input: number; output: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  // Haiku 5.5 : prix jusqu'à 100K jetons d'entrée ; lecture du cache estimée à 10 % de l'entrée.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(model: ModelId, u: Usage): number {
  const p = PRICES[model];
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * p.cacheRead +
      u.cacheWriteTokens * p.input * 1.25) /
    1_000_000
  );
}

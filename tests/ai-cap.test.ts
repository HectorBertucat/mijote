// Le plafond mensuel bloque l'appel avant tout accès réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { openDb } from "@/lib/db/open";
import { aiCalls } from "@/lib/db/schema";
import { AiCapReachedError, assertUnderCap, structured } from "@/lib/ai";

test("le plafond bloque une fois atteint, et seulement pour le mois en cours", async () => {
  const { db } = openDb(":memory:");
  process.env.AI_MONTHLY_CAP_USD = "1";
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();

  db.insert(aiCalls).values({ id: "old", at: lastMonth, screen: "test", model: "claude-sonnet-5-5", costUsd: 5, ok: true }).run();
  assert.doesNotThrow(() => assertUnderCap(db)); // le mois dernier ne compte pas

  db.insert(aiCalls).values({ id: "a", screen: "test", model: "claude-sonnet-5-5", costUsd: 0.6, ok: true }).run();
  assert.doesNotThrow(() => assertUnderCap(db));
  db.insert(aiCalls).values({ id: "b", screen: "test", model: "claude-sonnet-5-5", costUsd: 0.4, ok: true }).run();
  assert.throws(() => assertUnderCap(db), AiCapReachedError);

  // structured() refuse avant d'appeler le SDK, même sans clé, et ne journalise rien.
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(
    structured({ db, screen: "test", system: "s", prompt: "p", schema: z.object({ ok: z.boolean() }) }),
    AiCapReachedError
  );
  assert.equal(db.select().from(aiCalls).all().length, 3);
});

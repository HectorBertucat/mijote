// Le traitement de /api/sante/import/plans (contrat de l'app, v2.1), sans Next : la route lui passe la base,
// les en-têtes et le corps brut ; les tests aussi. Même clé que l'import (X-Mijote-Key), même chemin ouvert
// dans src/lib/auth.ts, donc même règle Cloudflare Access. 404 en démo.
//   GET  → { ok, plans: [{ id, version, date, time?, title, workout, notes }], removed: [id] } : J à J+7.
//   POST → l'accusé de l'app ({ scheduled, failed, removed, scheduler }) → { ok: true }.
import type { Db } from "@/lib/db/open";
import { demoEnabled } from "@/lib/demo/core";
import { byKey, tooLarge, type ApiReply } from "@/lib/health/import-api";
import { MAX_BYTES } from "@/lib/health/ingest-v2";
import { ackPlans, watchPlans } from "./store";

const fail = (error: string, status: number): ApiReply => ({ status, body: { ok: false, error } });
const demo = () => fail("pas de montre dans la démo", 404);

export function plansGet(db: Db, headers: Headers, now = new Date()): ApiReply {
  if (demoEnabled()) return demo();
  const k = byKey(db, headers);
  if (!k.link) return k.error;
  return { status: 200, body: { ok: true, ...watchPlans(db, k.link.personId, now) } };
}

export function plansPost(db: Db, headers: Headers, raw: string, now = new Date()): ApiReply {
  if (demoEnabled()) return demo();
  const k = byKey(db, headers);
  if (!k.link) return k.error;
  if (tooLarge(headers) || Buffer.byteLength(raw) > MAX_BYTES) return fail("accusé trop gros : 1 Mo au plus", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("corps JSON illisible", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("objet JSON attendu", 400);
  const r = ackPlans(db, k.link.personId, body, now);
  return r.ok ? { status: 200, body: { ok: true } } : fail(r.error, 400);
}

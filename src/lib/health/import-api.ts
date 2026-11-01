// Le traitement de /api/sante/import, sans Next : la route (src/app/api/sante/import/route.ts) lui passe la
// base, les en-têtes et le corps brut ; les tests aussi. Réponses : { status, body } en JSON.
//   GET  → { person, lastSyncAt, v2: true, features, history?: "all" } pour l'app ; { mode, window } pour le Raccourci.
//   POST → v2 (`version: 2`) : échantillons, totaux du jour, séances (et leur détail, v2.1), sommeil,
//          suppressions, par paquets ;
//          v1 : pesées, pas, énergie active et séances de la fenêtre (ancien Raccourci, export de Santé).
import type { Db } from "@/lib/db/open";
import { ImportPayload, ingest } from "./ingest";
import { MAX_BYTES, MAX_ITEMS, countItems, ingestV2, parseV2 } from "./ingest-v2";
import { WINDOWS, getLink, linkForKey, markSynced, markSyncedV2, syncWindow } from "./link";
import { getPerson } from "./store";

export interface ApiReply {
  status: number;
  body: Record<string, unknown>;
}

const fail = (error: string, status: number): ApiReply => ({ status, body: { ok: false, error } });
const ok = (body: Record<string, unknown>): ApiReply => ({ status: 200, body: { ok: true, ...body } });

/** La clé de la personne : X-Mijote-Key, ou X-Cuisine-Key (ancien nom, celui du Raccourci). */
export function keyOf(headers: Headers) {
  return (headers.get("x-mijote-key") ?? headers.get("x-cuisine-key"))?.trim() || null;
}

/** Corps annoncé trop gros : la route ne le lit même pas. */
export const tooLarge = (headers: Headers) => Number(headers.get("content-length") ?? 0) > MAX_BYTES;

/** La personne de la clé, ou la réponse 401 (aussi pour /api/sante/import/plans). */
export function byKey(db: Db, headers: Headers) {
  const key = keyOf(headers);
  const link = key ? linkForKey(db, key) : null;
  return link ? { link } : { error: fail(key ? "clé inconnue : recopie le code depuis Santé › Apple Santé" : "clé manquante", 401) };
}

export function importGet(db: Db, headers: Headers, now = new Date()): ApiReply {
  const k = byKey(db, headers);
  if (!k.link) return k.error;
  const { link } = k;
  const window = syncWindow(link, now);
  return ok({
    person: getPerson(db, link.personId)?.name ?? link.personId,
    mode: window === WINDOWS.history ? "history" : window === WINDOWS.month ? "month" : "week",
    window,
    lastSyncAt: link.lastSyncAt,
    v2: true,
    // v2.1 : le détail des séances et les séances planifiées vers la montre (/api/sante/import/plans).
    // app_v1 : l'API de l'app (Santé, journal, course, sport en natif), docs/api-app.md.
    features: ["workout_details", "plans", "app_v1"],
    // Tant que l'app n'a pas envoyé tout l'historique (ou après « Tout renvoyer »).
    ...(link.historyCompleteAt ? {} : { history: "all" }),
  });
}

export function importPost(db: Db, headers: Headers, raw: string, now = new Date()): ApiReply {
  const k = byKey(db, headers);
  if (!k.link) return k.error;
  const { link } = k;
  const tooBig = fail(`paquet trop gros : 1 Mo et ${MAX_ITEMS} éléments au plus`, 413);
  if (tooLarge(headers) || Buffer.byteLength(raw) > MAX_BYTES) return tooBig;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(`corps JSON illisible : ${raw.slice(0, 160)}`, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("objet JSON attendu", 400);
  const version = (body as { version?: unknown }).version;

  if (version === 2) {
    if (countItems(body) > MAX_ITEMS) return tooBig;
    const parsed = parseV2(body, now);
    if ("error" in parsed) return fail(parsed.error, 400);
    const result = ingestV2(db, link.personId, parsed);
    if (parsed.last) markSyncedV2(db, link.personId, parsed.historyComplete, now);
    return ok({ ...result });
  }
  if (version != null && version !== 1) return fail(`version ${String(version)} inconnue : 1 ou 2 attendue`, 400);

  const parsed = ImportPayload.safeParse({ ...body, person: link.personId });
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "), 400);
  const person = getPerson(db, parsed.data.person);
  if (!person) return fail(`profil inconnu : ${parsed.data.person}`, 400);
  const result = ingest(db, { ...parsed.data, person: person.id });
  if (getLink(db, person.id)) markSynced(db, person.id, parsed.data.window ?? 7, now);
  return ok({ person: person.name, ...result });
}

// Raccourci iOS « Santé → Mijote » (docs/sante.md), installé depuis /sante/apple. Ce chemin est ouvert sans
// le mot de passe de l'instance (src/lib/auth.ts) : il exige la clé secrète de la personne (en-tête
// X-Mijote-Key, recopiée dans le code d'installation), et rien d'autre ne passe. Derrière Cloudflare Access,
// le Raccourci envoie aussi le jeton de service.
//   GET  → { mode, window } : combien de jours le Raccourci doit relire (180 la première fois, puis 35 ou 7).
//   POST → les pesées, pas et séances de cette fenêtre.
import { db } from "@/lib/db/client";
import { ImportPayload, ingest } from "@/lib/health/ingest";
import { WINDOWS, getLink, linkForKey, markSynced, syncWindow } from "@/lib/health/link";
import { getPerson } from "@/lib/health/store";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status });

function byKey(req: Request) {
  const key = req.headers.get("x-mijote-key")?.trim();
  return key ? { link: linkForKey(db, key), given: true } : { link: null, given: false };
}

export async function GET(req: Request) {
  const { link, given } = byKey(req);
  if (!link) return fail(given ? "clé inconnue : recopie le code depuis Santé › Apple Santé" : "clé manquante", 401);
  const person = getPerson(db, link.personId);
  const window = syncWindow(link, new Date());
  const mode = window === WINDOWS.history ? "history" : window === WINDOWS.month ? "month" : "week";
  return Response.json({ ok: true, person: person?.name ?? link.personId, mode, window });
}

export async function POST(req: Request) {
  const { link, given } = byKey(req);
  if (!link) return fail(given ? "clé inconnue : recopie le code depuis Santé › Apple Santé" : "clé manquante", 401);
  let body: unknown;
  const raw = await req.text();
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(`corps JSON illisible : ${raw.slice(0, 160)}`, 400);
  }
  if (body && typeof body === "object") body = { ...body, person: link.personId };
  const parsed = ImportPayload.safeParse(body);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "), 400);
  const person = getPerson(db, parsed.data.person.toLowerCase());
  if (!person) return fail(`profil inconnu : ${parsed.data.person}`, 400);
  const result = ingest(db, { ...parsed.data, person: person.id });
  if (getLink(db, person.id)) markSynced(db, person.id, parsed.data.window ?? 7);
  return Response.json({ ok: true, person: person.name, ...result });
}

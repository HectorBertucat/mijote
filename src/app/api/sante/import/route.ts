// Apple Santé → Mijote : l'app Mijote Santé de l'iPhone (format v2, docs/sante.md), et l'ancien Raccourci
// iOS (format v1, gardé pour ceux déjà installés). Ce chemin est ouvert sans le mot de passe de l'instance
// (src/lib/auth.ts) : il exige la clé secrète de la personne (en-tête X-Mijote-Key, recopiée dans le code
// d'installation ; X-Cuisine-Key, son ancien nom, est encore lu), et rien d'autre ne passe. Derrière
// Cloudflare Access, l'app envoie aussi le jeton de service. Le traitement : src/lib/health/import-api.ts.
import { db } from "@/lib/db/client";
import { importGet, importPost, tooLarge, type ApiReply } from "@/lib/health/import-api";
import { demoEnabled } from "@/lib/demo/core";

export const dynamic = "force-dynamic";

const send = (r: ApiReply) => Response.json(r.body, { status: r.status });
const demo = () => Response.json({ ok: false, error: "pas d’import dans la démo" }, { status: 404 });

export async function GET(req: Request) {
  if (demoEnabled()) return demo();
  return send(importGet(db, req.headers));
}

export async function POST(req: Request) {
  if (demoEnabled()) return demo();
  // Un corps annoncé trop gros n'est pas lu : importPost répond 413 (après la clé).
  return send(importPost(db, req.headers, tooLarge(req.headers) ? "" : await req.text()));
}

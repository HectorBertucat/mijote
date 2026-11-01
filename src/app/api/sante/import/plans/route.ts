// Les séances de course planifiées vers la montre (contrat de l'app, v2.1) : GET les séances à programmer,
// POST l'accusé. Sous /api/sante/import : même clé, même chemin ouvert sans le mot de passe de l'instance
// (src/lib/auth.ts), même règle Cloudflare Access. Le traitement : src/lib/running/watch-api.ts.
import { db } from "@/lib/db/client";
import { tooLarge, type ApiReply } from "@/lib/health/import-api";
import { plansGet, plansPost } from "@/lib/running/watch-api";

export const dynamic = "force-dynamic";

const send = (r: ApiReply) => Response.json(r.body, { status: r.status });

export async function GET(req: Request) {
  return send(plansGet(db, req.headers));
}

export async function POST(req: Request) {
  return send(plansPost(db, req.headers, tooLarge(req.headers) ? "" : await req.text()));
}

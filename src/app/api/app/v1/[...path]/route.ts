// API de l'app iPhone (Mijote Santé) : Santé, journal, course, sport et séance guidée en natif. Ouverte sans le
// mot de passe de l'instance (src/lib/auth.ts) mais seulement avec la clé de la personne (X-Mijote-Key),
// comme l'import. Le traitement : src/lib/app-api/core.ts ; le contrat : docs/api-app.md.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { appApi } from "@/lib/app-api/core";
import { demoEnabled } from "@/lib/demo/core";
import { getLive } from "@/lib/training/live-store";

/** Attente longue : `GET sport/seance/<id>?since=<revision>` répond dès que la séance change, ou au bout de 25 s. */
async function waitFor(id: string, since: number, signal: AbortSignal) {
  const end = Date.now() + 25_000;
  while (Date.now() < end && !signal.aborted) {
    const row = getLive(db, id);
    if (!row || row.ended || row.version > since) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Ctx, method: "GET" | "POST") {
  if (demoEnabled()) return Response.json({ ok: false, error: "pas d’app dans la démo" }, { status: 404 });
  const { path } = await params;
  const body = method === "POST" ? await req.json().catch(() => null) : null;
  const query = new URL(req.url).searchParams;
  const since = Number(query.get("since"));
  // La clé est vérifiée par appApi avant toute réponse ; l'attente ne lit que le numéro de version.
  if (method === "GET" && path[0] === "sport" && path[1] === "seance" && path[2] && !path[3] && query.has("since") && Number.isInteger(since)) await waitFor(path[2], since, req.signal);
  const r = appApi(db, { method, path, query, body, headers: req.headers });
  // Une écriture de l'app se voit aussi sur le site.
  if (method === "POST" && r.status === 200) revalidatePath("/sante", "layout");
  return Response.json(r.body, { status: r.status });
}

export const GET = (req: Request, ctx: Ctx) => handle(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx, "POST");

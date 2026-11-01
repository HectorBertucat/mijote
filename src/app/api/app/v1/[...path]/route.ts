// API de l'app iPhone (Mijote Santé) : Santé, journal, course, sport et séance guidée en natif. Ouverte sans le
// mot de passe de l'instance (src/lib/auth.ts) mais seulement avec la clé de la personne (X-Mijote-Key),
// comme l'import. Le traitement : src/lib/app-api/core.ts ; le contrat : docs/api-app.md.
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { appApi } from "@/lib/app-api/core";
import { demoEnabled } from "@/lib/demo/core";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Ctx, method: "GET" | "POST") {
  if (demoEnabled()) return Response.json({ ok: false, error: "pas d’app dans la démo" }, { status: 404 });
  const { path } = await params;
  const body = method === "POST" ? await req.json().catch(() => null) : null;
  const r = appApi(db, { method, path, query: new URL(req.url).searchParams, body, headers: req.headers });
  // Une écriture de l'app se voit aussi sur le site.
  if (method === "POST" && r.status === 200) revalidatePath("/sante", "layout");
  return Response.json(r.body, { status: r.status });
}

export const GET = (req: Request, ctx: Ctx) => handle(req, ctx, "GET");
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx, "POST");

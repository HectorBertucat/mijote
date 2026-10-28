// Une séance partagée : lire l'état, écrire un nouvel état (avec la version qu'on croyait à jour),
// ou la terminer (enregistrer dans le carnet, ou abandonner).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { endLive, getLive, writeLive } from "@/lib/training/live-store";
import type { Live } from "@/lib/training/live";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const row = getLive(db, (await params).id);
  if (!row) return Response.json({ ok: false, error: "séance inconnue" }, { status: 404 });
  return Response.json({ ok: true, ...row, now: Date.now() });
}

const Step = z.object({ k: z.string() }).passthrough();
const LiveSchema = z.object({
  program: z.string().max(40),
  type: z.string().max(10),
  steps: z.array(Step).max(200),
  i: z.number().int().min(0),
  t0: z.number(),
  log: z.record(z.string(), z.array(z.number().nullable()).max(20)),
  levels: z.record(z.string(), z.number().int().min(0).max(20)),
  cur: z.object({ reps: z.number().optional(), guide: z.number().optional(), restEnd: z.number().optional(), emom: z.number().optional() }),
  pair: z.string().max(60).optional(),
});
const Body = z.union([z.object({ expect: z.number().int(), live: LiveSchema }), z.object({ finish: z.object({ note: z.string().max(2000) }) }), z.object({ abandon: z.literal(true) })]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const b = parsed.data;
  if ("live" in b) {
    const { ok, row } = writeLive(db, id, b.expect, b.live as unknown as Live);
    if (!row) return Response.json({ ok: false, error: "séance inconnue" }, { status: 404 });
    return Response.json({ ok, ...row, now: Date.now() }, { status: ok ? 200 : 409 });
  }
  const r = endLive(db, id, "finish" in b ? b.finish : null);
  if (r.ok) revalidatePath("/sante/entrainement");
  return Response.json(r, { status: r.ok ? 200 : 400 });
}

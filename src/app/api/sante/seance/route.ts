// Lancer une séance partagée entre les écrans (MacBook + téléphones), seul ou à deux.
import { z } from "zod";
import { db } from "@/lib/db/client";
import { createDuo, createLive } from "@/lib/training/live-store";

export const dynamic = "force-dynamic";

const One = z.object({ personId: z.string().min(1).max(40), programId: z.string().min(1).max(40), type: z.string().min(1).max(10) });
const Body = z.union([One, z.object({ duo: z.tuple([One, One]) })]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const d = parsed.data;
  if ("duo" in d) {
    const rows = createDuo(db, d.duo[0], d.duo[1]);
    if (!rows) return Response.json({ ok: false, error: "programmes ou séances inconnus" }, { status: 400 });
    return Response.json({ ok: true, rows, now: Date.now() });
  }
  const row = createLive(db, d.personId, d.programId, d.type);
  if (!row) return Response.json({ ok: false, error: "programme ou séance inconnus" }, { status: 400 });
  return Response.json({ ok: true, ...row, now: Date.now() });
}

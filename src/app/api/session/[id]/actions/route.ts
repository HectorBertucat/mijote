// Une action d'un écran (étape lancée, bol prêt, minuteur…) : ajoutée au journal, puis
// poussée aux autres écrans par le flux SSE.
import { z } from "zod";
import { db } from "@/lib/db/client";
import { addEvent, getSession } from "@/lib/session/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  id: z.string().min(8).max(80).optional(),
  kind: z.enum(["step_start", "step_done", "bowl_ready", "timer_start", "timer_done", "note"]),
  ref: z.string().max(200).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSession(db, id)) return Response.json({ ok: false, error: "session inconnue" }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const event = addEvent(db, id, parsed.data);
  return Response.json({ ok: true, event, now: Date.now() });
}

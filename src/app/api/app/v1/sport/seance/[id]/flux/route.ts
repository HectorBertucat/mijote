// Flux SSE d'une séance pour l'app iPhone : comme /api/sante/seance/[id]/events, mais avec la clé de la
// personne (X-Mijote-Key) et la vue calculée (liveView). Un événement `hello` donne l'heure du serveur.
import { db } from "@/lib/db/client";
import { liveView } from "@/lib/app-api/core";
import { byKey } from "@/lib/health/import-api";
import { getLive } from "@/lib/training/live-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const k = byKey(db, req.headers);
  if (!k.link) return Response.json(k.error.body, { status: k.error.status });
  const first = getLive(db, id);
  if (!first || first.personId !== k.link.personId) return Response.json({ ok: false, error: "séance inconnue" }, { status: 404 });
  const enc = new TextEncoder();
  let last = -1;
  let poll: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(poll);
    clearInterval(ping);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          stop();
        }
      };
      send(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);
      const flush = () => {
        const row = getLive(db, id);
        if (!row || row.version === last) return;
        last = row.version;
        send(`data: ${JSON.stringify(liveView(db, row, Date.now()))}\n\n`);
        if (row.ended) stop();
      };
      flush();
      poll = setInterval(flush, 400);
      ping = setInterval(() => send(`: ping ${Date.now()}\n\n`), 15_000);
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {
          /* déjà fermé */
        }
      });
    },
    cancel: stop,
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

// Flux SSE d'une séance partagée : l'état complet à chaque nouvelle version. On relit la base
// toutes les 400 ms (comme la session de cuisine) ; un commentaire toutes les 15 s garde la
// connexion ouverte à travers Caddy et Cloudflare Tunnel.
import { db } from "@/lib/db/client";
import { getLive } from "@/lib/training/live-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getLive(db, id)) return new Response("séance inconnue", { status: 404 });
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
      // L'heure du serveur : chaque écran corrige l'écart de son horloge (repos, rythme guidé).
      send(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);
      const flush = () => {
        const row = getLive(db, id);
        if (!row || row.version === last) return;
        last = row.version;
        send(`data: ${JSON.stringify({ ...row, now: Date.now() })}\n\n`);
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
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

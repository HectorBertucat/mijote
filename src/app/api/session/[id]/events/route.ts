// Flux SSE d'une session : chaque écran s'abonne et reçoit les nouveaux événements du
// journal (cook_events). On relit la base toutes les 700 ms : simple, et juste même si
// plusieurs processus écrivent. Un commentaire part toutes les 15 s pour garder la
// connexion ouverte à travers Caddy et Cloudflare Tunnel.
import { db } from "@/lib/db/client";
import { eventsAfter, getSession } from "@/lib/session/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getSession(db, id)) return new Response("session inconnue", { status: 404 });
  const url = new URL(req.url);
  let last = Math.max(Number(req.headers.get("last-event-id") ?? 0) || 0, Number(url.searchParams.get("after") ?? 0) || 0);
  const enc = new TextEncoder();

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
      // L'heure du serveur : chaque écran corrige l'écart de son horloge pour les minuteurs.
      send(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);
      const flush = () => {
        for (const e of eventsAfter(db, id, last)) {
          last = e.seq!;
          send(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
        }
      };
      flush();
      poll = setInterval(flush, 700);
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

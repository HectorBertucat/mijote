// Assistant : une question, la réponse en flux (NDJSON : morceaux de texte, puis le message gardé
// avec ses actions vérifiées). Sans clé ANTHROPIC_API_KEY, la route n'existe pas.
import { db } from "@/lib/db/client";
import { AiCapReachedError, aiEnabled } from "@/lib/ai";
import { activeProfileId } from "@/lib/health/active";
import { askAssistant, toView } from "@/lib/assistant/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!aiEnabled()) return new Response("assistant indisponible", { status: 404 });
  const body = (await req.json().catch(() => null)) as { text?: unknown; path?: unknown; week?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const path = typeof body?.path === "string" ? body.path : "/";
  const week = typeof body?.week === "string" ? body.week : null;
  if (!text.trim()) return Response.json({ error: "Message vide." }, { status: 400 });
  const personId = await activeProfileId();
  if (!personId) return Response.json({ error: "Aucun profil." }, { status: 400 });
  const recipeSlug = path.match(/^\/recettes\/([a-z0-9-]+)/)?.[1] ?? null;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (x: unknown) => ctrl.enqueue(enc.encode(`${JSON.stringify(x)}\n`));
      try {
        const row = await askAssistant(db, personId, text, { path, recipeSlug, week }, (t) => send({ t: "delta", text: t }));
        send({ t: "done", message: toView(row) });
      } catch (e) {
        const message =
          e instanceof AiCapReachedError
            ? `Plafond IA du mois atteint (${e.spentUsd.toFixed(2).replace(".", ",")} $ sur ${e.capUsd.toFixed(2).replace(".", ",")} $) : l’assistant reprend le mois prochain.`
            : "L’assistant n’a pas pu répondre. Réessaie dans un moment.";
        if (!(e instanceof AiCapReachedError)) console.error("[assistant]", e);
        send({ t: "error", message });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

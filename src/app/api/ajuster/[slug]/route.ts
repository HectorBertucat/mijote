// « Ajuster » une fiche, en flux NDJSON : une ligne par étape réelle (lecture de la fiche, appel IA,
// vérification au drive ingrédient par ingrédient), puis la proposition, déjà enregistrée en base.
import { z } from "zod";
import { monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { runAdjustment, type AdjustPhase } from "@/lib/atelier";
import { userMessage } from "@/lib/atelier/errors";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const Body = z.object({
  optionId: z.string().max(40).optional(),
  text: z.string().max(600).optional(),
  refine: z.boolean().optional(),
  label: z.string().min(1).max(600),
});

export type AdjustEvent =
  | ({ type: "phase" } & AdjustPhase)
  | { type: "done"; stored: Awaited<ReturnType<typeof runAdjustment>>; budget: { spentUsd: number; capUsd: number } }
  | { type: "error"; error: string };

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Demande invalide." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      // Si on quitte la fiche, le flux est coupé mais l'ajustement va au bout et s'enregistre : on n'écrit plus, c'est tout.
      let gone = false;
      const send = (e: AdjustEvent) => {
        if (gone) return;
        try {
          ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          gone = true;
        }
      };
      try {
        const stored = await runAdjustment(db, slug, body.data, { onPhase: (p) => send({ type: "phase", ...p }) });
        send({ type: "done", stored, budget: { spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() } });
      } catch (e) {
        send({ type: "error", error: userMessage(e) });
      } finally {
        try {
          ctrl.close();
        } catch {
          // déjà fermé par le client
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

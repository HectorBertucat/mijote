"use client";

// Fiche recette : les aliments qui n’ont qu’un dessin générique, et le bouton pour que l’IA les dessine
// (dessins filtrés par le code avant d'être gardés : src/lib/illus/sanitize.ts).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ui";
import { drawMissingAction } from "@/app/recettes/[slug]/draw-actions";

export function DrawMissing({ slug, items, aiReady }: { slug: string; items: string[]; aiReady: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!items.length && !msg) return null;
  return (
    <div className="grid gap-2 rounded-[12px] bg-surface-2 px-3.5 py-3 text-[14px]">
      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ink-2">
            Sans dessin à leur nom : <b className="text-ink">{items.join(", ")}</b>
          </span>
          <Button
            size="sm"
            icon="sparkdraft"
            disabled={!aiReady || pending}
            state={pending ? "loading" : "idle"}
            loadingLabel="L’IA dessine…"
            onClick={() =>
              start(async () => {
                const r = await drawMissingAction(slug);
                setMsg(r);
                router.refresh();
              })
            }
          >
            Dessiner avec l’IA
          </Button>
        </div>
      )}
      {msg && <Alert tone={msg.ok ? "ok" : "warn"}>{msg.text}</Alert>}
    </div>
  );
}

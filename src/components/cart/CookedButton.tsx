"use client";

// « J’ai cuisiné » : décompte les grammes de la fiche dans le placard (les lots les plus anciens d’abord).
// CookedButton : le bouton de confirmation (chargement puis fait, message en toast).
// CookAction : le bouton de l’en-tête de la fiche, qui ouvre une feuille avec ce qui sera décompté.
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { cooked } from "@/app/recettes/[slug]/cook-actions";
import { Alert, Button, buttonClass, List, ListRow, Sheet, Toast, ToastZone } from "@/components/ui";
import type { PlannedUsage } from "@/lib/costs";

const eur = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")} €`);

function useAutoClear<T>(v: T | null, set: (v: null) => void, ms = 4200) {
  useEffect(() => {
    if (!v) return;
    const id = setTimeout(() => set(null), ms);
    return () => clearTimeout(id);
  }, [v, set, ms]);
}

export function CookedButton({ recipeId, slug, block = false, onDone }: { recipeId: string; slug: string; block?: boolean; onDone?: (r: { ok: boolean; message: string }) => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean; n: number } | null>(null);
  useAutoClear(msg, setMsg);
  return (
    <>
      <Button
        variant="primary"
        icon="check"
        block={block}
        state={pending ? "loading" : msg?.ok ? "done" : "idle"}
        loadingLabel="J’enregistre…"
        doneLabel="Noté"
        onClick={() =>
          start(async () => {
            const r = await cooked(recipeId, slug);
            setMsg((m) => ({ text: r.message, ok: r.ok, n: (m?.n ?? 0) + 1 }));
            onDone?.(r);
          })
        }
      >
        J’ai cuisiné
      </Button>
      {msg && !msg.ok && (
        <Alert tone="ko" role="alert" className="col-span-full">
          {msg.text}
        </Alert>
      )}
      {!onDone && <ToastZone>{msg?.ok && <Toast key={msg.n}>{msg.text}</Toast>}</ToastZone>}
    </>
  );
}

/** Bouton « J’ai cuisiné » de l’en-tête : ouvre la feuille qui montre ce qui sera décompté, puis confirme. */
export function CookAction({ recipeId, slug, plan, block = false }: { recipeId: string; slug: string; plan: PlannedUsage[]; block?: boolean }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  useAutoClear(toast, setToast);
  const fromLots = plan.filter((p) => p.source === "lot");
  return (
    <>
      <Button variant="primary" icon="check" block={block} onClick={() => setOpen(true)} aria-haspopup="dialog">
        J’ai cuisiné
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="J’ai cuisiné cette recette"
        footer={
          plan.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setOpen(false)}>Annuler</Button>
              <CookedButton
                recipeId={recipeId}
                slug={slug}
                block
                onDone={(r) => {
                  if (!r.ok) return;
                  setOpen(false);
                  setToast((t) => ({ text: r.message, n: (t?.n ?? 0) + 1 }));
                }}
              />
            </div>
          ) : (
            <Link href="/composer" className={buttonClass({ variant: "primary", block: true })}>
              Faire une liste dans Composer
            </Link>
          )
        }
      >
        {plan.length > 0 ? (
          <>
            <p className="text-[15px] text-ink-2">
              Décompte les grammes de la fiche dans le placard ({fromLots.length} lot{fromLots.length > 1 ? "s" : ""}), les plus anciens d’abord. Le reste est compté au prix du catalogue.
            </p>
            <List>
              {plan.map((p, k) => (
                <ListRow
                  key={k}
                  title={<span className="font-medium">{p.item}</span>}
                  sub={p.source === "lot" ? `placard${p.lotName ? ` · ${p.lotName}` : ""}` : p.source === "catalogue" ? "prix du catalogue" : "prix inconnu"}
                  trail={
                    <span className="num shrink-0 text-right text-[14px]">
                      {p.grams ? `${p.grams} g · ` : ""}
                      {eur(p.value)}
                    </span>
                  }
                />
              ))}
            </List>
          </>
        ) : (
          <Alert tone="info" title="Rien à décompter pour l’instant">
            Fais une liste de courses avec cette recette : le placard saura ce qui a été acheté pour elle.
          </Alert>
        )}
      </Sheet>
      <ToastZone>{toast && <Toast key={toast.n}>{toast.text}</Toast>}</ToastZone>
    </>
  );
}

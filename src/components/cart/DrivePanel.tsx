"use client";

// Le vrai panier Chronodrive (compte drive, facultatif) : envoyer la liste au panier, suivre le worker, voir ce
// qui est vraiment dedans ; puis, une fois la commande payée sur chronodrive.com, la relire pour
// prendre les prix payés. Le worker de chronocatalog fait ~1 requête toutes les 2,5 s : on suit.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { askOrder, followDrive, followOrder, sendDrive } from "@/app/courses/actions";
import { Button, Pill } from "@/components/ui";
import { eur } from "./format";

const STEP_S = 2.5;

export interface DrivePanelProps {
  listId: string;
  enabled: boolean;
  ordered: boolean;
  products: number;
  drive: { status: "pending" | "done" | "failed" | null; at: string | null; error: string | null; summary: Record<string, number> | null };
  order: { status: "pending" | "done" | "failed" | null; error: string | null; paid: number | null; estimated: number | null; matched: number; total: number };
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
};

export function DrivePanel({ listId, enabled, ordered, products, drive, order }: DrivePanelProps) {
  const router = useRouter();
  const alive = useRef(true);
  const [busy, setBusy] = useState<"drive" | "order" | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  async function follow(kind: "drive" | "order") {
    setBusy(kind);
    const until = Date.now() + 8 * 60_000;
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 3000));
      const r = kind === "drive" ? await followDrive(listId) : await followOrder(listId);
      if (!r.ok) {
        setMsg({ text: r.message, ok: false });
        break;
      }
      if (r.status !== "pending") {
        if (r.message) setMsg({ text: r.message, ok: true });
        break;
      }
    }
    setBusy(null);
    router.refresh();
  }

  // Page rechargée pendant un envoi ou une relecture : on reprend le suivi.
  useEffect(() => {
    if (drive.status === "pending") void follow("drive");
    else if (order.status === "pending") void follow("order");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled)
    return (
      <section className="rounded-[14px] border border-line bg-surface px-3.5 py-3 text-[14px] text-ink-2" aria-label="Panier Chronodrive">
        <b className="text-ink">Panier Chronodrive</b> · compte non relié (jeton <code>CHRONOCATALOG_ACCOUNT_TOKEN</code> absent).
      </section>
    );

  const s = drive.summary;
  const pills = s
    ? ([
        ["added", "ajouté", "ok"],
        ["already", "déjà là", "ok"],
        ["partial", "partiel", "warn"],
        ["unavailable", "indisponible", "ko"],
        ["failed", "refusé", "ko"],
        ["skipped", "hors drive", "warn"],
        ["completed", "complété par un autre produit", "ok"],
        ["short", "manque au panier", "ko"],
      ] as const).filter(([k]) => (s[k] ?? 0) > 0)
    : [];

  return (
    <section className="grid gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 py-3" aria-label="Panier Chronodrive">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
        <b>Panier Chronodrive</b>
        {drive.at && drive.status === "done" && <span className="text-ink-2">envoyé {ago(drive.at)}</span>}
      </div>

      {!ordered && (
        <>
          <p className="text-[14px] text-ink-2">
            {drive.status === "done"
              ? (s?.short ?? 0) > 0
                ? "Il manque encore des produits au panier (rupture, et pas de remplaçant en stock) : vois les lignes en rouge, change le produit puis renvoie."
                : (s?.completed ?? 0) > 0
                  ? "Panier complet : ce qui était en rupture a été remplacé par un autre produit du même type (lignes « complément »)."
                  : "Panier complet, relu ligne par ligne. Renvoyer ne double rien : seul ce qui manque est ajouté."
              : `Les ${products} produits partent dans ton vrai panier, au nombre de paquets de la liste. Compte ~${Math.max(1, Math.round(((products + 5) * STEP_S) / 60))} min : le worker va doucement.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={drive.status === "done" ? "secondary" : "primary"}
              size="sm"
              icon="basket"
              state={busy === "drive" ? "loading" : "idle"}
              loadingLabel="Le worker remplit ton panier…"
              disabled={!!busy || products === 0}
              onClick={async () => {
                setMsg(null);
                const r = await sendDrive(listId);
                if (!r.ok) return setMsg({ text: r.message, ok: false });
                void follow("drive");
              }}
            >
              {drive.status === "done" ? "Renvoyer au panier" : "Envoyer au panier"}
            </Button>
            {drive.status === "done" && (
              <a href="https://www.chronodrive.com" target="_blank" rel="noreferrer" className="text-[14px] font-semibold text-accent hover:underline">
                Payer sur chronodrive.com
              </a>
            )}
          </div>
        </>
      )}

      {pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {pills.map(([k, label, tone]) => (
            <Pill key={k} tone={tone}>
              <span className="num">{s![k]}</span> {label}
              {s![k] > 1 && !label.includes(" ") ? "s" : ""}
            </Pill>
          ))}
          {s!.total > 0 && <span className="num text-[13px] text-ink-2">panier : {eur(s!.total)}</span>}
        </div>
      )}
      {drive.status === "failed" && drive.error && <p className="text-[14px] text-ko">Envoi impossible : {drive.error}</p>}

      {(drive.status === "done" || ordered) && (
        <div className="grid gap-2 border-t border-dashed border-line pt-2.5">
          {order.status === "done" && order.paid != null ? (
            <p className="text-[14px]">
              Commande relue : <b className="num">{eur(order.paid)}</b> payés
              {order.estimated != null && Math.abs(order.paid - order.estimated) >= 0.01 && (
                <span className="text-ink-2">
                  {" "}
                  (estimé <span className="num">{eur(order.estimated)}</span>)
                </span>
              )}
              {order.matched < order.total && (
                <span className="text-ink-2">
                  {" "}
                  · <span className="num">{order.total - order.matched}</span> achat{order.total - order.matched > 1 ? "s" : ""} absent{order.total - order.matched > 1 ? "s" : ""} de la commande
                </span>
              )}
              .
            </p>
          ) : (
            <p className="text-[14px] text-ink-2">Une fois la commande payée sur chronodrive.com, relis-la : la liste est validée, et chaque achat prend le prix réellement payé (coût réel par recette).</p>
          )}
          <div>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              state={busy === "order" ? "loading" : "idle"}
              loadingLabel="Je relis tes commandes…"
              disabled={!!busy}
              onClick={async () => {
                setMsg(null);
                const r = await askOrder(listId);
                if (!r.ok) return setMsg({ text: r.message, ok: false });
                void follow("order");
              }}
            >
              {order.status === "done" ? "Relire à nouveau" : "Relire ma commande"}
            </Button>
          </div>
          {order.status === "failed" && order.error && !msg && <p className="text-[14px] text-warn">{order.error}</p>}
        </div>
      )}

      {msg && (
        <p role="status" className={`text-[14px] ${msg.ok ? "text-ok" : "text-ko"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

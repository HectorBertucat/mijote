"use client";

// Le vrai panier du drive (compte drive, facultatif) : envoyer la liste au panier, suivre le worker, voir ce
// qui est vraiment dedans ; puis, une fois la commande payée sur le site du drive, la relire pour
// prendre les prix payés. Le worker de chronocatalog fait ~1 requête toutes les 2,5 s : on suit.
// Section sobre : étiquette, une phrase, un bouton, des chiffres ; la couleur seulement pour ce qui manque.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { askOrder, followDrive, followOrder, sendDrive } from "@/app/courses/actions";
import { Button, Icon } from "@/components/ui";
import { SectionHead } from "./Carnet";
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
  return m < 1 ? "à l’instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
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
      <p className="text-small text-ink-3">
        Panier drive : compte non relié (<code className="text-[0.9em]">CHRONOCATALOG_ACCOUNT_TOKEN</code> sur le serveur).
      </p>
    );

  const s = drive.summary;
  const counts = s
    ? ([
        ["added", "ajouté", null],
        ["already", "déjà là", null],
        ["completed", "remplacé par un autre produit", null],
        ["partial", "partiel", "warn"],
        ["skipped", "hors drive", "warn"],
        ["unavailable", "indisponible", "ko"],
        ["failed", "refusé", "ko"],
        ["short", "manque au panier", "ko"],
      ] as const).filter(([k]) => (s[k] ?? 0) > 0)
    : [];

  return (
    <section className="grid gap-4" aria-labelledby="drive-titre">
      <SectionHead as="label" id="drive-titre" title="Panier drive" count={drive.at && drive.status === "done" ? `envoyé ${ago(drive.at)}` : undefined} />

      {!ordered && (
        <>
          <p className="text-small text-ink-2">
            {drive.status === "done"
              ? (s?.short ?? 0) > 0
                ? "Il manque des produits au panier, sans remplaçant en stock. Change-les dans la liste, puis renvoie."
                : (s?.completed ?? 0) > 0
                  ? "Panier complet : les ruptures ont été remplacées par un produit du même type."
                  : "Panier complet, relu ligne par ligne. Renvoyer ne double rien : seul ce qui manque part."
              : `${products} produits partent dans ton vrai panier, au nombre de paquets de la liste. Compte ${Math.max(1, Math.round(((products + 5) * STEP_S) / 60))}\u00a0min.`}
          </p>
          <div className="flex flex-wrap items-center gap-4">
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
              <a href="https://www.chronodrive.com" target="_blank" rel="noreferrer" className="inline-flex min-h-tap items-center text-small font-semibold text-accent underline-offset-4 hover:underline">
                Payer sur le drive
              </a>
            )}
          </div>
        </>
      )}

      {counts.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] border-t border-line">
          {counts.map(([k, label, tone]) => (
            <div key={k} className={`col-span-2 grid grid-cols-subgrid items-baseline border-b border-line py-2 ${tone === "ko" ? "text-ko-ink" : tone === "warn" ? "text-warn-ink" : ""}`}>
              <dt className="num-tight pr-4 text-right text-h3">{s![k]}</dt>
              <dd className="flex items-center gap-1 text-small">
                {tone && <Icon name={tone === "ko" ? "x" : "alert"} size="s" strokeWidth={2.4} />}
                {label}
              </dd>
            </div>
          ))}
          {s!.total > 0 && (
            <div className="col-span-2 grid grid-cols-subgrid items-baseline py-2">
              <dt className="num pr-4 text-right font-semibold">{eur(s!.total)}</dt>
              <dd className="text-small text-ink-2">dans le panier</dd>
            </div>
          )}
        </dl>
      )}
      {drive.status === "failed" && drive.error && <p className="text-small text-ko-ink">Envoi impossible : {drive.error}</p>}

      {(drive.status === "done" || ordered) && (
        <div className="grid gap-3 border-t border-line pt-4">
          {order.status === "done" && order.paid != null ? (
            <p className="text-small">
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
            <p className="text-small text-ink-2">Commande payée sur le drive ? Relis-la : la liste est validée et chaque achat prend le prix payé.</p>
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
          {order.status === "failed" && order.error && !msg && <p className="text-small text-warn-ink">{order.error}</p>}
        </div>
      )}

      {msg && (
        <p role="status" className={`text-small ${msg.ok ? "text-ink-2" : "text-ko-ink"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

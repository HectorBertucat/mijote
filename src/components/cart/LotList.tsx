"use client";

// Lots du placard : une ligne à filet par reste (dessin, nom, ce qui reste en chiffres alignés, filet de jauge),
// « Utilisé » ou « Perdu » d’un tap (avec annulation).
import { useOptimistic, useTransition } from "react";
import { Button, Icon } from "@/components/ui";
import { FoodIllu } from "@/components/illus/Illu";
import { markLot, undoLot } from "@/app/placard/actions";
import { useToast } from "./Toast";
import { eur, grams } from "./format";

export interface LotData {
  id: string;
  item: string;
  name: string | null;
  gramsLeft: number;
  gramsInitial: number | null;
  valueLeft: number;
  status: "ok" | "used" | "lost";
  boughtAt: string | null;
  closedAt: string | null;
}

export function LotList({ lots, closed = false }: { lots: LotData[]; closed?: boolean }) {
  const [shown, hide] = useOptimistic(lots, (cur: LotData[], id: string) => cur.filter((l) => l.id !== id));
  const [, start] = useTransition();
  const { show, node } = useToast();
  const act = (id: string, fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      hide(id);
      const r = await fn();
      show(r.message, r.ok);
    });

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }) : null);
  return (
    <>
      <ul>
        {shown.map((l) => {
          const pct = l.gramsInitial ? Math.max(0, Math.min(100, (l.gramsLeft / l.gramsInitial) * 100)) : 100;
          const bought = when(l.boughtAt);
          return (
            <li key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-b border-line py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
              <FoodIllu item={l.item} size="s" className={closed ? "opacity-40" : ""} />
              <div className="grid min-w-0 gap-1">
                <span className={`truncate font-semibold ${closed ? "text-ink-2" : ""}`}>{l.item}</span>
                <span className="truncate text-small text-ink-3">{[l.name !== l.item ? l.name : null, bought && !closed ? `acheté le ${bought}` : null].filter(Boolean).join(" · ") || "\u00a0"}</span>
              </div>
              <div className="grid justify-items-end gap-1 text-right">
                <span className="num whitespace-nowrap font-semibold">{l.gramsInitial ? grams(l.gramsLeft) : eur(l.valueLeft)}</span>
                {l.gramsInitial ? (
                  <span className="num whitespace-nowrap text-small text-ink-3">
                    sur {grams(l.gramsInitial)} · {eur(l.valueLeft)}
                  </span>
                ) : (
                  <span className="text-small text-ink-3">poids inconnu</span>
                )}
                {!closed && l.gramsInitial != null && (
                  <span className="block h-0.5 w-18 bg-line" aria-hidden>
                    <span className="block h-full bg-ink-2" style={{ width: `${pct}%` }} />
                  </span>
                )}
              </div>
              {closed ? (
                <span className="col-span-3 flex items-center justify-end gap-3 sm:col-span-1">
                  <span className="inline-flex items-center gap-1 text-small text-ink-2">
                    <Icon name={l.status === "lost" ? "trash" : "check"} size="s" />
                    {l.status === "lost" ? "Perdu" : "Utilisé"}
                  </span>
                  <Button size="sm" variant="quiet" onClick={() => act(l.id, () => undoLot(l.id))}>
                    Remettre
                  </Button>
                </span>
              ) : (
                <span className="col-span-3 flex justify-end gap-2 sm:col-span-1">
                  <Button size="sm" icon="check" onClick={() => act(l.id, () => markLot(l.id, "used"))} aria-label={`${l.item} : utilisé`}>
                    Utilisé
                  </Button>
                  <Button size="sm" variant="quiet" icon="trash" onClick={() => act(l.id, () => markLot(l.id, "lost"))} aria-label={`${l.item} : perdu`}>
                    Perdu
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {node}
    </>
  );
}

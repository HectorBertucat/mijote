"use client";

// Lots du placard : jauge de ce qui reste, « Utilisé » ou « Perdu » d'un tap (avec annulation).
import { useOptimistic, useTransition } from "react";
import { Button, Pill } from "@/components/ui";
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
      <ul className={`grid ${closed ? "" : "overflow-hidden rounded-[14px] border border-line bg-surface"} [&>li:last-child]:border-b-0`}>
        {shown.map((l) => {
          const pct = l.gramsInitial ? Math.max(0, Math.min(100, (l.gramsLeft / l.gramsInitial) * 100)) : 100;
          const bought = when(l.boughtAt);
          return (
            <li key={l.id} className="flex min-w-0 items-center gap-3 border-b border-line px-3.5 py-3">
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="truncate font-semibold">{l.item}</span>
                <span className="truncate text-[13px] text-ink-2">
                  <span className="num">
                    {l.gramsInitial ? `${grams(l.gramsLeft)} sur ${grams(l.gramsInitial)}` : "poids inconnu"} · {eur(l.valueLeft)}
                  </span>
                  {l.name && ` · ${l.name}`}
                  {bought && !closed && ` · acheté le ${bought}`}
                </span>
                {!closed && (
                  <span className="h-1.5 max-w-[220px] overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span className={`block h-full rounded-full ${pct > 50 ? "bg-ok" : pct > 20 ? "bg-warn" : "bg-ko"}`} style={{ width: `${pct}%` }} />
                  </span>
                )}
              </div>
              {closed ? (
                <span className="flex shrink-0 items-center gap-2">
                  {l.status === "lost" ? <Pill tone="ko">perdu</Pill> : <Pill tone="idle" icon="check">utilisé</Pill>}
                  <Button size="sm" variant="quiet" onClick={() => act(l.id, () => undoLot(l.id))}>
                    Remettre
                  </Button>
                </span>
              ) : (
                <span className="flex shrink-0 gap-1.5">
                  <Button size="sm" icon="check" onClick={() => act(l.id, () => markLot(l.id, "used"))} aria-label={`${l.item} : utilisé`}>
                    Utilisé
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => act(l.id, () => markLot(l.id, "lost"))} aria-label={`${l.item} : perdu`}>
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

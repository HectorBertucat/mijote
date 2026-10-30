"use client";

// Les boîtes d'un lieu (frigo ou congélo) : la plus pressée d'abord, « Je la mange » d'un tap (au
// journal de Santé du profil de l'appareil), passer au congélo ou en sortir, jetée (deux taps).
import { useOptimistic, useState, useTransition } from "react";
import { Button, Pill, RecipeTile } from "@/components/ui";
import { eatBoxAction, moveBoxAction, throwBoxAction } from "@/app/frigo/actions";
import { useToast } from "@/components/cart/Toast";
import { gramsLabel } from "@/lib/boxes/core";
import type { StockBox } from "@/lib/boxes/store";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const MEAL = { lunch: "midi", dinner: "soir" } as const;

function limitText(b: StockBox, today: string) {
  if (b.freshness === "past") return `à jeter depuis ${day(b.limit)}`;
  if (b.limit === today) return "à manger aujourd'hui";
  if (b.freshness === "soon") return "à manger demain au plus tard";
  return `jusqu'au ${day(b.limit)}`;
}

export function BoxList({ boxes, colors, today, eater }: { boxes: StockBox[]; colors: Record<string, string>; today: string; eater: string }) {
  const [shown, hide] = useOptimistic(boxes, (cur: StockBox[], id: string) => cur.filter((b) => b.id !== id));
  const [, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  const { show, node } = useToast();
  const act = (id: string, fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      hide(id);
      const r = await fn();
      show(r.message, r.ok);
    });

  return (
    <>
      <ul className="grid overflow-hidden rounded-[14px] border border-line bg-surface [&>li:last-child]:border-b-0">
        {shown.map((b) => {
          const qty = [b.grams != null ? gramsLabel(b.grams) : null, b.sideGrams != null ? `${gramsLabel(b.sideGrams)} de ${b.sideLabel ?? "garniture"}` : null].filter(Boolean).join(" + ");
          return (
            <li key={b.id} className="grid gap-2.5 border-b border-line px-3.5 py-3" data-box={b.id}>
              <div className="flex min-w-0 items-start gap-3">
                <RecipeTile color={(b.slug && colors[b.slug]) || "var(--c-ink-3)"} name={b.name} size="sm" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-semibold leading-snug">{b.name}</span>
                  <span className="num text-[14px] text-ink-2">
                    {[b.personName ? `pour ${b.personName}` : null, qty || null, b.kcal != null ? `≈ ${Math.round(b.kcal)} kcal` : null].filter(Boolean).join(" · ")}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
                    {b.freshness === "ok" ? <span>{limitText(b, today)}</span> : <Pill tone={b.freshness === "past" ? "ko" : "warn"}>{limitText(b, today)}</Pill>}
                    {b.plannedFor && b.plannedMeal && <span>· prévue {day(b.plannedFor)} {MEAL[b.plannedMeal]}</span>}
                    {b.thawed && <span>· décongelée</span>}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-10">
                <Button size="sm" variant="primary" icon="check" onClick={() => act(b.id, () => eatBoxAction(b.id))} title={`Noté au journal de ${eater}`} data-action="manger">
                  Je la mange
                </Button>
                {b.place === "fridge" ? (
                  <Button size="sm" icon="snow" onClick={() => act(b.id, () => moveBoxAction(b.id, "freezer"))} data-action="congeler">
                    Au congélo
                  </Button>
                ) : (
                  <Button size="sm" icon="fridge" onClick={() => act(b.id, () => moveBoxAction(b.id, "fridge"))} data-action="decongeler">
                    Sortir au frigo
                  </Button>
                )}
                {confirm === b.id ? (
                  <Button size="sm" variant="danger" icon="trash" onClick={() => act(b.id, () => throwBoxAction(b.id))} data-action="jeter-oui">
                    Oui, jetée
                  </Button>
                ) : (
                  <Button size="sm" variant="quiet" icon="trash" onClick={() => setConfirm(b.id)} data-action="jeter">
                    Jetée
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {node}
    </>
  );
}

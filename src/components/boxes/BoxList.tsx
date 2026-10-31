"use client";

// Les boîtes d'un lieu (frigo ou congélo), la plus pressée d'abord : une ligne par boîte (les boîtes
// pareilles, même plat, même mangeur, même date, sont regroupées « ×3 »), la date limite en grand à
// droite, « Je la mange » d'un geste (au journal de Santé du profil de l'appareil) ; passer au congélo
// ou en sortir, jetée (deux gestes) en retrait. Le bouton plein d'encre : la plus pressée du frigo seulement. Pas de pastilles : la date et un mot disent l'urgence.
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { eatBoxAction, moveBoxAction, throwBoxAction } from "@/app/frigo/actions";
import { useToast } from "@/components/cart/Toast";
import { daysBetween, gramsLabel } from "@/lib/boxes/core";
import type { StockBox } from "@/lib/boxes/store";
import { BoxGlyph } from "./BoxGlyph";

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { ...o, timeZone: "UTC" });
const day = (d: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" });
const MEAL = { lunch: "midi", dinner: "soir" } as const;

/** La date limite : un mot d'étiquette et une date en grand. Proche : le jour de la semaine ; loin : le jour et le mois. */
function limitOf(b: StockBox, today: string): { label: string; big: string; tone: string } {
  if (b.freshness === "past") return { label: "À jeter depuis", big: fmt(b.limit, { day: "numeric", month: "short" }), tone: "text-ko-ink" };
  if (b.limit === today) return { label: "À manger", big: "aujourd’hui", tone: "text-warn-ink" };
  if (b.freshness === "soon") return { label: "À manger", big: "demain", tone: "text-warn-ink" };
  const near = daysBetween(today, b.limit) <= 6;
  return { label: "Jusqu’au", big: near ? fmt(b.limit, { weekday: "short", day: "numeric" }) : fmt(b.limit, { day: "numeric", month: "short" }), tone: "" };
}

type Group = { key: string; box: StockBox; ids: string[] };
const groupKey = (b: StockBox) => [b.name, b.personId, b.grams, b.sideGrams, b.limit, b.place, b.thawed, b.plannedFor, b.plannedMeal].join("|");
function groups(boxes: StockBox[]): Group[] {
  const out: Group[] = [];
  for (const b of boxes) {
    const g = out.find((x) => x.key === groupKey(b));
    if (g) g.ids.push(b.id);
    else out.push({ key: groupKey(b), box: b, ids: [b.id] });
  }
  return out;
}

export function BoxList({ boxes, colors, arts = {}, today, eater }: { boxes: StockBox[]; colors: Record<string, string>; /** La boîte de chaque plat (DishBox), rendue par la page, par slug. */ arts?: Record<string, ReactNode>; today: string; eater: string }) {
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
      <ul className="grid border-b border-line">
        {groups(shown).map(({ key, box: b, ids }, gi) => {
          const id = ids[0];
          const qty = [b.grams != null ? gramsLabel(b.grams) : null, b.sideGrams != null ? `${gramsLabel(b.sideGrams)} de ${b.sideLabel ?? "garniture"}` : null].filter(Boolean).join(" + ");
          const lim = limitOf(b, today);
          const frozen = b.place === "freezer";
          return (
            <li key={key} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 border-t border-line py-4" data-box={id}>
              {(b.slug && arts[b.slug]) || <BoxGlyph color={(b.slug && colors[b.slug]) || "var(--c-ink-3)"} size={56} frozen={frozen} />}
              <div className="grid min-w-0 gap-1">
                <b className="text-[17px] leading-snug">
                  {b.name}
                  {ids.length > 1 && <span className="num-tight ml-2 text-[20px] text-ink-2">×{ids.length}</span>}
                </b>
                <span className="num text-small text-ink-2">
                  {[b.personName ? `pour ${b.personName}` : null, qty || null, b.kcal != null ? `≈ ${Math.round(b.kcal)} kcal` : null].filter(Boolean).join(" · ")}
                </span>
                {(b.plannedFor || b.thawed) && (
                  <span className="text-small text-ink-2">
                    {[b.plannedFor && b.plannedMeal ? `prévue ${day(b.plannedFor)} ${MEAL[b.plannedMeal]}` : null, b.thawed ? "décongelée" : null].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              <p className={`grid justify-items-end text-right ${lim.tone}`}>
                <span className={`label ${lim.tone ? "" : "text-ink-2"}`}>{lim.label}</span>
                <span className="num-tight text-[28px] leading-none">{lim.big}</span>
              </p>
              <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-2">
                <Button variant={gi === 0 && !frozen ? "primary" : "secondary"} icon="check" onClick={() => act(id, () => eatBoxAction(id))} title={eater ? `Noté au journal de ${eater}` : undefined} data-action="manger">
                  Je la mange
                </Button>
                {frozen ? (
                  <Button variant="quiet" icon="fridge" onClick={() => act(id, () => moveBoxAction(id, "fridge"))} data-action="decongeler">
                    Sortir au frigo
                  </Button>
                ) : (
                  <Button variant="quiet" icon="snow" onClick={() => act(id, () => moveBoxAction(id, "freezer"))} data-action="congeler">
                    Au congélo
                  </Button>
                )}
                {confirm === id ? (
                  <Button variant="danger" icon="trash" onClick={() => act(id, () => throwBoxAction(id))} data-action="jeter-oui">
                    Oui, jetée
                  </Button>
                ) : (
                  <Button variant="quiet" iconOnly icon="trash" onClick={() => setConfirm(id)} aria-label="Jetée" title="Jetée" data-action="jeter" />
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

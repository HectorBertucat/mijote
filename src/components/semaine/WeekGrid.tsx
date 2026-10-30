"use client";

// Grille de la période (DA « Plan de travail », .wk/.cell/.pres) : du premier au dernier jour, midi et soir,
// par rangées de 7 jours (une période va jusqu'à 14 jours).
// Ordinateur et iPad : chaque case porte la recette et une pastille par personne (un tap : maison → bureau → absent).
// Téléphone : grille compacte (étiquette de recette + points) ; toucher un jour ouvre une feuille avec les pastilles.
import { useState } from "react";
import { Icon, PresenceDots, RecipeTile, Sheet, type Place } from "@/components/ui";
import { PlaceButton } from "@/app/semaine/PlaceButton";

export type GridSlot = { id: string; personId: string; name: string; initial: string; place: Place };
export type GridDish = { slug: string; name: string; color: string };
export type GridCell = { day: number; meal: "lunch" | "dinner"; slots: GridSlot[]; dishes: GridDish[]; missing: boolean; frozen: boolean };
/** Un jour de la période : initiale, nom et numéro du jour. */
export type GridDay = { letter: string; long: string; num: number };

const MEAL = { lunch: "midi", dinner: "soir" } as const;

const firstWord = (name: string) => name.split(/\s+/)[0];

export function WeekGrid({ cells, days, proposed }: { cells: GridCell[]; days: GridDay[]; proposed: boolean }) {
  const [openDay, setOpenDay] = useState<number | null>(null);
  const at = (day: number, meal: "lunch" | "dinner") => cells.find((c) => c.day === day && c.meal === meal)!;
  const meals = ["lunch", "dinner"] as const;
  // Rangées de 7 jours : les colonnes restent alignées d'une rangée à l'autre.
  const rows = Array.from({ length: Math.ceil(days.length / 7) }, (_, r) => days.slice(r * 7, r * 7 + 7).map((d, k) => ({ ...d, i: r * 7 + k })));

  return (
    <>
      {/* Ordinateur, iPad */}
      {rows.map((row, r) => (
        <div key={r} className="hidden gap-1.5 sm:grid sm:grid-cols-[52px_repeat(7,minmax(0,1fr))] lg:grid-cols-[64px_repeat(7,minmax(0,1fr))]">
          <span />
          {row.map((d) => (
            <div key={d.i} className="pb-0.5 text-center text-[12px] font-bold text-ink-2">
              {d.letter}
              <b className="num block font-display text-[18px] text-ink">{d.num}</b>
            </div>
          ))}
          {meals.map((meal) => (
            <div key={meal} className="contents">
              <span className="self-center text-[12px] font-bold uppercase tracking-[0.08em] text-faint">{MEAL[meal]}</span>
              {row.map(({ i: day }) => {
                const c = at(day, meal);
                const eats = c.slots.some((s) => s.place !== "away");
                const empty = c.dishes.length === 0;
                return (
                  <div key={day} className={`grid min-h-[92px] min-w-0 content-between gap-2 rounded-[10px] border p-2 ${empty ? "border-dashed border-line-strong bg-transparent" : "border-line bg-surface"} ${c.missing && proposed ? "!border-warn" : ""}`}>
                    <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold leading-tight">
                      {c.dishes.map((d, k) => (
                        <RecipeTile key={d.slug} color={d.color} name={d.name} size="sm" className={k > 0 ? "-ml-3 ring-2 ring-surface" : ""} />
                      ))}
                      {c.dishes.length === 1 && <span className="min-w-0 truncate">{firstWord(c.dishes[0].name)}</span>}
                      {c.dishes.length > 1 && <span className="min-w-0 truncate text-ink-2">{c.dishes.length} plats</span>}
                      {empty && <span className={c.missing && proposed ? "font-semibold text-warn-ink" : "font-normal text-faint"}>{c.missing && proposed ? "à prévoir" : eats ? "rien de prévu" : "personne"}</span>}
                      {c.frozen && <Icon name="snow" size={14} className="ml-auto shrink-0 text-ink-2" label="à congeler le jour de la session" />}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.slots.map((s) => (
                        <PlaceButton key={s.id} slotId={s.id} place={s.place} initial={s.initial} name={s.name} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}

      {/* Téléphone */}
      {rows.map((row, r) => (
        <div key={r} className="grid grid-cols-[38px_repeat(7,minmax(0,1fr))] gap-1 sm:hidden">
          <span />
          {row.map((d) => (
            <div key={d.i} className="text-center text-[11px] font-bold text-ink-2">
              {d.letter}
              <b className="num block font-display text-[15px] text-ink">{d.num}</b>
            </div>
          ))}
          {meals.map((meal) => (
            <div key={meal} className="contents">
              <span className="self-center text-[10px] font-bold uppercase tracking-[0.06em] text-faint">{MEAL[meal]}</span>
              {row.map(({ i: day }) => {
                const c = at(day, meal);
                const empty = c.dishes.length === 0;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setOpenDay(day)}
                    aria-label={`${days[day].long} ${days[day].num} ${MEAL[meal]} : ${c.dishes.map((d) => d.name).join(", ") || "rien de prévu"} · ${c.slots.map((s) => `${s.name} ${s.place === "away" ? "absent" : s.place === "office" ? "bureau" : "maison"}`).join(", ")}`}
                    className={`relative grid min-h-[58px] min-w-0 justify-items-center content-between gap-1 rounded-[9px] border p-[5px] transition-transform active:scale-95 ${empty ? "border-dashed border-line-strong" : "border-line bg-surface"} ${c.missing && proposed ? "!border-warn" : ""}`}
                  >
                    {c.dishes[0] ? <RecipeTile color={c.dishes[0].color} name={c.dishes[0].name} size="sm" /> : <span className={`text-[11px] ${c.missing && proposed ? "font-bold text-warn-ink" : "text-faint"}`}>{c.missing && proposed ? "!" : "—"}</span>}
                    {c.frozen && <Icon name="snow" size={10} className="absolute right-0.5 top-0.5 text-ink-2" />}
                    <PresenceDots places={c.slots.map((s) => ({ name: s.name, place: s.place }))} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      <p className="text-[13px] text-ink-2 sm:hidden">Touchez un jour pour régler la présence de chacun.</p>

      <Sheet open={openDay != null} onClose={() => setOpenDay(null)} title={openDay != null ? `${days[openDay].long} ${days[openDay].num}` : ""}>
        {openDay != null &&
          meals.map((meal) => {
            const c = at(openDay, meal);
            return (
              <div key={meal} className="grid gap-2.5 border-b border-line pb-3.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-faint">{MEAL[meal]}</span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[15px] font-semibold">
                    {c.dishes.map((d) => (
                      <span key={d.slug} className="inline-flex min-w-0 items-center gap-1.5">
                        <RecipeTile color={d.color} name={d.name} size="sm" />
                        <span className="truncate">{d.name}</span>
                      </span>
                    ))}
                    {c.dishes.length === 0 && <span className={c.missing && proposed ? "text-warn-ink" : "font-normal text-faint"}>{c.missing && proposed ? "à prévoir à part" : "rien de prévu"}</span>}
                    {c.frozen && <Icon name="snow" size="s" className="text-ink-2" label="congelé" />}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {c.slots.map((s) => (
                    <PlaceButton key={s.id} slotId={s.id} place={s.place} initial={s.initial} name={s.name} size="lg" />
                  ))}
                </div>
              </div>
            );
          })}
        <p className="text-[13px] text-ink-2">Un tap : maison, puis bureau (repas emporté), puis absent. Les recettes se redistribuent.</p>
      </Sheet>
    </>
  );
}

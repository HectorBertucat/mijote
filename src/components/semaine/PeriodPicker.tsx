"use client";

// Choisir la période « du … au … » (1 à 14 jours) : raccourcis (1 semaine, 10 jours, 2 semaines) et deux
// champs date natifs (le sélecteur du téléphone). La session de cuisine a lieu la veille du premier jour.
// Le calcul (longueur, plafond, veille) vient de src/lib/week/period.ts, comme sur le serveur.
import { useState } from "react";
import { Button, Chip, Chips, Field, Input, Sheet } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { addDays } from "@/lib/week/propose";
import { endOf, isDay, MAX_DAYS, PERIOD_PRESETS, spanDays } from "@/lib/week/period";
import { periodAction } from "@/app/semaine/actions";
import { firstOfMonth } from "@/lib/typo";

const longDate = (ymd: string) => firstOfMonth(new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));

export function PeriodPicker({ start, days }: { start: string; days: number }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(endOf(start, days));
  const n = isDay(from) && isDay(to) ? spanDays(from, to) : 0;
  const error = !isDay(from) || !isDay(to) ? "Choisis les deux dates." : n < 1 ? "Le dernier jour vient après le premier." : n > MAX_DAYS ? `${MAX_DAYS} jours au plus.` : null;

  function show() {
    setFrom(start);
    setTo(endOf(start, days));
    setOpen(true);
  }
  // Changer le premier jour garde la même longueur.
  function changeFrom(v: string) {
    if (isDay(v) && isDay(from) && isDay(to) && n >= 1) setTo(addDays(v, Math.min(n, MAX_DAYS) - 1));
    setFrom(v);
  }

  return (
    <>
      <Button icon="cal" onClick={show}>
        Changer la période
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Période">
        <form action={periodAction} className="grid gap-4">
          <input type="hidden" name="w" value={start} />
          <Chips>
            {PERIOD_PRESETS.map((p) => (
              <Chip key={p.days} pressed={n === p.days} onClick={() => isDay(from) && setTo(endOf(from, p.days))}>
                {p.label}
              </Chip>
            ))}
          </Chips>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Du">{(id) => <Input id={id} name="from" type="date" value={from} onChange={(e) => changeFrom(e.target.value)} required />}</Field>
            <Field label="Au">{(id) => <Input id={id} name="to" type="date" value={to} min={isDay(from) ? from : undefined} max={isDay(from) ? endOf(from, MAX_DAYS) : undefined} onChange={(e) => setTo(e.target.value)} required />}</Field>
          </div>
          <p className={`text-small ${error ? "font-semibold text-warn-ink" : "text-ink-2"}`} role="status">
            {error ?? (
              <>
                <b className="num text-ink">{n}</b>&nbsp;jour{n > 1 ? "s" : ""} · cuisine la veille, le {longDate(addDays(from, -1))}
              </>
            )}
          </p>
          <p className="text-small text-ink-2">Les plats choisis restent ; les quantités et les repas se recalent. Chaque jour garde ses absences.</p>
          {!error && (
            <div>
              <SubmitButton pendingText="Je recale…" icon="check">
                Valider
              </SubmitButton>
            </div>
          )}
        </form>
      </Sheet>
    </>
  );
}

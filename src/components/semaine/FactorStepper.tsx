"use client";

// Unités cuites d'une recette : Stepper du kit (− 45 u +, le chiffre tique) et « ×1,25 la fiche » dessous.
// Le pas n'est pas linéaire (×0,5 → ×3, src/lib/week/propose.ts) : chaque côté porte sa cible `to`.
// Sur la Semaine, un pas appelle l'action serveur ; sur le Composer, il change l'URL (la sélection y vit).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Stepper } from "@/components/ui";

export type Control = ({ href: string } | { action: (fd: FormData) => Promise<void>; fields: Record<string, string> }) & { to: number };

const label = (f: number) => `×${String(f).replace(".", ",")}`;

export function FactorStepper({ name, factor, units, dec, inc, className = "" }: { name: string; factor: number; units: number; dec: Control | null; inc: Control | null; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Affichage immédiat de la cible, remis à jour quand le serveur renvoie la recette.
  const [shown, setShown] = useState({ factor, units, from: factor });
  const cur = pending && shown.from === factor ? shown : { factor, units, from: factor };
  const step = (d: 1 | -1) => {
    const ctl = d > 0 ? inc : dec;
    if (!ctl || pending) return;
    setShown({ factor: ctl.to, units: Math.round((units / factor) * ctl.to), from: factor });
    start(async () => {
      if ("href" in ctl) router.push(ctl.href, { scroll: false });
      else {
        const fd = new FormData();
        for (const [k, v] of Object.entries(ctl.fields)) fd.set(k, v);
        await ctl.action(fd);
      }
    });
  };
  return (
    <div className={`grid justify-items-center gap-1 ${className}`} role="group" aria-label={`Unités cuites de ${name}`}>
      <Stepper value={cur.units} unit="u" onStep={step} canDec={!!dec && !pending} canInc={!!inc && !pending} busy={pending} decLabel={`Moins d'unités de ${name}`} incLabel={`Plus d'unités de ${name}`} />
      <span className={`text-[12px] tabular-nums ${cur.factor === 1 ? "text-faint" : "font-semibold text-accent"}`}>{cur.factor === 1 ? "la fiche" : `${label(cur.factor)} la fiche`}</span>
    </div>
  );
}

"use client";

// Choix de la période (7 j, 30 j, 3 mois, 1 an, tout) pour tous les graphiques d'une section : une seule
// rangée au-dessus d'eux, la période dans l'adresse (`?periode=`), le serveur refait les séries. Pendant
// le calcul, les graphiques restent en place, estompés (pas de squelette, pas de saut).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition, type ReactNode } from "react";

export function PeriodScope<T extends string>({ options, value, param = "periode", head, children, className = "" }: { options: { value: T; label: string; disabled?: boolean }[]; value: T; param?: string; head?: ReactNode; children: ReactNode; className?: string }) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [pending, start] = useTransition();
  const pick = (v: T) => {
    const q = new URLSearchParams(search.toString());
    q.set(param, v);
    start(() => router.replace(`${path}?${q.toString()}`, { scroll: false }));
  };
  return (
    <div className={`grid min-w-0 content-start gap-6 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {head}
        <div role="group" aria-label="Période" className="flex gap-4">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={o.disabled}
                onClick={() => !on && pick(o.value)}
                className={`label -mb-px min-h-tap border-b-2 whitespace-nowrap transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div aria-busy={pending} className={`min-w-0 transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)] ${pending ? "opacity-50" : ""}`}>
        {children}
      </div>
    </div>
  );
}

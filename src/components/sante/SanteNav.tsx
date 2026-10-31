"use client";

// Onglets du module Santé (liens), soulignés d'encre comme les Tabs du kit. Chaque partie est une page :
// on en ajoute une en l'ajoutant ici.
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SANTE_PAGES = [
  { href: "/sante", label: "Vue d’ensemble" },
  { href: "/sante/objectifs", label: "Objectifs" },
  { href: "/sante/aujourdhui", label: "Aujourd’hui" },
  { href: "/sante/habitudes", label: "Hors batch" },
  { href: "/sante/entrainement", label: "Entraînement" },
  { href: "/sante/demarrer", label: "Mise en route" },
  { href: "/sante/profil", label: "Profil" },
  { href: "/sante/apple", label: "Apple Santé" },
];

export function SanteNav() {
  const path = usePathname();
  return (
    <nav aria-label="Santé" className="k-noscroll -mx-5 flex gap-6 overflow-x-auto border-b border-line px-5 sm:mx-0 sm:px-0">
      {SANTE_PAGES.map((p) => {
        const on = path === p.href;
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 py-3 text-[15px] font-bold transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] focus-visible:outline-offset-[-2px] ${on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink"}`}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}

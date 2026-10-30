"use client";

// Onglets du module Santé (liens). Chaque partie est une page : on en ajoute une en l'ajoutant ici.
import Link from "next/link";
import { usePathname } from "next/navigation";

export const SANTE_PAGES = [
  { href: "/sante", label: "Vue d'ensemble" },
  { href: "/sante/objectifs", label: "Objectifs" },
  { href: "/sante/aujourdhui", label: "Aujourd'hui" },
  { href: "/sante/habitudes", label: "Hors batch" },
  { href: "/sante/entrainement", label: "Entraînement" },
  { href: "/sante/demarrer", label: "Mise en route" },
  { href: "/sante/profil", label: "Profil" },
  { href: "/sante/apple", label: "Apple Santé" },
];

export function SanteNav() {
  const path = usePathname();
  return (
    <nav aria-label="Santé" className="k-noscroll flex gap-1 overflow-x-auto border-b border-line">
      {SANTE_PAGES.map((p) => {
        const on = path === p.href;
        return (
          <Link key={p.href} href={p.href} aria-current={on ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-[2.5px] px-3 py-2.5 text-[15px] font-semibold transition-colors duration-[var(--dur-quick)] active:scale-100 ${on ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}

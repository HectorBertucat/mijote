"use client";

// Onglets du module Santé (liens), soulignés d’encre comme les Tabs du kit. Chaque partie est une page :
// on en ajoute une en l’ajoutant ici. L’onglet visé s’allume dès le tap, sans attendre la page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export const SANTE_PAGES = [
  { href: "/sante", label: "Vue d’ensemble" },
  { href: "/sante/objectifs", label: "Objectifs" },
  { href: "/sante/aujourdhui", label: "Aujourd’hui" },
  { href: "/sante/habitudes", label: "Hors batch" },
  { href: "/sante/entrainement", label: "Entraînement" },
  { href: "/sante/course", label: "Course" },
  { href: "/sante/demarrer", label: "Mise en route" },
  { href: "/sante/profil", label: "Profil" },
  { href: "/sante/apple", label: "Apple Santé" },
];

export function SanteNav() {
  const path = usePathname();
  const [target, setTarget] = useState<{ href: string; from: string } | null>(null);
  const current = target && target.from === path ? target.href : path;
  return (
    <nav aria-label="Santé" className="k-noscroll -mx-5 flex gap-6 overflow-x-auto border-b border-line px-5 sm:mx-0 sm:px-0">
      {SANTE_PAGES.map((p) => {
        const on = current === p.href || (p.href !== "/sante" && current.startsWith(`${p.href}/`));
        return (
          <Link
            key={p.href}
            href={p.href}
            onClick={(e) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && setTarget({ href: p.href, from: path })}
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

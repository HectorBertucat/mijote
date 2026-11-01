"use client";

// Onglets du module Santé (liens), soulignés d’encre comme les Tabs du kit. Chaque partie est une page :
// on en ajoute une en l’ajoutant ici. L’onglet visé s’allume dès le tap, sans attendre la page. Au téléphone la
// rangée défile : le bord coupé s’estompe, et l’onglet en cours est ramené dans le cadre.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  const nav = useRef<HTMLElement>(null);
  const [fade, setFade] = useState<"start" | "end" | "both" | undefined>();

  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 4;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setFade(start && end ? "both" : start ? "start" : end ? "end" : undefined);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // L’onglet en cours dans le cadre (sans faire défiler la page) : « Profil » ou « Course » sont hors champ au téléphone.
  useEffect(() => {
    const el = nav.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !tab) return;
    const left = tab.offsetLeft;
    if (left < el.scrollLeft || left + tab.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, left - 32);
  }, [path]);

  return (
    <div className="-mx-5 border-b border-line sm:mx-0">
      <nav ref={nav} aria-label="Santé" data-fade={fade} className="k-noscroll k-edge-fade relative -mb-px flex gap-6 overflow-x-auto px-5 sm:px-0">
        {SANTE_PAGES.map((p) => {
          const on = current === p.href || (p.href !== "/sante" && current.startsWith(`${p.href}/`));
          return (
            <Link
              key={p.href}
              href={p.href}
              onClick={(e) => e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && setTarget({ href: p.href, from: path })}
              aria-current={on ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 py-3 text-[15px] font-bold transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] focus-visible:outline-offset-[-2px] ${on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink"}`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

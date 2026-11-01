// Chip (filtre à bascule aria-pressed avec compteur), ChipLink (le même en lien, pour les filtres d’URL) et Tag (étiquette).
// Sans hook : utilisables côté serveur (Chip a besoin d’un composant client seulement pour son onClick).
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

const CHIP = "relative before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] border px-3 text-[14px] font-bold transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)]";
const OFF = "border-line bg-transparent text-ink-2 hover:border-line-strong hover:text-ink";
const ON = "border-inverse bg-inverse text-on-inverse";

/** Classes d’une puce, active ou non (pour un élément maison). */
export function chipClass(active: boolean, className = "") {
  return `${CHIP} ${active ? ON : OFF} ${className}`;
}

function Count({ n, active }: { n?: number; active: boolean }) {
  if (n == null) return null;
  return <span className={`num font-semibold ${active ? "text-[color-mix(in_srgb,var(--c-on-inverse)_65%,transparent)]" : "text-faint"}`}>{n}</span>;
}

/** Puce de filtre : `pressed` (aria-pressed), `count` en chiffres discrets. */
export function Chip({ pressed = false, count, children, className = "", type = "button", ...rest }: { pressed?: boolean; count?: number; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} aria-pressed={pressed} className={chipClass(pressed, className)} {...rest}>
      {children}
      <Count n={count} active={pressed} />
    </button>
  );
}

/** Puce de filtre en lien (filtre porté par l’URL) : `active` met aria-current. */
export function ChipLink({ active = false, count, children, className = "", ...rest }: { active?: boolean; count?: number; children: ReactNode } & ComponentProps<typeof Link>) {
  return (
    <Link aria-current={active ? "true" : undefined} className={chipClass(active, className)} {...rest}>
      {children}
      <Count n={count} active={active} />
    </Link>
  );
}

/** Étiquette discrète (tags d’une recette, ustensile…). `tone="warn"` pour « à relire ». */
export function Tag({ children, tone, className = "" }: { children: ReactNode; tone?: "warn"; className?: string }) {
  const look = tone === "warn" ? "text-warn-ink" : "text-ink-3";
  return <span className={`label inline-flex shrink-0 items-center whitespace-nowrap ${look} ${className}`}>{children}</span>;
}

/** Rangée de puces (retour à la ligne) ; `scroll` la garde sur une ligne qui défile (téléphone). */
export function Chips({ children, scroll = false, className = "" }: { children: ReactNode; scroll?: boolean; className?: string }) {
  if (scroll) return <div className={`k-noscroll -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 ${className}`}>{children}</div>;
  return <div className={`flex flex-wrap gap-2 ${className}`}>{children}</div>;
}

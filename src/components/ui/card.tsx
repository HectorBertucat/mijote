// Card (panneau : surface, filet, sans ombre ; « lift » : le filet se renforce au survol), List et ListRow (lignes
// séparées d’un filet). Sans état. v3 : une page se découpe d’abord par des filets et de l’air ; Card est pour ce
// qui doit vraiment se détacher (panneau latéral, élément cliquable).
import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./icon";

/** Carte du kit. `lift` : se soulève au survol (cartes cliquables) ; `flat` : sans ombre (carte dans un panneau) ; `pad` : marge intérieure. */
export function Card({ as: Tag = "div", lift = false, flat = false, pad = "none", className = "", children, ...rest }: { as?: "div" | "section" | "article" | "li"; lift?: boolean; flat?: boolean; pad?: "none" | "sm" | "md" | "lg"; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  const P = { none: "", sm: "p-3.5", md: "px-5 py-4", lg: "p-6" }[pad];
  return (
    <Tag
      className={`min-w-0 rounded-[14px] border border-line ${flat ? "bg-transparent" : "bg-surface"} ${lift ? "transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-line-strong" : ""} ${P} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Classes d’une carte, pour un <Link> qui doit ressembler à une carte. */
export function cardClass({ lift = true, className = "" }: { lift?: boolean; className?: string } = {}) {
  return `block min-w-0 rounded-[14px] border border-line bg-surface ${lift ? "transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-line-strong" : ""} ${className}`;
}

/** Liste dans une carte : chaque ListRow est séparée par un trait, la dernière non. */
export function List({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "ul" }) {
  return <Tag className={`grid border-t border-line [&>*:last-child]:border-b [&>*:last-child]:border-line ${className}`}>{children}</Tag>;
}

/** Ligne : `lead` (étiquette, case…), `title`, `sub`, `trail` (prix, pastille). Avec `href`, toute la ligne est un lien et un chevron s’ajoute. */
export function ListRow({ lead, title, sub, trail, href, className = "", as: Tag = "div" }: { lead?: ReactNode; title: ReactNode; sub?: ReactNode; trail?: ReactNode; href?: string; className?: string; as?: "div" | "li" }) {
  const inner = (
    <>
      {lead}
      <span className="grid min-w-0 flex-1">
        <span className="font-semibold">{title}</span>
        {sub && <span className="text-[14px] text-ink-2">{sub}</span>}
      </span>
      {trail}
      {href && <Icon name="chev" className="text-faint" />}
    </>
  );
  const row = `flex min-w-0 items-center gap-4 border-b border-line py-4 ${className}`;
  if (href)
    return (
      <Tag className="border-b border-line">
        <Link href={href} className={`${row} -mx-3 border-b-0 rounded-[8px] px-3 hover:bg-surface-2`}>
          {inner}
        </Link>
      </Tag>
    );
  return <Tag className={row}>{inner}</Tag>;
}

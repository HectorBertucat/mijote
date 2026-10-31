// Pièces de mise en page des courses, du placard et des coûts (système « Carnet de marché ») : en-tête au titre
// démesuré, rangée de chiffres serrés séparés par des filets, titre de section à filet fort. Sans état.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

/** Retour vers la page parente : une étiquette, pas un bouton. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="label inline-flex min-h-tap items-center gap-1 text-ink-2 hover:text-ink">
      <Icon name="chev" size="s" className="rotate-180" />
      {children}
    </Link>
  );
}

/** En-tête de page : retour, surtitre, titre (un seul h1), une phrase, et à droite l'action ou les chiffres. */
export function PageHead({ back, kicker, title, size = "display", lead, aside, children }: { back?: ReactNode; kicker?: ReactNode; title: ReactNode; size?: "display" | "h1"; lead?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <header className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-x-6">
      <div className="grid min-w-0 gap-3 lg:col-span-8">
        {back}
        {kicker && <p className="label text-ink-2">{kicker}</p>}
        <h1 className={`${size === "display" ? "text-display" : "text-h1"} break-words`}>{title}</h1>
        {lead && <p className="max-w-[60ch] text-lead text-ink-2">{lead}</p>}
        {children}
      </div>
      {aside && <div className="min-w-0 lg:col-span-4 lg:justify-self-end">{aside}</div>}
    </header>
  );
}

/** Un chiffre lu de loin : valeur en chiffres serrés, unité à part, légende courte dessous. */
export function Figure({ value, unit, label, href, big = false, tone }: { value: ReactNode; unit?: string; label: ReactNode; href?: string; big?: boolean; tone?: "ko" }) {
  const body = (
    <>
      <span className={`num-tight leading-[0.9] ${big ? "text-num-xl" : "text-h1"} ${tone === "ko" ? "text-ko" : ""}`}>
        {value}
        {unit && <span className="ml-1 text-h3 font-semibold">{unit}</span>}
      </span>
      <span className="mt-2 flex items-center gap-1 text-small text-ink-2">
        {label}
        {href && <Icon name="chev" size="s" className="text-ink-3 transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-hover:translate-x-1" />}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="group grid content-start rounded-[8px] hover:text-ink [&:hover_.num-tight]:text-accent">
      {body}
    </Link>
  ) : (
    <div className="grid content-start">{body}</div>
  );
}

/** Rangée de chiffres : filet fort au-dessus, filets fins entre eux. */
export function Figures({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rule-strong-top grid grid-cols-2 gap-y-6 pt-6 sm:flex sm:flex-wrap sm:gap-x-12 [&>*]:sm:border-l [&>*]:sm:border-line [&>*]:sm:pl-6 [&>*:first-child]:sm:border-l-0 [&>*:first-child]:sm:pl-0 ${className}`}>{children}</div>;
}

/** Titre de section : étiquette ou h2, compteur à droite, filet fort dessous. */
export function SectionHead({ id, title, count, action, as = "h2" }: { id?: string; title: ReactNode; count?: ReactNode; action?: ReactNode; as?: "h2" | "label" }) {
  return (
    <div className="flex min-h-tap items-end justify-between gap-4 border-b border-line-strong pb-3">
      {as === "h2" ? (
        <h2 id={id} className="text-h2">
          {title}
        </h2>
      ) : (
        <h2 id={id} className="label text-ink">
          {title}
        </h2>
      )}
      <span className="flex items-center gap-3">
        {count != null && <span className="num-tight text-small text-ink-2">{count}</span>}
        {action}
      </span>
    </div>
  );
}

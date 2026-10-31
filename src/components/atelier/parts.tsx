// Briques de l’atelier et de l’import (DA v3 « Carnet de marché ») : en-tête de page (retour, grand titre, chapeau),
// titre de section à filet, notes en lignes nettes (avertissements, vérifications) et coût de l’IA en pied.
// Sans état : utilisables côté serveur.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";

/** En-tête : lien de retour discret, titre h1, chapeau, et une action à droite (abandonner un brouillon). */
export function PageHead({ back, title, lead, aside }: { back?: { href: string; label: string }; title: ReactNode; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="grid gap-4">
      {back && (
        <Link href={back.href} className="-mx-1 inline-flex w-fit items-center gap-1 rounded-[4px] px-1 text-small font-bold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <h1 className="text-h1">{title}</h1>
        {aside}
      </div>
      {lead && <p className="max-w-[52ch] text-lead text-ink-2">{lead}</p>}
    </header>
  );
}

/** Titre de section : filet fort au-dessus, h2, et une précision à droite (compte, état). */
export function SectionHead({ children, aside, as: H = "h2" }: { children: ReactNode; aside?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-line-strong pt-4">
      <H className={H === "h2" ? "text-h2" : "text-h3"}>{children}</H>
      {aside && <div className="text-small text-ink-2">{aside}</div>}
    </div>
  );
}

export type NoteTone = "warn" | "ko" | "info" | "ok";
const NOTE: Record<NoteTone, { icon: IconName; ic: string }> = {
  warn: { icon: "alert", ic: "text-warn" },
  ko: { icon: "x", ic: "text-ko" },
  info: { icon: "info", ic: "text-faint" },
  ok: { icon: "check", ic: "text-ok" },
};

/** Notes en lignes nettes : une icône de la couleur du verdict (avec sa forme), le texte en encre, un filet entre chaque. */
export function Notes({ items, title, className = "" }: { items: { tone: NoteTone; text: ReactNode; key?: string }[]; title?: ReactNode; className?: string }) {
  if (!items.length) return null;
  return (
    <div className={`grid gap-2 ${className}`}>
      {title && <p className="label text-faint">{title}</p>}
      <ul className="grid border-t border-line">
        {items.map((n, i) => (
          <li key={n.key ?? i} className="flex items-start gap-3 border-b border-line py-3 text-body">
            <Icon name={NOTE[n.tone].icon} className={`mt-1 shrink-0 ${NOTE[n.tone].ic}`} label={n.tone === "ko" ? "Bloquant" : n.tone === "warn" ? "À relire" : undefined} />
            <span className="min-w-0 flex-1">{n.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ce que l’IA coûte, en pied de formulaire : petit, gris, en chiffres. */
export function CostLine({ children }: { children: ReactNode }) {
  return <p className="num text-small text-faint">{children}</p>;
}

/** Ce qui va se passer, en trois temps numérotés (à la place d’un état vide). */
export function HowItGoes({ title, steps }: { title: string; steps: ReactNode[] }) {
  return (
    <div className="grid content-start gap-4 border-t border-line-strong pt-4">
      <p className="label text-faint">{title}</p>
      <ol className="grid gap-4">
        {steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[32px_minmax(0,1fr)] items-baseline gap-3">
            <span className="num-tight text-h2 text-faint">{i + 1}</span>
            <span className="text-body text-ink-2">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

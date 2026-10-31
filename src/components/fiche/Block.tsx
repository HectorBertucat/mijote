// Morceaux de mise en page d'une fiche (DA « Carnet de marché ») : section à filet (titre à gauche sur 4
// colonnes, contenu sur 8 au bureau), titre de colonne, « Comment c'est calculé » replié. Sans état.
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

/** Titre d'une section : filet fort au-dessus, 24 d'air avant le contenu. `aside` : un repère à droite. */
export function BlockTitle({ children, aside, id }: { children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 lg:border-t lg:border-line-strong lg:pt-6">
      <h2 id={id} className="text-h2">
        {children}
      </h2>
      {aside && <span className="text-small text-ink-2">{aside}</span>}
    </div>
  );
}

/** Section du bas de fiche : au bureau, titre et repère sur 4 colonnes, contenu sur 8 (rythme 4/8). */
export function FicheBlock({ title, aside, label, children, className = "" }: { title: ReactNode; aside?: ReactNode; label?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={`rule-strong-top grid gap-6 pt-6 lg:grid-cols-12 ${className}`}>
      <div className="grid content-start gap-2 lg:col-span-4">
        <h2 className="text-h2">{title}</h2>
        {aside && <div className="text-small text-ink-2">{aside}</div>}
      </div>
      <div className="min-w-0 lg:col-span-8">{children}</div>
    </section>
  );
}

/** Les explications de calcul quittent l'écran : repliées derrière ce lien. */
export function HowCalculated({ children, title = "Comment c’est calculé", className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <details className={`group rule-top ${className}`}>
      <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-small font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open:rotate-90" />
        {title}
      </summary>
      <div className="grid gap-3 pb-4 pl-6 text-small text-ink-2">{children}</div>
    </details>
  );
}

// Morceaux de mise en page d'une fiche (DA « Carnet de marché ») : section à filet (titre à gauche sur 4
// colonnes, contenu sur 8 au bureau), titre de colonne, nappe vichy, « Comment c'est calculé » replié. Sans état.
import type { CSSProperties, ReactNode } from "react";
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

/** La nappe vichy à la couleur du plat : la bande du haut de la fiche. */
export function Vichy({ color, className = "" }: { color: string; className?: string }) {
  const stripe = "color-mix(in srgb, var(--rc) 46%, transparent)";
  return (
    <span
      aria-hidden
      className={`block bg-[color-mix(in_srgb,var(--rc)_14%,var(--c-bg))] ${className}`}
      style={
        {
          "--rc": color,
          backgroundImage: `linear-gradient(90deg, ${stripe} 50%, transparent 50%), linear-gradient(${stripe} 50%, transparent 50%)`,
          backgroundSize: "24px 24px",
        } as CSSProperties
      }
    />
  );
}

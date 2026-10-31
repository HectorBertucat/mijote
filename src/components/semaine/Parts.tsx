// Pièces de mise en page des écrans Semaine et Composer, au système « Carnet de marché » : chiffres du résumé,
// avertissement en ligne sobre, section repliée sous un filet, barre d'action collante. Sans état.
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";

/** Résumé en chiffres : trois colonnes au téléphone, empilés en grand dans la colonne étroite du bureau (`stack`). */
export function Figures({ items, stack = false, className = "" }: { items: { value: ReactNode; label: ReactNode }[]; stack?: boolean; className?: string }) {
  return (
    <dl className={`grid grid-cols-3 gap-x-4 ${stack ? "lg:grid-cols-1" : ""} ${className}`}>
      {items.map((it, i) => (
        <div key={i} className={`flex min-w-0 flex-col-reverse gap-1 border-t border-line-strong pt-3 ${stack ? "lg:flex-row-reverse lg:items-baseline lg:justify-between lg:gap-4 lg:py-4" : "pb-1"}`}>
          <dt className="text-small text-ink-2">{it.label}</dt>
          <dd className={`num-tight whitespace-nowrap text-h1 text-ink lg:text-num-xl`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Avertissement : une ligne sous un filet, une icône, une phrase ; `action` à droite (ou dessous au téléphone). */
const TONE = { warn: "text-warn", ko: "text-ko", info: "text-ink-2" } as const;
export function Notice({ icon = "alert", tone = "warn", children, action }: { icon?: IconName; tone?: keyof typeof TONE; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-line py-4">
      <Icon name={icon} size="s" className={`mt-[3px] shrink-0 ${TONE[tone]}`} />
      <p className="min-w-0 flex-1 basis-[12rem] text-small text-ink">{children}</p>
      {action && <div className="shrink-0 pl-7 sm:pl-0">{action}</div>}
    </li>
  );
}

/** Section repliée : titre, ce qu'elle contient en quelques mots, chevron ; le contenu glisse de 8 px en s'ouvrant. */
export function Fold({ id, title, aside, children, open = false }: { id: string; title: string; aside?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details id={id} className="group scroll-mt-24 border-t border-line" open={open}>
      <summary className="flex min-h-tap cursor-pointer list-none flex-wrap items-baseline gap-x-6 gap-y-1 py-6 [&::-webkit-details-marker]:hidden">
        <h2 className="text-h3 font-bold tracking-[-0.015em] [font-stretch:100%]">{title}</h2>
        {aside && <span className="min-w-0 flex-1 text-small text-ink-2">{aside}</span>}
        <Icon name="chev" className="ml-auto self-center text-ink-3 transition-[transform,color] duration-[var(--dur-2)] ease-[var(--ease-out)] group-hover:text-ink group-open:rotate-90" />
      </summary>
      <div className="animate-pop pb-12 motion-reduce:animate-none">{children}</div>
    </details>
  );
}

/** « Comment c'est calculé » : l'explication quitte l'écran, repliée sous un lien discret. */
export function HowTo({ children, label = "Comment c’est calculé" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group/how">
      <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-2 text-small font-bold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        {label}
        <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open/how:rotate-90" />
      </summary>
      <div className="grid max-w-[68ch] gap-2 pb-2 text-small text-ink-2">{children}</div>
    </details>
  );
}

/**
 * Barre d'action collante : le seul élément qui flotte (--sh-float). Elle dit où on en est (`title`, `sub`)
 * et porte l'action suivante. Au téléphone, au-dessus de la barre d'onglets ; au bureau, alignée sur la colonne
 * large de la grille 4/8 (`wide`).
 */
export function Dock({ title, sub, children, wide = true }: { title: ReactNode; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 mt-12 sm:bottom-6 ${wide ? "lg:ml-[calc(33.333%+8px)]" : ""}`}>
      <div className="flex items-center gap-4 rounded-[14px] border border-line bg-surface py-3 pl-4 pr-3 shadow-float sm:pl-6">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="num-tight truncate text-h3 leading-[1.2] text-ink">{title}</p>
          {sub && <p className="truncate text-small text-ink-2">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

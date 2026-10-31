// Briques des réglages et de la mise en route (DA v3 « Carnet de marché ») : section de document à filet (titre à
// gauche, contenu à droite sur bureau), écran de question (repère, grand titre, aide), aide concrète (ouverte en marge
// sur bureau, repliée sur téléphone), choix en lignes, progression discrète. Sans état : utilisables côté serveur.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";

/** Section d'une page-document : filet fort, titre et chapeau sur 4 colonnes, contenu sur 8. */
export function DocSection({ id, title, lead, children, className = "" }: { id: string; title: ReactNode; lead?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`grid gap-6 border-t border-line-strong pt-6 lg:grid-cols-12 lg:gap-x-6 ${className}`}>
      <div className="grid content-start gap-3 lg:col-span-4">
        <h2 id={id} className="text-h2">
          {title}
        </h2>
        {lead && <p className="max-w-[40ch] text-small text-ink-2">{lead}</p>}
      </div>
      <div className="min-w-0 lg:col-span-8">{children}</div>
    </section>
  );
}

/** Progression discrète : un trait par étape (fait = encre, en cours = cocotte, à venir = filet). */
export function Ticks({ total, at, label }: { total: number; at: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.min(total, at + 1)} className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-0.5 flex-1 transition-colors duration-[var(--dur-2)] ease-[var(--ease-out)] ${i < at ? "bg-ink" : i === at ? "bg-accent" : "bg-line"}`} />
      ))}
    </div>
  );
}

/** En-tête d'un écran de question : repère (« Cuisine · 2 sur 7 »), la question en grand, une phrase d'aide. */
export function QuestionHead({ kicker, title, hint, as: H = "h2", size = "page" }: { kicker?: ReactNode; title: ReactNode; hint?: ReactNode; as?: "h1" | "h2" | "h3"; size?: "page" | "section" }) {
  return (
    <header className="grid gap-3">
      {kicker && <p className="label num text-faint">{kicker}</p>}
      <H className={size === "page" ? "text-h1" : "text-h3"}>{title}</H>
      {hint && <p className={`max-w-[52ch] text-ink-2 ${size === "page" ? "text-lead" : "text-small"}`}>{hint}</p>}
    </header>
  );
}

/** Aide concrète (« Comment savoir ? ») : en marge et ouverte sur bureau, repliée sous la question sur téléphone. */
export function HowTo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <details className="group border-t border-line lg:hidden">
        <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-body font-bold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] group-open:rotate-90" />
          {title}
        </summary>
        <div className="grid gap-3 pb-4 pl-6 text-body text-ink-2">{children}</div>
      </details>
      <div className="hidden content-start gap-3 border-t border-line-strong pt-4 lg:grid">
        <p className="label text-faint">{title}</p>
        <div className="grid gap-3 text-body text-ink-2">{children}</div>
      </div>
    </>
  );
}

/** Choix en ligne (doigt d'abord) : repère rond à gauche, titre, aide ; la ligne est séparée de la suivante par un filet. */
export function ChoiceRow({ on, title, hint, icon, art, ...rest }: { on: boolean; title: ReactNode; hint?: ReactNode; icon?: IconName; art?: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title">) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className="group flex min-h-kitchen w-full items-center gap-4 px-3 py-3 text-left hover:bg-surface-2 active:bg-surface-2"
      {...rest}
    >
      <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] ${on ? "border-accent bg-accent text-on-accent" : "border-line-strong group-hover:border-faint"}`}>
        {on && <Icon name="check" size={14} strokeWidth={2.8} />}
      </span>
      {art ?? (icon && <Icon name={icon} size="l" className={on ? "text-ink" : "text-faint"} />)}
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-body font-bold">{title}</span>
        {hint && <span className="text-small text-ink-2">{hint}</span>}
      </span>
    </button>
  );
}

/** Liste de choix : un filet entre chaque ligne. */
export function Choices({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid divide-y divide-line border-y border-line ${className}`}>{children}</div>;
}

/** Bloc d'un récipient ou d'un réglage dans un écran : filet au-dessus, titre, contenu. */
export function Block({ title, icon, aside, children }: { title?: ReactNode; icon?: IconName; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-4 border-t border-line py-4">
      {title && (
        <div className="flex min-h-9 flex-wrap items-center gap-3">
          {icon && <Icon name={icon} className="text-faint" />}
          <p className="text-body font-bold">{title}</p>
          {aside && <div className="ml-auto flex items-center gap-3">{aside}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** Ligne de réglage : contrôle à gauche, ce qu'il règle à droite. */
export function Line({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body">{children}</div>;
}

"use client";

// Un plat à choisir (Semaine, Composer) : grande entrée qui se coche, l'étiquette du plat, son nom, deux ou trois faits.
// La coche suit tout de suite le geste (optimiste) pendant que le serveur recalcule ; le retour d'état est la seule
// animation (pas de rebond : on coche souvent). Visuel du plat : la boîte dessinée (DishBox), rendue côté serveur
// et passée en `visual`.
import Link, { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type Look = { name: string; visual: ReactNode; facts: ReactNode; size?: "lg" | "md" };

const BOX = "relative flex h-full w-full min-w-0 items-center gap-4 rounded-[14px] border text-left transition-[background-color,border-color] duration-[var(--dur-1)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
// Choisi : filet cocotte de 2 px (contour peint au-dessus de la bande dessinée, sans décaler la mise en page).
const ON = "border-accent bg-surface outline outline-2 -outline-offset-2 outline-accent";
const OFF = "border-line hover:border-line-strong hover:bg-surface active:bg-surface-2";

// Grande entrée (Semaine) : en ligne au téléphone ; à partir de la tablette, carte verticale, la boîte sur sa
// nappe en bande pleine largeur, la coche dans le coin.
const PAD = { lg: "p-4 sm:flex-col sm:items-stretch sm:gap-0 sm:overflow-hidden sm:p-0", md: "p-3" } as const;

function Inner({ name, visual, facts, size = "lg", on, busy }: Look & { on: boolean; busy: boolean }) {
  const lg = size === "lg";
  return (
    <>
      {visual}
      <span className={`grid min-w-0 flex-1 content-start gap-1 ${lg ? "sm:p-4 sm:pr-12" : ""}`}>
        <span className={`font-display font-bold leading-[1.2] tracking-[-0.015em] text-ink [font-stretch:100%] ${size === "lg" ? "text-h3" : "text-body"}`}>{name}</span>
        <span className="text-small text-ink-2">{facts}</span>
      </span>
      <Tick on={on} busy={busy} className={lg ? "sm:absolute sm:right-3 sm:top-3" : ""} />
    </>
  );
}

/** La coche : case de 28 px, remplie de cocotte une fois choisie, le trait se trace. */
function Tick({ on, busy, className = "" }: { on: boolean; busy: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid size-7 shrink-0 place-items-center rounded-[8px] border-2 transition-[background-color,border-color] duration-[var(--dur-1)] ease-[var(--ease-out)] ${on ? "border-accent bg-accent" : "border-line-strong bg-surface"} ${busy ? "opacity-70" : ""} ${className}`}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="var(--c-on-accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray={22} style={{ strokeDashoffset: on ? 0 : 22, transition: "stroke-dashoffset var(--dur-2) var(--ease-out)" } as CSSProperties} />
      </svg>
    </span>
  );
}

/** Dans un <form> d'action serveur (Semaine) : le bouton d'envoi est toute l'entrée. */
export function PickButton({ on, disabled = false, label, ...look }: Look & { on: boolean; disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  const shown = pending ? !on : on;
  return (
    <button type="submit" aria-pressed={shown} aria-busy={pending || undefined} aria-label={label} disabled={disabled || pending} className={`${BOX} ${PAD[look.size ?? "lg"]} ${shown ? ON : OFF} disabled:cursor-default ${disabled ? "opacity-40" : ""}`}>
      <Inner {...look} on={shown} busy={pending} />
    </button>
  );
}

/** En lien (Composer : la sélection vit dans l'adresse). */
export function PickLink({ on, href, label, ...look }: Look & { on: boolean; href: string; label: string }) {
  return (
    <Link href={href} scroll={false} aria-label={label} className={`${BOX} ${PAD[look.size ?? "lg"]} ${on ? ON : OFF}`}>
      <LinkInner {...look} on={on} />
    </Link>
  );
}

function LinkInner(props: Look & { on: boolean }) {
  const { pending } = useLinkStatus();
  return <Inner {...props} on={pending ? !props.on : props.on} busy={pending} />;
}

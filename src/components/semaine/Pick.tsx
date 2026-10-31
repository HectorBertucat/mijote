"use client";

// Un plat à choisir (Semaine, Composer) : grande entrée qui se coche, l'étiquette du plat, son nom, deux ou trois faits.
// La coche suit tout de suite le geste (optimiste) pendant que le serveur recalcule ; le retour d'état est la seule
// animation (pas de rebond : on coche souvent). Visuel du plat : RecipeTile du kit, en attendant la boîte dessinée.
import Link, { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { RecipeTile } from "@/components/ui";

type Look = { name: string; color: string; facts: ReactNode; size?: "lg" | "md" };

const BOX = "relative flex w-full min-w-0 items-center gap-4 rounded-[14px] border text-left transition-[background-color,border-color,box-shadow] duration-[var(--dur-1)] ease-[var(--ease-out)]";
const ON = "border-accent bg-surface shadow-[inset_0_0_0_1px_var(--c-accent)]";
const OFF = "border-line hover:border-line-strong hover:bg-surface active:bg-surface-2";

function Inner({ name, color, facts, size = "lg", on, busy }: Look & { on: boolean; busy: boolean }) {
  return (
    <>
      <RecipeTile color={color} name={name} size={size} />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className={`font-display font-bold leading-[1.2] tracking-[-0.015em] text-ink [font-stretch:100%] ${size === "lg" ? "text-h3" : "text-body"}`}>{name}</span>
        <span className="text-small text-ink-2">{facts}</span>
      </span>
      <Tick on={on} busy={busy} />
    </>
  );
}

/** La coche : case de 28 px, remplie de cocotte une fois choisie, le trait se trace. */
function Tick({ on, busy }: { on: boolean; busy: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-7 shrink-0 place-items-center rounded-[8px] border-2 transition-[background-color,border-color] duration-[var(--dur-1)] ease-[var(--ease-out)] ${on ? "border-accent bg-accent" : "border-line-strong bg-surface"} ${busy ? "opacity-70" : ""}`}
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
    <button type="submit" aria-pressed={shown} aria-busy={pending || undefined} aria-label={label} disabled={disabled || pending} className={`${BOX} ${look.size === "md" ? "p-3" : "p-4"} ${shown ? ON : OFF} disabled:cursor-default ${disabled ? "opacity-40" : ""}`}>
      <Inner {...look} on={shown} busy={pending} />
    </button>
  );
}

/** En lien (Composer : la sélection vit dans l'adresse). */
export function PickLink({ on, href, label, ...look }: Look & { on: boolean; href: string; label: string }) {
  return (
    <Link href={href} scroll={false} aria-label={label} className={`${BOX} ${look.size === "md" ? "p-3" : "p-4"} ${on ? ON : OFF}`}>
      <LinkInner {...look} on={on} />
    </Link>
  );
}

function LinkInner(props: Look & { on: boolean }) {
  const { pending } = useLinkStatus();
  return <Inner {...props} on={pending ? !props.on : props.on} busy={pending} />;
}

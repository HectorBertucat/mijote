// Briques de mise en page « carnet » du module Santé (docs/design/systeme.md) : chiffre clé démesuré,
// section délimitée par un filet, explication de calcul repliée, verdict avec son mot. Sans état,
// utilisables dans une page serveur.
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";

/** Espace insécable (avant une unité, « : », « ? ») et fine insécable (dans « »). */
export const NB = " ";
export const NNB = " ";
/** « 1 950 kcal » : séparateur de milliers et unité collée par une insécable. */
export const qty = (n: number, unit: string, digits = 0) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NB}${unit}`;
/** « de Sam », « d’Alex » : l’élision devant une voyelle ou un h. */
export const de = (name: string) => (/^[aeiouyhàâéèêîôû]/i.test(name) ? `d’${name}` : `de ${name}`);

/** Nombre signé avec un vrai moins (−0,19). */
export const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** Chiffre clé : repère en étiquette, le chiffre en Archivo serrée, l'unité plus petite, une ligne de contexte. */
export function KeyFigure({ label, value, unit, sub, size = "xl", tone, className = "" }: { label: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode; size?: "display" | "xl" | "lg"; tone?: "ok" | "warn" | "ko"; className?: string }) {
  const big = { display: "text-[clamp(4.5rem,3rem+7vw,8.5rem)] leading-[0.82]", xl: "text-num-xl", lg: "text-[clamp(2.5rem,2rem+1.5vw,3rem)] leading-[0.9]" }[size];
  return (
    <div className={`grid min-w-0 content-start gap-3 ${className}`}>
      <span className="label text-ink-2">{label}</span>
      <b className={`num-tight block whitespace-nowrap ${big} ${tone ? TONE_TEXT[tone] : "text-ink"}`}>
        {value}
        {unit && <span className="ml-2 align-baseline text-[0.3em] font-[650] tracking-normal text-ink-2 [font-stretch:100%]">{unit}</span>}
      </b>
      {sub != null && <span className="text-small text-ink-2">{sub}</span>}
    </div>
  );
}

const TONE_TEXT = { ok: "text-ok", warn: "text-warn", ko: "text-ko" } as const;
const TONE_ICON: Record<"ok" | "warn" | "ko" | "idle", IconName> = { ok: "check", warn: "clock", ko: "x", idle: "info" };

/** Verdict : une forme et un mot, la couleur réservée seulement si c'en est un (ok, warn, ko). */
export function Verdict({ tone, children, className = "" }: { tone: "ok" | "warn" | "ko" | "idle"; children: ReactNode; className?: string }) {
  const color = tone === "idle" ? "text-ink-2" : `${TONE_TEXT[tone]}`;
  return (
    <span className={`label inline-flex items-center gap-1 ${color} ${className}`}>
      <Icon name={TONE_ICON[tone]} size={14} strokeWidth={2.6} />
      {children}
    </span>
  );
}

/** Section de page : un filet fort au-dessus, le titre, une action à droite, puis 24 px d'air. */
export function Section({ title, id, aside, children, className = "", level = 2 }: { title: ReactNode; id?: string; aside?: ReactNode; children: ReactNode; className?: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={id} className={`grid min-w-0 content-start gap-6 border-t border-line-strong pt-4 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <H id={id} className={level === 2 ? "text-h2" : "text-h3"}>
          {title}
        </H>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Les explications de calcul quittent l'écran : repliées derrière « Comment c'est calculé ». */
export function HowCalc({ children, title = "Comment c’est calculé", className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <details className={`group text-small text-ink-2 ${className}`}>
      <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-[4px] font-bold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-open:rotate-90" />
        {title}
      </summary>
      <div className="grid max-w-[62ch] gap-2 pb-2 pl-6 motion-safe:group-open:animate-[fade-in_var(--dur-2)_var(--ease-out)]">{children}</div>
    </details>
  );
}

/** Note dans le fil de la page (remplace l'encadré coloré) : un filet à gauche, un titre, une action. */
export function Note({ title, children, action, tone = "idle" }: { title: ReactNode; children?: ReactNode; action?: ReactNode; tone?: "idle" | "warn" | "accent" }) {
  const bar = { idle: "border-line-strong", warn: "border-warn", accent: "border-accent" }[tone];
  return (
    <div className={`flex flex-wrap items-center justify-between gap-4 border-l-2 py-1 pl-4 ${bar}`}>
      <div className="grid min-w-0 max-w-[62ch] gap-1">
        <b className="text-body">{title}</b>
        {children && <span className="text-small text-ink-2">{children}</span>}
      </div>
      {action}
    </div>
  );
}

/** Ligne de définition : repère à gauche, valeur à droite, filet dessous. */
export function Row({ k, children, className = "" }: { k: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-baseline gap-4 border-b border-line py-3 ${className}`}>
      <dt className="text-small text-ink-2">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

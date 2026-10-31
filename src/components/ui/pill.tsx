// Pill : pastille d'état, toujours couleur + icône + mot (ok / warn / ko / idle). Plus les aides de verdict. Sans état.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type Tone = "ok" | "warn" | "ko";
export type PillTone = Tone | "idle";

const LOOK: Record<PillTone, string> = {
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-warn-soft text-warn-ink",
  ko: "bg-ko-soft text-ko-ink",
  idle: "bg-surface-2 text-ink-2",
};
/** Icône par défaut de chaque état : coche, horloge, croix, attente. */
export const TONE_ICON: Record<PillTone, IconName> = { ok: "check", warn: "clock", ko: "x", idle: "refresh" };
/** Classe de texte d’une valeur colorée par son verdict (chiffres kcal, protéines…). */
export const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", ko: "text-ko" };

/** Verdict nutrition du code (`ok` / `low` / `high`, cf. verdictFor) → ton du kit. */
export function verdictTone(v: "ok" | "low" | "high"): Tone {
  return v === "ok" ? "ok" : v === "low" ? "warn" : "ko";
}
/** Mot du verdict nutrition : dans la cible, sous la cible, au-dessus. */
export function verdictWord(v: "ok" | "low" | "high"): string {
  return v === "ok" ? "dans la cible" : v === "low" ? "sous la cible" : "au-dessus";
}

/** Pastille d’état. `dot` : rond avec l’icône seule (le mot passe en title et aria-label, obligatoire via `children`). */
export function Pill({ tone, children, icon, dot = false, className = "" }: { tone: PillTone; children: ReactNode; icon?: IconName; dot?: boolean; className?: string }) {
  const ic = <Icon name={icon ?? TONE_ICON[tone]} size={14} strokeWidth={2.4} />;
  if (dot) {
    const word = typeof children === "string" ? children : undefined;
    return (
      <span title={word} role="img" aria-label={word} className={`inline-grid size-[22px] shrink-0 place-items-center rounded-full ${LOOK[tone]} ${className}`}>
        {ic}
      </span>
    );
  }
  return <span className={`inline-flex h-6 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full pl-1.5 pr-2 text-[13px] font-semibold ${LOOK[tone]} ${className}`}>{ic}{children}</span>;
}

// La boîte de verre dessinée (signature « La boîte », docs/design/systeme.md) aux couleurs du plat :
// couvercle plein, contenu teinté, étiquette de travers. Remplace le monogramme dans le frigo et la
// session. `frozen` : un givre sur le couvercle. Sans état.
import type { CSSProperties } from "react";

export function BoxGlyph({ color, size = 48, frozen = false, className = "" }: { color: string; size?: number; frozen?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 56 44" width={size} height={(size * 44) / 56} aria-hidden className={`shrink-0 ${className}`} style={{ "--bx": color } as CSSProperties}>
      <rect x="4" y="12" width="48" height="29" rx="6" fill="var(--i-glass)" stroke="var(--i-line)" strokeWidth="2.2" />
      <rect x="8" y="22" width="40" height="15" rx="3" fill="color-mix(in srgb, var(--bx) 62%, var(--i-paper))" />
      <rect x="2" y="6" width="52" height="8" rx="3" fill="var(--bx)" stroke="var(--i-line)" strokeWidth="2.2" />
      <rect x="15" y="25" width="20" height="7" rx="1" fill="var(--i-label)" transform="rotate(-4 25 28)" />
      {frozen && <path d="M14 10h4M26 10h4M38 10h4" stroke="var(--i-paper)" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}

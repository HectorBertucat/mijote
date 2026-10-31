// Macro (gros chiffre kcal / protéines / €, coloré selon le verdict), Gauge (jauge nutrition : piste, zone cible hachurée, valeur colorée selon le verdict) et DayBars (barres par jour + ligne cible). Sans état.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { TONE_ICON, TONE_TEXT, type Tone } from "./pill";

const FILL: Record<Tone | "none", string> = { ok: "bg-ok", warn: "bg-warn", ko: "bg-ko", none: "bg-ink" };
const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

/** Jauge. `max` = bout de la piste ; `target` = [bas, haut] (haut omis = « au moins ») ; `tone` = verdict déjà calculé (le kit ne juge pas) ; `left`/`right` = légende sous la piste ; `before` = repère fin de l'ancienne valeur (avant → après). */
export function Gauge({ label, value, unit, max, target, tone, left, right, display, before, className = "" }: { label: ReactNode; value: number; unit?: string; max: number; target?: [number, number?]; tone?: Tone; left?: ReactNode; right?: ReactNode; display?: ReactNode; before?: number | null; className?: string }) {
  const [lo, hi] = target ?? [];
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-[14px]">{label}</b>
        <span className={`font-display text-[22px] font-[750] leading-none tabular-nums ${tone ? TONE_TEXT[tone] : ""}`}>
          {display ?? Math.round(value)}
          {unit && <small className="ml-0.5 text-[13px] font-semibold text-ink-2">{unit}</small>}
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === "string" ? label : undefined}>
        {lo != null && <span className="k-zone absolute inset-y-0" style={{ left: pct(lo, max), width: hi != null ? pct(hi - lo, max) : `calc(100% - ${pct(lo, max)})` }} />}
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-[var(--dur-slow)] ease-[var(--ease-out)] ${FILL[tone ?? "none"]}`} style={{ width: pct(value, max) }} />
        {before != null && <span title="avant" className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink-2" style={{ left: pct(before, max) }} />}
      </div>
      {(left || right) && (
        <div className="flex justify-between gap-2 text-[12px] tabular-nums text-faint">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  );
}

export type DayBar = { label: string; value: number | null; tone?: Tone; title?: string };

/** Barres par jour (L M M J V S D). `max` = haut du graphe ; `target` trace une ligne pointillée ; `value: null` = jour non renseigné (barre grise basse). */
export function DayBars({ days, max, target, height = 76, className = "" }: { days: DayBar[]; max: number; target?: number; height?: number; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="grid items-end gap-1.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, height }}>
        {days.map((d, i) => (
          <div key={i} className="grid h-full justify-items-center gap-1 text-[11px] text-faint" style={{ gridTemplateRows: "1fr auto" }} title={d.title}>
            <i
              className={`relative w-full max-w-[22px] self-end rounded-t-[4px] rounded-b-[2px] ${d.value == null ? "bg-line" : FILL[d.tone ?? "none"]}`}
              style={{ height: d.value == null ? "20%" : pct(d.value, max) }}
            />
            {d.label}
          </div>
        ))}
      </div>
      {target != null && <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-faint" style={{ bottom: `calc(${pct(target, max)} * ${(height - 20) / height} + 20px)` }} />}
    </div>
  );
}

/** Gros chiffre condensé (kcal, g, €) avec son unité et une légende ; `tone` colore le chiffre et ajoute l’icône du verdict devant la légende (`icon={null}` pour l’enlever). */
export function Macro({ value, unit, sub, tone, icon, size = "md", className = "" }: { value: ReactNode; unit?: string; sub?: ReactNode; tone?: Tone; icon?: IconName | null; size?: "md" | "lg"; className?: string }) {
  const ic = icon === null ? null : (icon ?? (tone ? TONE_ICON[tone] : undefined));
  return (
    <div className={`grid ${className}`}>
      <b className={`font-display font-extrabold leading-none tabular-nums tracking-[-0.02em] [font-stretch:85%] ${size === "lg" ? "text-[44px]" : "text-[30px]"} ${tone ? TONE_TEXT[tone] : ""}`}>
        {value}
        {unit && <small className="ml-0.5 text-[14px] font-[650] [font-stretch:100%]">{unit}</small>}
      </b>
      {sub != null && (
        <span className="mt-1 flex items-center gap-1 text-[12px] text-ink-2">
          {ic && <Icon name={ic} size="s" />}
          {sub}
        </span>
      )}
    </div>
  );
}

/** Rangée de Macro alignées sur la ligne de base. */
export function MacroRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-baseline gap-x-[18px] gap-y-2 ${className}`}>{children}</div>;
}

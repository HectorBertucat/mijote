// Lanes : frise des ressources d'une session (four, foyers, planche) — une piste par ressource, une barre par étape,
// à la couleur de sa recette ; `clash` cerne une barre en rouge (conflit). Axe des minutes en dessous. Sans état.
import type { CSSProperties } from "react";
import { recipeVar, type RecipeColor } from "./recipe";

export type LaneBar = { from: number; to: number; color: RecipeColor; clash?: boolean; title?: string };
export type Lane = { label: string; bars: LaneBar[] };

const tick = (m: number) => (m === 0 ? "0" : m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`);

/** Frise. `total` = minutes de l'axe ; `step` = pas des graduations (30 min par défaut, 60 au-delà de 4 h). */
export function Lanes({ lanes, total, step, className = "" }: { lanes: Lane[]; total: number; step?: number; className?: string }) {
  const span = Math.max(1, total);
  const st = step ?? (span > 240 ? 60 : 30);
  const ticks = Array.from({ length: Math.floor(span / st) + 1 }, (_, i) => i * st);
  const pct = (m: number) => `${Math.max(0, Math.min(100, (m / span) * 100))}%`;
  return (
    <div className={`grid grid-cols-[92px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 text-[12px] sm:grid-cols-[110px_minmax(0,1fr)] ${className}`}>
      {lanes.map((l) => (
        <div key={l.label} className="contents">
          <span className="truncate font-semibold text-ink-2">{l.label}</span>
          <div className="relative h-[22px] rounded-[5px] bg-surface-2">
            {l.bars.map((b, i) => (
              <i
                key={i}
                title={b.title}
                className={`absolute inset-y-0.5 min-w-1 rounded-[4px] bg-[var(--rc)] ${b.clash ? "outline-2 outline-offset-1 outline-ko" : ""}`}
                style={{ "--rc": recipeVar(b.color), left: pct(b.from), width: `calc(${pct(b.to)} - ${pct(b.from)})` } as CSSProperties}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="relative col-start-2 h-4 text-[11px] tabular-nums text-faint" aria-hidden>
        {ticks.map((m, i) => (
          <span key={m} className={`absolute top-0 whitespace-nowrap ${i === 0 ? "" : i === ticks.length - 1 && m >= span - st / 2 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: pct(m) }}>
            {tick(m)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Histogramme horizontal (rendu serveur, sans interaction : chaque valeur est écrite au bout de sa barre).
// Pour une répartition par catégorie ordonnée ou non : temps par type de séance, temps dans chaque zone
// cardiaque. Barre de 12 px, bout arrondi à droite, base carrée à gauche ; « au trait » (`hollow`) pour ce qui
// est à part (la marche au milieu des zones).
import type { ReactNode } from "react";

export interface HBarRow {
  label: ReactNode;
  value: number;
  /** Ce qui s'écrit au bout (« 42 min · 31 % »). */
  text: string;
  color?: string;
  hollow?: boolean;
}

export function HBarChart({ rows, label, max, className = "" }: { rows: HBarRow[]; label: string; max?: number; className?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <dl aria-label={label} className={`grid grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 ${className}`}>
      {rows.map((r, k) => (
        <div key={k} className="contents">
          <dt className="flex items-center gap-2 text-small text-ink">
            {r.color && <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px]" style={r.hollow ? { border: `1.5px solid ${r.color}` } : { background: r.color }} />}
            {r.label}
          </dt>
          <dd aria-hidden className="min-w-0">
            <span className="block h-3 rounded-r-[4px]" style={{ width: `${(r.value / top) * 100}%`, minWidth: r.value > 0 ? 2 : 0, ...(r.hollow ? { border: `1.5px solid ${r.color ?? "var(--c-viz-mark)"}` } : { background: r.color ?? "var(--c-viz-mark)" }) }} />
          </dd>
          <dd className="num text-right text-small text-ink-2">{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

// Petite courbe d'une tuile chiffrée (rendu serveur, sans interaction : le chiffre est à côté). Le trait
// en gris d'encre, le dernier point en encre pleine ; les trous restent des trous.
import { frac, linePath } from "./core";

export function Sparkline({ values, label, height = 32, zero = false, className = "" }: { values: (number | null)[]; label: string; height?: number; zero?: boolean; className?: string }) {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length < 2) return null;
  let lo = zero ? 0 : Math.min(...xs);
  let hi = Math.max(...xs);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const W = 100;
  const pad = 3;
  const y = (v: number) => pad + (1 - frac(v, lo, hi)) * (height - 2 * pad);
  const x = (i: number) => (values.length < 2 ? 0 : (i / (values.length - 1)) * W);
  const last = values.findLastIndex((v) => v != null);
  return (
    <span role="img" aria-label={label} className={`relative block ${className}`} style={{ height }}>
      <svg aria-hidden viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <path d={linePath(values.map((v, i) => ({ x: x(i), y: v == null ? null : y(v) })))} fill="none" stroke="var(--c-viz-mark)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-bg" style={{ left: `${(x(last) / W) * 100}%`, top: `${(y(values[last]!) / height) * 100}%` }} />
    </span>
  );
}

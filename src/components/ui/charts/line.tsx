// Courbe dans le temps (rendu serveur) : une ou plusieurs couches — ligne, bande (fourchette), points — sur
// une grille discrète, avec des zones horizontales en option (zones cardiaques). Le dessin s'étire à la
// largeur (SVG sans proportions fixes, traits à épaisseur constante) ; chiffres et repères sont en HTML
// pour garder leur taille. Survol, doigt et clavier : ChartHover. Sert au poids, au cœur, et servira aux
// séries denses (fréquence cardiaque d'une course) : quelques milliers de points passent sans peine.
import { bandPath, dotsPath, frac, linePath, niceDomain, tickText, type Tip, type TipRow } from "./core";
import { ChartHover } from "./hover";
import { AxisFrame, ChartTable, XAxis, YGrid, YLabels } from "./parts";

export type LineLayer =
  | { type: "line"; label: string; values: (number | null)[]; color?: string; width?: number }
  | { type: "band"; label: string; lo: (number | null)[]; hi: (number | null)[]; color?: string }
  | { type: "dots"; label: string; values: (number | null)[]; color?: string; size?: number };

export interface Zone {
  from: number;
  to: number;
  label: string;
  color: string;
}

const W = 1000;

export function LineChart({
  x,
  xDomain,
  xTicks,
  layers,
  zones,
  titles,
  format,
  label,
  unit,
  digits = 0,
  zero = false,
  minSpan = 0,
  height = 200,
  endLabel = true,
  className = "",
}: {
  /** Abscisses croissantes (jours depuis 1970 avec `dayNum`, secondes d'une séance…). */
  x: number[];
  xDomain?: [number, number];
  xTicks: { x: number; label: string }[];
  layers: LineLayer[];
  zones?: Zone[];
  /** Le titre de l'infobulle de chaque point (« lun. 3 nov. »). */
  titles: string[];
  format: (v: number) => string;
  /** Ce que montre le graphique, pour le curseur clavier et le tableau. */
  label: string;
  unit?: string;
  digits?: number;
  zero?: boolean;
  /** Écart minimal de l'axe (une série plate ne doit pas paraître agitée). */
  minSpan?: number;
  height?: number;
  endLabel?: boolean;
  className?: string;
}) {
  const [x0, x1] = xDomain ?? [x[0] ?? 0, x[x.length - 1] ?? 1];
  const all = layers.flatMap((l) => (l.type === "band" ? [...l.lo, ...l.hi] : l.values));
  const zoneVals = zones?.flatMap((z) => [z.from, z.to]) ?? [];
  const d = niceDomain([...all, ...zoneVals], { zero, minSpan });
  const fx = (v: number) => (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
  const fy = (v: number) => frac(v, d.lo, d.hi);
  const px = (i: number) => fx(x[i]) * W;
  const py = (v: number | null) => (v == null ? null : (1 - fy(v)) * height);

  const ticks = d.ticks.map((v) => ({ v, text: tickText(v, Number.isInteger(d.step) ? digits : Math.max(digits, 1)) }));
  const main = layers.find((l): l is Extract<LineLayer, { type: "line" }> => l.type === "line");
  const lastI = main ? main.values.findLastIndex((v) => v != null) : -1;
  const xs = x.map(fx);
  const tips: Tip[] = x.map((_, i) => ({
    title: titles[i] ?? "",
    rows: layers.flatMap((l): TipRow[] => {
      if (l.type === "band") return l.lo[i] != null && l.hi[i] != null ? [{ value: `${format(l.lo[i]!)}–${format(l.hi[i]!)}`, label: l.label, color: l.color ?? "var(--c-viz-band)", shape: "rect" }] : [];
      const v = l.values[i];
      return v != null ? [{ value: format(v), label: l.label, color: l.color ?? (l.type === "dots" ? "var(--c-ink-3)" : "var(--c-ink)"), shape: l.type === "dots" ? "dot" : "line" }] : [];
    }),
  }));

  return (
    <div className={`grid gap-2 ${className}`}>
      <AxisFrame
        yLabels={<YLabels ticks={ticks} pos={fy} unit={unit} height={height} />}
        plot={
          <ChartHover tips={tips} xs={xs} ys={main ? main.values.map((v) => (v == null ? null : 1 - fy(v))) : undefined} crosshair label={label}>
            <div className="relative" style={{ height }}>
              {zones?.map((z) => (
                <div key={z.label} aria-hidden className="absolute inset-x-0" style={{ top: `${(1 - fy(Math.min(z.to, d.hi))) * 100}%`, bottom: `${fy(Math.max(z.from, d.lo)) * 100}%` }}>
                  <span className="absolute inset-0 opacity-[0.16]" style={{ background: z.color }} />
                  <span className="label absolute right-1 top-1 text-ink-2">{z.label}</span>
                </div>
              ))}
              <YGrid ticks={ticks} pos={fy} />
              <svg aria-hidden viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                {layers.map((l, k) => {
                  if (l.type === "band") return <path key={k} d={bandPath(l.lo.map((lo, i) => ({ x: px(i), lo: py(lo), hi: py(l.hi[i]) })))} fill={l.color ?? "var(--c-viz-band)"} />;
                  const pts = l.values.map((v, i) => ({ x: px(i), y: py(v) }));
                  if (l.type === "dots") return <path key={k} d={dotsPath(pts)} stroke={l.color ?? "var(--c-ink-3)"} strokeWidth={l.size ?? 4} strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />;
                  return <path key={k} d={linePath(pts)} stroke={l.color ?? "var(--c-ink)"} strokeWidth={l.width ?? 2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" fill="none" />;
                })}
              </svg>
              {endLabel && main && lastI >= 0 && (
                <span aria-hidden className="pointer-events-none absolute right-0 -translate-y-[calc(100%+6px)] whitespace-nowrap rounded-[4px] bg-bg px-1 text-small font-bold text-ink" style={{ top: `${(1 - fy(main.values[lastI]!)) * 100}%` }}>
                  {format(main.values[lastI]!)}
                </span>
              )}
            </div>
          </ChartHover>
        }
        xAxis={<XAxis ticks={xTicks.map((t) => ({ at: fx(t.x), label: t.label }))} />}
      />
      <ChartTable caption={label} tips={tips} />
    </div>
  );
}

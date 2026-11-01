// Barres verticales par jour, semaine ou mois (rendu serveur, en HTML : nettes à toute largeur). Une série
// (pas, énergie, minutes) ou plusieurs empilées (phases du sommeil, temps par type de séance). Barre de
// 24 px au plus, bout arrondi de 4 px, carrée à la base, 2 px de papier entre deux barres et entre deux
// morceaux. La barre en cours (jour, semaine pas finis) est plus pâle. Une ligne de moyenne en option.
import { frac, niceDomain, tickText, type Tip, type TipRow } from "./core";
import { ChartHover } from "./hover";
import { AxisFrame, ChartTable, XAxis, YGrid, YLabels } from "./parts";

export interface BarDatum {
  /** Total de la barre (null : pas de mesure). */
  value: number | null;
  /** Morceaux d'une barre empilée, par clé de série. */
  parts?: Record<string, number>;
  /** La barre en cours (pâle, « en cours » dans l'infobulle). */
  partial?: boolean;
  /** Titre de l'infobulle (« semaine du 3 nov. »). */
  title: string;
  /** Une ligne de plus dans l'infobulle (« 6 jours mesurés »). */
  note?: string;
}

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export function BarChart({
  data,
  series,
  format,
  label,
  xTicks,
  unit,
  digits = 0,
  mean,
  height = 180,
  color = "var(--c-viz-mark)",
  className = "",
}: {
  data: BarDatum[];
  /** Séries empilées, de la base vers le haut. Sans elles, une seule série. */
  series?: BarSeries[];
  format: (v: number) => string;
  label: string;
  /** Repères sous les barres : l'indice de la barre et son texte. */
  xTicks: { i: number; label: string }[];
  unit?: string;
  digits?: number;
  /** Ligne de référence (moyenne de la période). */
  mean?: { value: number; label: string } | null;
  height?: number;
  color?: string;
  className?: string;
}) {
  const n = data.length;
  const d = niceDomain([...data.map((b) => b.value), mean?.value], { zero: true });
  const fy = (v: number) => frac(v, d.lo, d.hi);
  const ticks = d.ticks.map((v) => ({ v, text: tickText(v, Number.isInteger(d.step) ? digits : Math.max(digits, 1)) }));
  const stacked = !!series?.length;
  const tips: Tip[] = data.map((b) => ({
    title: b.partial ? `${b.title} (en cours)` : b.title,
    rows:
      b.value == null
        ? [{ value: "pas de mesure" }]
        : [
            ...(stacked
              ? series!.flatMap((s): TipRow[] => (b.parts?.[s.key] ? [{ value: format(b.parts[s.key]), label: s.label, color: s.color, shape: "rect" }] : [])).reverse()
              : []),
            { value: format(b.value), label: stacked ? "en tout" : undefined },
            ...(b.note ? [{ value: b.note }] : []),
          ],
  }));

  return (
    <div className={`grid gap-2 ${className}`}>
      <AxisFrame
        yLabels={<YLabels ticks={ticks} pos={fy} unit={unit} height={height} />}
        plot={
          <ChartHover tips={tips} xs={data.map((_, i) => (i + 0.5) / n)} label={label}>
            <div className="relative" style={{ height }}>
              <YGrid ticks={ticks} pos={fy} />
              <ol aria-hidden className="absolute inset-0 flex items-end">
                {data.map((b, i) => (
                  <li key={i} data-i={i} className="viz-slot flex h-full min-w-0 flex-1 items-end justify-center rounded-[4px] px-px">
                    {b.value != null && b.value > 0 && (
                      <span
                        className={`viz-bar flex w-full max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px] ${b.partial ? "viz-partial" : ""}`}
                        style={{ height: `${fy(b.value) * 100}%`, ...(stacked ? {} : { background: b.partial ? "var(--c-viz-soft)" : color }) }}
                      >
                        {stacked && series!.map((s) => (b.parts?.[s.key] ? <i key={s.key} className="block min-h-px" style={{ flexGrow: b.parts[s.key], background: s.color }} /> : null))}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {mean && (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-ink-2" style={{ top: `${(1 - fy(mean.value)) * 100}%` }}>
                  <span className="absolute right-0 -translate-y-full rounded-[4px] bg-bg px-1 pb-0.5 text-[12px] leading-none font-bold text-ink">{mean.label}</span>
                </span>
              )}
            </div>
          </ChartHover>
        }
        xAxis={<XAxis ticks={xTicks.map((t) => ({ at: (t.i + 0.5) / n, label: t.label }))} />}
      />
      <ChartTable caption={label} tips={tips} />
    </div>
  );
}

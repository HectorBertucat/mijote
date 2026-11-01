// Les pièces communes des graphiques, sans état (rendu serveur) : le cadre (titre, chiffre de tête, légende,
// tableau pour les lecteurs d'écran), la grille horizontale, l'axe des dates, l'état vide.
import type { ReactNode } from "react";
import { tableRows, type Tip } from "./core";

/** Un graphique dans la page : un repère, une lecture à droite (la valeur qui compte), le dessin, la légende. */
export function ChartFigure({ title, value, aside, legend, table, children, className = "" }: { title: ReactNode; value?: ReactNode; aside?: ReactNode; legend?: ReactNode; table?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <figure className={`grid min-w-0 content-start gap-4 ${className}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="grid gap-1">
          <span className="label text-ink-2">{title}</span>
          {value != null && <span className="text-small text-ink-2">{value}</span>}
        </span>
        {aside}
      </figcaption>
      {children}
      {legend}
      {table}
    </figure>
  );
}

/** Le chiffre de tête d'un graphique : « 8 412 pas par jour ». */
export function ChartValue({ value, unit, sub }: { value: ReactNode; unit?: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <b className="num-tight text-[28px] leading-none text-ink">{value}</b>
      {unit && <span className="ml-1 text-small text-ink-2">{unit}</span>}
      {sub && <span className="block pt-1 text-small text-ink-2">{sub}</span>}
    </>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  shape?: "line" | "rect" | "dot" | "band";
}

/** Légende : la marque de la série (trait, carré, point) et son nom en encre, jamais le texte en couleur. */
export function Legend({ items, className = "" }: { items: LegendItem[]; className?: string }) {
  if (items.length < 1) return null;
  return (
    <ul className={`flex flex-wrap gap-x-5 gap-y-1 text-small text-ink-2 ${className}`}>
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-2">
          <i aria-hidden className={`inline-block shrink-0 ${it.shape === "rect" ? "size-2.5 rounded-[2px]" : it.shape === "dot" ? "size-2 rounded-full" : it.shape === "band" ? "h-2.5 w-4 rounded-[2px]" : "h-0.5 w-4 rounded-full"}`} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Les mêmes chiffres en tableau, pour les lecteurs d'écran (le dessin, lui, est muet). Dans une boîte masquée :
 * un tableau ne se laisse pas réduire à 1 px et allongerait la page. Les suites sans mesure tiennent en une ligne (`tableRows`). */
export function ChartTable({ caption, tips }: { caption: string; tips: Tip[] }) {
  const cols = tips[0]?.rows.map((r) => r.label ?? "Valeur") ?? [];
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Quand</th>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows(tips).map((t, i) => (
            <tr key={i}>
              <th scope="row">{t.title}</th>
              {cols.map((c, k) => (
                <td key={c}>{t.rows[k]?.value ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Les filets horizontaux du dessin, un par graduation (les chiffres sont dans la gouttière, `YLabels`). */
export function YGrid({ ticks, pos }: { ticks: { v: number }[]; pos: (v: number) => number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {ticks.map((t, k) => (
        <span key={t.v} className={`absolute inset-x-0 border-t ${k === 0 ? "border-line-strong" : "border-line"}`} style={{ top: `${(1 - pos(t.v)) * 100}%` }} />
      ))}
    </div>
  );
}

/** Les chiffres de l'axe vertical, dans une gouttière à gauche du dessin, en face de leur filet ; l'unité sur le plus haut. */
export function YLabels({ ticks, pos, unit, height }: { ticks: { v: number; text: string }[]; pos: (v: number) => number; unit?: string; height: number }) {
  const texts = ticks.map((t, k) => (k === ticks.length - 1 && unit ? `${t.text}\u00a0${unit}` : t.text));
  const widest = texts.reduce((a, b) => (b.length > a.length ? b : a), "");
  return (
    <div aria-hidden className="num relative text-right text-[12px] leading-none text-ink-2" style={{ height }}>
      <span className="invisible block h-0 overflow-hidden whitespace-nowrap">{widest}</span>
      {ticks.map((t, k) => (
        <span key={t.v} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(1 - pos(t.v)) * 100}%` }}>
          {texts[k]}
        </span>
      ))}
    </div>
  );
}

/** Le gabarit d'un graphique à axes : la gouttière des chiffres, le dessin, l'axe des dates dessous. */
export function AxisFrame({ yLabels, plot, xAxis }: { yLabels: ReactNode; plot: ReactNode; xAxis: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-2 pt-2">
      {yLabels}
      {plot}
      <span />
      {xAxis}
    </div>
  );
}

/** L'axe des dates sous le dessin : chaque repère centré sur sa place (en %), calé aux bords près des extrémités. */
export function XAxis({ ticks }: { ticks: { at: number; label: string }[] }) {
  return (
    <div aria-hidden className="relative h-4 text-[12px] leading-none text-ink-2">
      {ticks.map((t, k) => (
        <span key={`${t.at}-${k}`} className="num absolute top-0 whitespace-nowrap" style={t.at > 0.94 ? { right: 0 } : t.at < 0.06 ? { left: 0 } : { left: `${t.at * 100}%`, transform: "translateX(-50%)" }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

/** Pas de donnée sur la période : une ligne de base et une phrase, à la hauteur du dessin (pas de saut). */
export function ChartEmpty({ children, height = 160 }: { children: ReactNode; height?: number }) {
  return (
    <div className="grid content-end border-b border-line-strong pb-3" style={{ height }}>
      <p className="max-w-[44ch] text-small text-ink-2">{children}</p>
    </div>
  );
}

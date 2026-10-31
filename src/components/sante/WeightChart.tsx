"use client";

// Courbe du poids : pesées du jour en points pâles, tendance (moyenne exponentielle) en un trait d’encre,
// sans aplat. Période au choix ; survol ou tap = lecture du jour (pesée et tendance).
import { useEffect, useMemo, useRef, useState } from "react";

export type ChartPoint = { date: string; kg: number | null; trend: number };
type Period = "28" | "91" | "365" | "all";

const H = 240;
const PAD = { l: 28, r: 8, t: 12, b: 28 };
const PERIODS: { value: Period; label: string }[] = [
  { value: "28", label: "4 sem." },
  { value: "91", label: "3 mois" },
  { value: "365", label: "1 an" },
  { value: "all", label: "Tout" },
];
const fmtKg = (v: number) => v.toFixed(1).replace(".", ",");
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", opts);

export function WeightChart({ series }: { series: ChartPoint[] }) {
  const [period, setPeriod] = useState<Period>(series.length > 120 ? "91" : "all");
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => (period === "all" ? series : series.slice(-Number(period))), [series, period]);
  // Le dessin prend la largeur réelle : les chiffres des axes gardent leur taille sur téléphone.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (pts.length < 2) return <p className="text-small text-ink-2">La courbe apparaît dès la deuxième pesée.</p>;

  const vals = pts.flatMap((p) => (p.kg != null ? [p.kg, p.trend] : [p.trend]));
  const lo = Math.floor(Math.min(...vals) * 2) / 2 - 0.5;
  const hi = Math.ceil(Math.max(...vals) * 2) / 2 + 0.5;
  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const step = hi - lo > 8 ? 2 : hi - lo > 4 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.trend).toFixed(1)}`).join(" ");
  const months = pts.length > 60;
  const labelEvery = Math.max(1, Math.ceil(pts.length / Math.max(3, Math.floor(W / 110))));
  // Repères de l’axe : le premier jour de chaque mois sur une longue période, sinon un jour sur `labelEvery`.
  const xLabels = months
    ? pts.flatMap((p, i) => (i === 0 || p.date.slice(5, 7) !== pts[i - 1].date.slice(5, 7) ? [{ i, text: fmtDay(p.date, { month: "short" }) }] : [])).filter((l, k, all) => k === 0 || x(l.i) - x(all[k - 1].i) > 48)
    : pts.flatMap((p, i) => (i % labelEvery === 0 ? [{ i, text: fmtDay(p.date) }] : []));
  const h = hover != null ? pts[hover] : pts[pts.length - 1];
  const hi_ = hover ?? pts.length - 1;

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((rel - PAD.l) / (W - PAD.l - PAD.r)) * (pts.length - 1)))));
  };

  return (
    <figure className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <p className="text-small tabular-nums text-ink-2" aria-live="polite">
          <b className="text-ink">{fmtDay(h.date, { weekday: "short", day: "numeric", month: "short" })}</b>
          {" · "}
          {h.kg != null ? <>pesée {fmtKg(h.kg)}{"\u00a0"}kg · </> : "pas de pesée · "}
          tendance <b className="text-ink">{fmtKg(h.trend)}{"\u00a0"}kg</b>
        </p>
        <div role="group" aria-label="Période" className="flex gap-4">
          {PERIODS.map((o) => {
            const on = o.value === period;
            const off = o.value === "365" && series.length < 92;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={off}
                onClick={() => {
                  setPeriod(o.value);
                  setHover(null);
                }}
                className={`label -mb-px min-h-9 border-b-2 transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div ref={box} className="min-w-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-pan-y select-none overflow-visible"
        role="img"
        aria-label={`Poids du ${fmtDay(pts[0].date)} au ${fmtDay(pts[pts.length - 1].date)} : tendance de ${fmtKg(pts[0].trend)} à ${fmtKg(pts[pts.length - 1].trend)} kg`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      >
        {ticks.filter((v) => Number.isInteger(v)).map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--c-line)" strokeWidth="1" />
            <text x={0} y={y(v) + 4} fontSize="12" fill="var(--c-ink-3)" className="num">
              {v}
            </text>
          </g>
        ))}
        {xLabels.map((l) => (
          <text key={l.i} x={x(l.i)} y={H - 4} textAnchor="start" fontSize="12" fill="var(--c-ink-3)">
            {l.text}
          </text>
        ))}
        {pts.map((p, i) => (p.kg != null ? <circle key={p.date} cx={x(i)} cy={y(p.kg)} r={pts.length > 120 ? 1.5 : 2.2} fill="var(--c-ink-3)" opacity="0.55" /> : null))}
        <path d={line} fill="none" stroke="var(--c-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(hi_)} x2={x(hi_)} y1={PAD.t} y2={H - PAD.b} stroke="var(--c-line-strong)" strokeWidth="1" opacity={hover != null ? 1 : 0} />
        <circle cx={x(hi_)} cy={y(h.trend)} r="4.5" fill="var(--c-ink)" stroke="var(--c-bg)" strokeWidth="2.5" />
      </svg>
      </div>
      <figcaption className="flex flex-wrap gap-x-6 gap-y-1 text-small text-ink-2">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block size-1.5 rounded-full bg-faint" /> pesée du jour
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-0.5 w-4 bg-ink" /> tendance, ce qui compte
        </span>
      </figcaption>
    </figure>
  );
}

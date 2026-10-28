"use client";

// Courbe du poids : pesées du jour en points pâles, tendance (moyenne exponentielle) en trait d'accent.
// Période au choix ; survol ou tap = lecture du jour (pesée et tendance).
import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui";

export type ChartPoint = { date: string; kg: number | null; trend: number };
type Period = "28" | "91" | "365" | "all";

const W = 640;
const H = 220;
const PAD = { l: 38, r: 12, t: 12, b: 26 };
const fmtKg = (v: number) => v.toFixed(1).replace(".", ",");
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", opts);

export function WeightChart({ series }: { series: ChartPoint[] }) {
  const [period, setPeriod] = useState<Period>(series.length > 120 ? "91" : "all");
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => (period === "all" ? series : series.slice(-Number(period))), [series, period]);

  if (pts.length < 2) return <p className="text-[14px] text-ink-2">La courbe apparaît dès la deuxième pesée.</p>;

  const vals = pts.flatMap((p) => (p.kg != null ? [p.kg, p.trend] : [p.trend]));
  const lo = Math.floor(Math.min(...vals) * 2) / 2 - 0.5;
  const hi = Math.ceil(Math.max(...vals) * 2) / 2 + 0.5;
  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const step = hi - lo > 8 ? 2 : hi - lo > 4 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.trend).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - PAD.b} L${x(0).toFixed(1)} ${H - PAD.b} Z`;
  const months = pts.length > 60;
  const labelEvery = Math.max(1, Math.ceil(pts.length / 6));
  const h = hover != null ? pts[hover] : pts[pts.length - 1];
  const hi_ = hover ?? pts.length - 1;

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((rel - PAD.l) / (W - PAD.l - PAD.r)) * (pts.length - 1)))));
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] tabular-nums text-ink-2" aria-live="polite">
          <b className="text-ink">{fmtDay(h.date, { weekday: "short", day: "numeric", month: "short" })}</b>
          {" · "}
          {h.kg != null ? <>pesée {fmtKg(h.kg)} kg · </> : "pas de pesée · "}
          tendance <b className="text-accent">{fmtKg(h.trend)} kg</b>
        </p>
        <Segmented<Period>
          label="Période"
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setHover(null);
          }}
          options={[
            { value: "28", label: "4 sem." },
            { value: "91", label: "3 mois" },
            { value: "365", label: "1 an", disabled: series.length < 92 },
            { value: "all", label: "Tout" },
          ]}
        />
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`Poids du ${fmtDay(pts[0].date)} au ${fmtDay(pts[pts.length - 1].date)} : tendance de ${fmtKg(pts[0].trend)} à ${fmtKg(pts[pts.length - 1].trend)} kg`}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--c-line)" strokeDasharray={Number.isInteger(v) ? undefined : "2 4"} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--c-ink-3)" className="tabular-nums">
              {Number.isInteger(v) ? v : ""}
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : "middle"} fontSize="11" fill="var(--c-ink-3)">
              {months ? fmtDay(p.date, { month: "short", year: "2-digit" }) : fmtDay(p.date)}
            </text>
          ) : null
        )}
        <path d={area} fill="var(--c-accent-soft)" opacity="0.6" />
        {pts.map((p, i) => (p.kg != null ? <circle key={p.date} cx={x(i)} cy={y(p.kg)} r={pts.length > 120 ? 1.6 : 2.6} fill="var(--c-ink-3)" opacity="0.45" /> : null))}
        <path d={line} fill="none" stroke="var(--c-accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(hi_)} x2={x(hi_)} y1={PAD.t} y2={H - PAD.b} stroke="var(--c-ink-3)" strokeWidth="1" opacity={hover != null ? 0.5 : 0} />
        <circle cx={x(hi_)} cy={y(h.trend)} r="4.5" fill="var(--c-accent)" stroke="var(--c-surface)" strokeWidth="2" />
      </svg>
      <p className="flex flex-wrap gap-x-4 text-[12px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-faint opacity-60" /> pesée du jour (eau, sel, transit : ±1 kg)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-accent" /> tendance, ce qui compte
        </span>
      </p>
    </div>
  );
}

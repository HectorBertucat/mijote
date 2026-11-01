// « Évolution » : la période choisie (une seule rangée au-dessus des graphiques, dans l'adresse) et, pour
// chaque signal reçu, son graphique : poids (tendance, fourchette, pesées), pas, énergie active, minutes
// d'activité, temps par type de séance, sommeil par phase, cœur au repos et variabilité. Un signal jamais
// reçu ne s'affiche pas ; un signal sans mesure sur la période laisse une ligne, pas un trou.
import type { ReactNode } from "react";
import { BarChart, ChartEmpty, ChartFigure, ChartValue, HBarChart, Legend, LineChart, PeriodScope } from "@/components/ui/charts";
import { dateTicks, dayNum, fmt, fmtDay, hmin, NB, shiftDay, VIZ_CAT, VIZ_OTHER, VIZ_SLEEP } from "@/components/ui/charts/core";
import type { Overview } from "@/lib/health/overview";
import { lineGrainOf, OTHER, PERIODS, ROLLING, rollingMean, weightGrain, type Bucket } from "@/lib/health/series";
import { signed } from "../carnet";
import { bucketTicks, bucketTitle, per, periodMean } from "./format";

const kg = (v: number) => `${fmt(v, 1)}${NB}kg`;

export function Evolution({ o, extra }: { o: Overview; extra?: ReactNode }) {
  const p = o.period;
  const charts = [weightChart(o), stepsChart(o), energyChart(o), exerciseChart(o), typesChart(o), sleepChart(o), heartChart(o, "restingHr"), heartChart(o, "hrv")].filter(Boolean);
  if (!charts.length && !extra) return null;
  const [weight, ...rest] = o.weight.length > 1 ? charts : [null, ...charts];
  return (
    <section aria-labelledby="evolution" className="grid min-w-0 content-start border-t border-line-strong pt-4">
      <PeriodScope
        options={PERIODS.map((x) => ({ value: x.key, label: x.label }))}
        value={p.key}
        head={
          <div className="grid gap-1">
            <h2 id="evolution" className="text-h2">
              Évolution
            </h2>
            <p className="text-small text-ink-2">{`${p.long[0].toUpperCase()}${p.long.slice(1)}, du ${fmtDay(p.from, "full")} au ${fmtDay(p.to, "full")}`}</p>
          </div>
        }
      >
        <div className="grid gap-12">
          {weight}
          {rest.length > 0 && <div className="grid gap-x-6 gap-y-12 lg:grid-cols-2">{rest}</div>}
          {extra}
        </div>
      </PeriodScope>
    </section>
  );
}

/** Les barres d'une série (pas, énergie, minutes) : moyenne de la période en tête et en ligne. */
function barsOf(o: Overview, buckets: Bucket[] | null, { title, unit, mode, digits = 0, empty }: { title: string; unit: string; mode: "mean" | "sum"; digits?: number; empty: string }) {
  if (!buckets) return null;
  const g = o.period.grain;
  const m = periodMean(buckets, mode);
  const f = (v: number) => `${fmt(v, digits)}${NB}${unit}`;
  const unitPer = mode === "mean" ? "par jour" : per(g);
  return (
    <ChartFigure key={title} title={title} value={m != null ? <ChartValue value={fmt(m, digits)} unit={`${unit} ${unitPer} en moyenne`} /> : null}>
      {m == null ? (
        <ChartEmpty>{empty}</ChartEmpty>
      ) : (
        <BarChart
          data={buckets.map((b) => ({ value: b.value, partial: b.partial, title: bucketTitle(b.start, g), note: g !== "day" && mode === "mean" && b.n ? `${unitPer}, ${b.n}${NB}jour${b.n > 1 ? "s" : ""} mesuré${b.n > 1 ? "s" : ""}` : undefined }))}
          format={f}
          label={`${title}, ${unitPer}, ${o.period.long}`}
          xTicks={bucketTicks(buckets, g)}
          mean={{ value: m, label: `moy. ${fmt(m, digits)}` }}
        />
      )}
    </ChartFigure>
  );
}

function stepsChart(o: Overview) {
  return barsOf(o, o.bars.steps, { title: "Pas", unit: "pas", mode: "mean", empty: "Pas de pas reçus sur cette période." });
}
function energyChart(o: Overview) {
  return barsOf(o, o.bars.activeKcal, { title: "Énergie active", unit: "kcal", mode: "mean", empty: "Pas d’énergie active reçue sur cette période." });
}
function exerciseChart(o: Overview) {
  return barsOf(o, o.bars.exercise, { title: "Minutes d’activité", unit: "min", mode: "sum", empty: "Pas de minutes d’activité reçues sur cette période." });
}

function weightChart(o: Overview) {
  const w = o.weight;
  if (w.length < 2) return null;
  const first = w[0];
  const last = w[w.length - 1];
  // Au-delà d'un peu plus d'un an, un point par semaine, par mois sur plusieurs années (weightView).
  const g = weightGrain(o.period);
  const unit = g === "month" ? "du mois" : "de la semaine";
  const x = w.map((p) => dayNum(p.date));
  const ticks = dateTicks(o.period.from, o.period.to).map((t) => ({ x: dayNum(t.date), label: t.label }));
  return (
    <ChartFigure
      key="poids"
      title="Poids"
      value={<ChartValue value={fmt(last.trend, 1)} unit="kg en tendance" sub={`${signed(last.trend - first.trend, 1)}${NB}kg sur la période`} />}
      legend={
        <Legend
          items={[
            { label: g !== "day" ? `moyenne des pesées ${unit}` : "pesée du jour", color: "var(--c-ink-3)", shape: "dot" },
            { label: g !== "day" ? `pesées ${unit}, la plus basse et la plus haute` : "fourchette des pesées sur 7 jours", color: "var(--c-viz-band)", shape: "band" },
            { label: "tendance, ce qui compte", color: "var(--c-ink)", shape: "line" },
          ]}
        />
      }
    >
      <LineChart
        x={x}
        xDomain={[dayNum(o.period.from), dayNum(o.period.to)]}
        xTicks={ticks}
        titles={w.map((p) => bucketTitle(p.date, g))}
        layers={[
          { type: "band", label: "fourchette", lo: w.map((p) => p.lo), hi: w.map((p) => p.hi) },
          { type: "dots", label: g !== "day" ? "pesées" : "pesée", values: w.map((p) => p.kg), size: w.length > 120 ? 3 : 5 },
          { type: "line", label: "tendance", values: w.map((p) => p.trend) },
        ]}
        format={kg}
        unit="kg"
        minSpan={2}
        height={220}
        label={`Poids, ${o.period.long}`}
      />
    </ChartFigure>
  );
}

function typesChart(o: Overview) {
  const t = o.types;
  const present = t.types.filter((k) => t.totals[k]);
  if (!present.length) return null;
  const colorOf = (k: string) => (k === OTHER ? VIZ_OTHER : VIZ_CAT[t.types.indexOf(k)] ?? VIZ_OTHER);
  const series = t.types.map((k) => ({ key: k, label: k, color: colorOf(k) }));
  const total = Object.values(t.totals).reduce((s, v) => s + v, 0);
  const g = o.period.grain;
  return (
    <ChartFigure
      key="types"
      title="Temps par type de séance"
      value={<ChartValue value={hmin(total)} unit="en tout" sub={`${fmt(t.buckets.reduce((s, b) => s + b.n, 0))} séances`} />}
      legend={
        <HBarChart
          label="Temps par type de séance sur la période"
          rows={present.map((k) => ({ label: k, value: t.totals[k], text: `${hmin(t.totals[k])} · ${fmt((t.totals[k] / total) * 100)}${NB}%`, color: colorOf(k) }))}
        />
      }
    >
      <BarChart
        data={t.buckets.map((b) => ({ value: b.value, parts: b.parts, partial: b.partial, title: bucketTitle(b.start, g) }))}
        series={series}
        format={(v) => hmin(v)}
        unit="min"
        label={`Temps par type de séance, ${per(g)}, ${o.period.long}`}
        xTicks={bucketTicks(t.buckets, g)}
      />
    </ChartFigure>
  );
}

function sleepChart(o: Overview) {
  const s = o.sleep;
  if (!s) return null;
  const g = o.period.grain;
  const m = periodMean(s, "mean");
  const detailed = s.some((b) => b.deep != null);
  const series = detailed
    ? [
        { key: "deep", label: "profond", color: VIZ_SLEEP.deep },
        { key: "core", label: "léger", color: VIZ_SLEEP.core },
        { key: "rem", label: "paradoxal", color: VIZ_SLEEP.rem },
        { key: "asleep", label: "sans détail", color: VIZ_OTHER },
      ]
    : undefined;
  const h = (v: number) => v / 60;
  return (
    <ChartFigure
      key="sommeil"
      title="Sommeil"
      value={m != null ? <ChartValue value={hmin(m)} unit={`par nuit${g === "day" ? "" : ", en moyenne"}`} /> : null}
      legend={series && <Legend items={series.slice(0, 3).map((x) => ({ label: x.label, color: x.color, shape: "rect" as const }))} />}
    >
      {m == null ? (
        <ChartEmpty>Pas de nuit reçue sur cette période.</ChartEmpty>
      ) : (
        <BarChart
          data={s.map((b) => ({
            value: b.value == null ? null : h(b.value),
            partial: b.partial && g !== "day",
            parts: series ? ((b.deep != null ? { deep: h(b.deep), core: h(b.core ?? 0), rem: h(b.rem ?? 0) } : b.value != null ? { asleep: h(b.value) } : undefined) as Record<string, number> | undefined) : undefined,
            title: g === "day" ? `nuit du ${fmtDay(shiftDay(b.start, -1))} au ${fmtDay(b.start, "weekday")}` : bucketTitle(b.start, g),
            note: g !== "day" && b.n ? `par nuit, ${b.n}${NB}nuit${b.n > 1 ? "s" : ""}` : undefined,
          }))}
          series={series}
          format={(v) => hmin(v * 60)}
          unit="h"
          mean={{ value: h(m), label: `moy. ${hmin(m)}` }}
          label={`Sommeil par nuit, ${o.period.long}`}
          xTicks={bucketTicks(s, g)}
        />
      )}
    </ChartFigure>
  );
}

const HEART = {
  restingHr: { title: "FC au repos", unit: "bpm", digits: 0, minSpan: 10 },
  hrv: { title: "Variabilité cardiaque", unit: "ms", digits: 0, minSpan: 20 },
} as const;

/** Le cœur : la mesure du jour (ou la moyenne du mois) en points, la moyenne glissante sur 7 jours (ou 3 mois) en trait. */
function heartChart(o: Overview, key: "restingHr" | "hrv") {
  const b = o.lines[key];
  if (!b) return null;
  const c = HEART[key];
  const grain = lineGrainOf(o.period.grain);
  const vals = b.map((x) => x.value);
  const avg = rollingMean(vals, ROLLING[grain]);
  const m = periodMean(b, "mean");
  const f = (v: number) => `${fmt(v, c.digits)}${NB}${c.unit}`;
  const label = grain === "day" ? "moyenne sur 7 jours" : "moyenne sur 3 mois";
  return (
    <ChartFigure
      key={key}
      title={c.title}
      value={m != null ? <ChartValue value={fmt(m, c.digits)} unit={`${c.unit} en moyenne`} /> : null}
      legend={
        m != null && (
          <Legend
            items={[
              { label: grain === "day" ? "mesure du jour" : "moyenne du mois", color: "var(--c-ink-3)", shape: "dot" },
              { label, color: "var(--c-ink)", shape: "line" },
            ]}
          />
        )
      }
    >
      {m == null ? (
        <ChartEmpty height={180}>Pas de mesure sur cette période.</ChartEmpty>
      ) : (
        <LineChart
          x={b.map((x) => dayNum(x.start))}
          xDomain={[dayNum(o.period.from), dayNum(o.period.to)]}
          xTicks={dateTicks(o.period.from, o.period.to).map((t) => ({ x: dayNum(t.date), label: t.label }))}
          titles={b.map((x) => bucketTitle(x.start, grain))}
          layers={[
            { type: "dots", label: grain === "day" ? "mesure" : "mois", values: vals, size: b.length > 120 ? 3 : 4 },
            { type: "line", label: "moyenne", values: avg },
          ]}
          format={f}
          unit={c.unit}
          minSpan={c.minSpan}
          height={180}
          label={`${c.title}, ${o.period.long}`}
        />
      )}
    </ChartFigure>
  );
}

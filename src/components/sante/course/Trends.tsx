// Les tendances de la course (docs/course.md § 7), une question par graphique : forme et fatigue sur trois mois
// (deux courbes, puis la fraîcheur sur ses bandes), volume par semaine empilé par intensité, régularité (toutes
// activités sur 12 semaines), allure à FC égale en endurance, répartition facile / soutenu sur 4 semaines.
// Kit src/components/ui/charts/ : rendu serveur, une île de survol, un tableau pour les lecteurs d'écran.
import { BarChart, CalendarHeat, ChartEmpty, ChartFigure, ChartValue, Legend, LineChart } from "@/components/ui/charts";
import { dateTicks, dayNum, fmt, fmtDay, hmin, NB, VIZ_CAT, VIZ_ZONE } from "@/components/ui/charts/core";
import type { CourseView } from "@/lib/running/page";
import { kmh, paceText } from "@/lib/running/view";
import { typo } from "@/lib/typo";
import { HowCalc, Section, signed } from "../carnet";

const SEILER = [
  { key: "easy", label: "facile", color: VIZ_ZONE[1] },
  { key: "moderate", label: "modéré", color: VIZ_ZONE[2] },
  { key: "hard", label: "soutenu", color: VIZ_ZONE[4] },
  { key: "unknown", label: "sans cardio", color: "var(--c-viz-soft)" },
];

export function FormChart({ v }: { v: CourseView }) {
  const days = v.fitness;
  const f = v.form;
  if (!f || days.length < 14) return null;
  const from = days[0].date;
  const to = days[days.length - 1].date;
  const x = days.map((d) => dayNum(d.date));
  const ticks = dateTicks(from, to).map((t) => ({ x: dayNum(t.date), label: t.label }));
  const titles = days.map((d) => fmtDay(d.date, "weekday"));
  const pct = days.map((d) => (d.tsbPct == null ? null : Math.round(d.tsbPct)));
  return (
    <Section title="Forme et fatigue" id="forme" aside={<span className="label text-ink-2">trois mois</span>}>
      <p className="max-w-[62ch] text-lead text-pretty">{typo(f.sentence)}</p>
      <div className="grid gap-x-6 gap-y-12 lg:grid-cols-12">
        <ChartFigure
          className="lg:col-span-7"
          title="Forme et fatigue"
          value="en points de charge par jour, toutes séances"
          legend={
            <Legend
              items={[
                { label: "forme, la moyenne des 6 semaines", color: "var(--c-ink)", shape: "line" },
                { label: "fatigue, celle des 7 derniers jours", color: VIZ_CAT[0], shape: "line" },
              ]}
            />
          }
        >
          <LineChart
            x={x}
            xTicks={ticks}
            titles={titles}
            layers={[
              { type: "line", label: "fatigue", values: days.map((d) => Math.round(d.atl)), color: VIZ_CAT[0] },
              { type: "line", label: "forme", values: days.map((d) => Math.round(d.ctl)), width: 2.5 },
            ]}
            format={(v) => fmt(v)}
            zero
            height={200}
            label="Forme et fatigue, trois mois"
          />
        </ChartFigure>
        <ChartFigure className="lg:col-span-5" title="Fraîcheur du matin" value={f.fraicheur != null ? <ChartValue value={signed(f.fraicheur, 0)} unit="% de la forme" /> : "à partir de quelques semaines de séances"}>
          {pct.some((p) => p != null) ? (
            <LineChart
              x={x}
              xTicks={ticks}
              titles={titles}
              layers={[{ type: "line", label: "fraîcheur", values: pct }]}
              zones={[
                { from: -30, to: -10, label: "on progresse", color: "var(--c-viz-mark)" },
                { from: -60, to: -30, label: "trop de fatigue", color: VIZ_ZONE[4] },
              ]}
              format={(v) => `${signed(v, 0)}${NB}%`}
              unit="%"
              height={200}
              label="Fraîcheur du matin, en pourcentage de la forme, trois mois"
            />
          ) : (
            <ChartEmpty height={200}>La fraîcheur se lit quand la forme dépasse quelques points.</ChartEmpty>
          )}
        </ChartFigure>
      </div>
      <HowCalc title="Forme, fatigue, fraîcheur : ce que c’est">
        <p>Chaque séance a une charge, tirée de ta fréquence cardiaque et de sa durée (100 points, c’est une heure à ton seuil). La natation et le renforcement comptent aussi.</p>
        <p>{typo("La forme est la moyenne de ta charge sur six semaines environ : elle monte lentement quand tu t’entraînes avec régularité. La fatigue est celle des sept derniers jours : elle monte vite et redescend vite.")}</p>
        <p>{typo("La fraîcheur, c’est la forme moins la fatigue, en pourcentage de la forme. Entre −10 et −30 %, tu travailles : c’est là qu’on progresse. Sous −30 %, la fatigue est trop haute et le plan allège la séance suivante. Au-dessus de +5 %, tu es frais.")}</p>
      </HowCalc>
    </Section>
  );
}

export function VolumeChart({ v }: { v: CourseView }) {
  const weeks = v.volume;
  const done = weeks.filter((w) => w.minutes > 0);
  const last4 = weeks.slice(-5, -1);
  const avg = last4.length ? last4.reduce((s, w) => s + w.minutes, 0) / last4.length : 0;
  return (
    <ChartFigure
      title="Volume de course par semaine"
      value={done.length ? <ChartValue value={fmt(avg)} unit="min par semaine" sub="en moyenne sur les quatre semaines finies" /> : null}
      legend={<Legend items={SEILER.filter((s) => weeks.some((w) => w[`${s.key}Min` as "easyMin"] > 0)).map((s) => ({ label: s.label, color: s.color, shape: "rect" }))} />}
    >
      {done.length ? (
        <BarChart
          data={weeks.map((w, i) => ({
            value: w.minutes || null,
            parts: { easy: w.easyMin, moderate: w.moderateMin, hard: w.hardMin, unknown: w.unknownMin },
            partial: i === weeks.length - 1,
            title: `semaine du ${fmtDay(w.weekStart)}`,
            note: w.runs ? `${w.runs} sortie${w.runs > 1 ? "s" : ""}${w.km ? `, ${fmt(w.km, 1)}${NB}km` : ""}` : undefined,
          }))}
          series={SEILER}
          format={(m) => hmin(m)}
          label="Minutes de course par semaine, douze semaines, par intensité"
          xTicks={weeks.flatMap((w, i) => (i % 3 === (weeks.length - 1) % 3 ? [{ i, label: fmtDay(w.weekStart) }] : []))}
          unit="min"
          height={180}
        />
      ) : (
        <ChartEmpty>Pas encore de course reçue. Elles arrivent de la montre par l’app Mijote Santé.</ChartEmpty>
      )}
    </ChartFigure>
  );
}

export function Regularity({ v }: { v: CourseView }) {
  const r = v.regularity;
  const labels = new Map<string, string[]>();
  for (const run of v.runs) labels.set(run.date, [...(labels.get(run.date) ?? []), `course ${hmin(run.movingMin)}`]);
  return (
    <ChartFigure
      title="Régularité"
      value={
        <>
          <b className="num text-ink">{r.weeks}</b> semaines sur {r.of} avec deux sorties ou plus
          {r.planned > 0 && (
            <>
              {" ; "}
              <b className="num text-ink">{r.done}</b> séance{r.done > 1 ? "s" : ""} faite{r.done > 1 ? "s" : ""} sur {r.planned} prévue{r.planned > 1 ? "s" : ""}
            </>
          )}
        </>
      }
    >
      <CalendarHeat
        values={v.activity}
        to={v.today}
        weeks={12}
        phoneWeeks={12}
        levels={[1, 25, 40, 60, 90]}
        label="Minutes de séance par jour, toutes activités, douze semaines"
        legend="minutes de séance par jour, course, natation et renforcement"
        tip={(d, val) => ({ title: fmtDay(d, "full"), rows: val ? [...(labels.get(d) ?? []), ...(v.otherByDay.get(d) ?? [])].map((t) => ({ value: t })) : [{ value: "repos" }] })}
      />
    </ChartFigure>
  );
}

export function EfficiencyChart({ v }: { v: CourseView }) {
  const pts = v.efficiency.points;
  const fmtSpeed = (s: number) => `${fmt(s, 1)}${NB}km/h, ${paceText(3600 / s)}/km`;
  return (
    <ChartFigure
      title="Allure à FC égale, en endurance"
      value={typo(v.efficiency.sentence)}
      legend={
        pts.length > 1 ? (
          <Legend
            items={[
              { label: "une sortie", color: "var(--c-ink-3)", shape: "dot" },
              { label: "médiane sur six semaines", color: "var(--c-ink)", shape: "line" },
            ]}
          />
        ) : null
      }
    >
      {pts.length > 1 ? (
        <LineChart
          x={pts.map((p) => dayNum(p.date))}
          xTicks={dateTicks(pts[0].date, pts[pts.length - 1].date, 5).map((t) => ({ x: dayNum(t.date), label: t.label }))}
          titles={pts.map((p) => fmtDay(p.date, "weekday"))}
          layers={[
            { type: "dots", label: "sortie", values: pts.map((p) => kmh(p.value)), size: 6 },
            { type: "line", label: "médiane", values: pts.map((p) => kmh(p.median)) },
          ]}
          format={fmtSpeed}
          unit="km/h"
          digits={1}
          minSpan={1}
          height={180}
          label="Vitesse à fréquence cardiaque égale (milieu de l’endurance), par sortie"
        />
      ) : (
        <ChartEmpty>Il faut des sorties faciles avec la fréquence cardiaque pour voir la tendance.</ChartEmpty>
      )}
    </ChartFigure>
  );
}

/** La répartition des 4 dernières semaines : une barre en trois parts, repère à 80 % de facile. */
export function IntensityBar({ v }: { v: CourseView }) {
  const s = v.intensity;
  if (!s) return null;
  const parts = [
    { label: "facile", value: s.easy, color: VIZ_ZONE[1] },
    { label: "modéré", value: s.moderate, color: VIZ_ZONE[2] },
    { label: "soutenu", value: s.hard, color: VIZ_ZONE[4] },
  ].filter((p) => p.value > 0);
  return (
    <figure className="grid min-w-0 content-start gap-4">
      <figcaption className="grid gap-1">
        <span className="label text-ink-2">Répartition sur quatre semaines</span>
        <span className="text-small text-ink-2">
          <b className="num text-ink">{`${fmt(s.easy * 100)}${NB}%`}</b> du temps de course en facile{s.ok ? " : tu cours assez lentement, c’est ce qui construit." : " : moins de 80 %, les séances soutenues attendent la semaine suivante."}
        </span>
      </figcaption>
      <div className="relative pt-5">
        <div aria-hidden className="flex h-3 gap-[2px]">
          {parts.map((p, i) => (
            <span key={p.label} className={`block h-full ${i === 0 ? "rounded-l-[4px]" : ""} ${i === parts.length - 1 ? "rounded-r-[4px]" : ""}`} style={{ flexGrow: p.value, background: p.color }} />
          ))}
        </div>
        <span aria-hidden className="absolute top-0 bottom-0 border-l-2 border-ink" style={{ left: "80%" }}>
          <span className="label absolute -top-0.5 left-1 whitespace-nowrap text-ink">80 %</span>
        </span>
      </div>
      <Legend items={parts.map((p) => ({ label: `${p.label} ${fmt(p.value * 100)}${NB}%`, color: p.color, shape: "rect" }))} />
    </figure>
  );
}


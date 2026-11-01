import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BarChart, CalendarHeat, ChartEmpty, ChartFigure, ChartValue, HBarChart, Legend, LineChart, PeriodScope, Sparkline } from "@/components/ui/charts";
import { dateTicks, dayNum, fmt, fmtDay, hmin, NB, shiftDay, VIZ_CAT, VIZ_HEAT, VIZ_OTHER, VIZ_SLEEP, VIZ_ZONE } from "@/components/ui/charts/core";

// Les graphiques du kit (src/components/ui/charts/), chacun avec des données d'exemple fixes. Non liée dans
// la navigation ; la période se choisit dans l'adresse (?periode=), comme dans Santé.
export const metadata: Metadata = { title: "Graphiques · cuisine", robots: { index: false, follow: false } };

const TODAY = "2026-11-01";

/** Bruit fixe : la page est la même à chaque visite. */
function wobble(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2_147_483_648;
    return s / 2_147_483_648 - 0.5;
  };
}

function Demo({ title, use, children, help, wide }: { title: string; use: string; children: ReactNode; help?: ReactNode; wide?: boolean }) {
  return (
    <section className={`grid min-w-0 content-start gap-6 border-t border-line-strong pt-4 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="grid gap-1">
        <h2 className="text-h3">{title}</h2>
        <code className="num text-small text-ink-2">{use}</code>
        {help && <p className="max-w-[62ch] pt-1 text-small text-ink-2">{help}</p>}
      </div>
      {children}
    </section>
  );
}

const PERIODS = [
  { value: "7", label: "7 j" },
  { value: "30", label: "30 j" },
  { value: "91", label: "3 mois" },
];

export default async function Graphiques({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const { periode = "30" } = await searchParams;
  const days = PERIODS.some((p) => p.value === periode) ? Number(periode) : 30;
  const r = wobble(7);

  // Poids : tendance, fourchette des pesées, pesées du matin.
  const wDays = Array.from({ length: days }, (_, i) => shiftDay(TODAY, i - days + 1));
  const kg = wDays.map((_, i) => (i % 5 === 2 ? null : Math.round((82.4 - i * 0.03 + r() * 0.9) * 10) / 10));
  let t = 82.4;
  const trend = kg.map((v) => (t = v == null ? t : t + 0.1 * (v - t)));
  const win = (i: number) => kg.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null);
  // Pas par jour.
  const steps = wDays.map((d, i) => ({ date: d, value: i === days - 1 ? 3100 : Math.round(8200 + r() * 5200 + (new Date(`${d}T00:00:00Z`).getUTCDay() % 6 === 0 ? 1800 : 0)) }));
  const meanSteps = steps.slice(0, -1).reduce((s, x) => s + x.value, 0) / (steps.length - 1);
  // Sommeil par phase sur 14 nuits (en heures).
  const nights = Array.from({ length: 14 }, (_, i) => {
    const deep = 1.1 + r() * 0.5;
    const rem = 1.5 + r() * 0.5;
    const core = 4.1 + r() * 0.9;
    return { date: shiftDay(TODAY, i - 13), deep, rem, core, total: deep + rem + core };
  });
  // Temps par type et par semaine (minutes).
  const types = ["Course", "Renforcement", "Natation", "Yoga", "Autre"];
  const colorOf = (k: string) => (k === "Autre" ? VIZ_OTHER : VIZ_CAT[types.indexOf(k)]);
  const weeks = Array.from({ length: 12 }, (_, w) => {
    const parts: Record<string, number> = {};
    for (const k of types) if (r() > -0.25) parts[k] = Math.round(30 + r() * 40 + (k === "Course" ? 30 : 0));
    return { start: shiftDay("2026-10-26", (w - 11) * 7), parts, total: Object.values(parts).reduce((s, v) => s + v, 0) };
  });
  const typeTotals = types.map((k) => ({ k, m: weeks.reduce((s, w) => s + (w.parts[k] ?? 0), 0) }));
  const allTypes = typeTotals.reduce((s, x) => s + x.m, 0);
  // Une année de séances.
  const year = new Map<string, number>();
  for (let i = 0; i < 365; i++) {
    const d = shiftDay(TODAY, -i);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if ((wd === 2 || wd === 4 || wd === 6) && r() > -0.3) year.set(d, Math.round(35 + r() * 50 + (wd === 6 ? 40 : 0)));
  }
  // Une course de 45 min, un point toutes les 5 s : fréquence cardiaque et zones.
  const run = Array.from({ length: 540 }, (_, i) => {
    const s = i * 5;
    const warm = Math.min(1, s / 600);
    return Math.round(98 + warm * 52 + Math.sin(s / 170) * 7 + (s > 2100 && s < 2400 ? 18 : 0) + r() * 5);
  });
  const ZONES = [
    { from: 90, to: 114, label: "Z1" },
    { from: 114, to: 133, label: "Z2" },
    { from: 133, to: 152, label: "Z3" },
    { from: 152, to: 171, label: "Z4" },
    { from: 171, to: 190, label: "Z5" },
  ].map((z, k) => ({ ...z, color: VIZ_ZONE[k] }));
  const inZone = ZONES.map((z) => run.filter((v) => v >= z.from && v < z.to).length * 5);
  const zoneTotal = inZone.reduce((s, v) => s + v, 0);
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <header className="grid gap-3">
        <h1 className="text-h1">Graphiques</h1>
        <p className="max-w-[62ch] text-lead text-ink-2">
          Dessinés par le serveur, en SVG et en HTML, sans bibliothèque ; une petite île client lit les valeurs au survol, au doigt et au clavier (flèches). Couleurs validées en clair et en sombre.
        </p>
      </header>

      <Demo title="Palette des graphiques" use="VIZ_CAT, VIZ_OTHER, VIZ_HEAT, VIZ_SLEEP, VIZ_ZONE (cuisine-tokens.css, --c-viz-*)" help="Catégorielle pour les types de séance, quatre au plus puis « Autre » en gris. Rampes ordinales (une seule teinte, du clair au foncé) pour la régularité, les phases du sommeil et les zones cardiaques. Le texte reste à l’encre, jamais à la couleur de la série.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { name: "Types de séance", colors: [...VIZ_CAT, VIZ_OTHER] },
            { name: "Régularité", colors: VIZ_HEAT },
            { name: "Sommeil", colors: [VIZ_SLEEP.deep, VIZ_SLEEP.core, VIZ_SLEEP.rem, VIZ_SLEEP.awake] },
            { name: "Zones cardiaques", colors: VIZ_ZONE },
          ].map((p) => (
            <div key={p.name} className="grid gap-2">
              <span className="label text-ink-2">{p.name}</span>
              <span className="flex gap-[2px]">
                {p.colors.map((c) => (
                  <i key={c} className="block h-8 flex-1 first:rounded-l-[4px] last:rounded-r-[4px]" style={{ background: c }} />
                ))}
              </span>
            </div>
          ))}
        </div>
      </Demo>

      <section className="grid min-w-0 gap-6 border-t border-line-strong pt-4">
        <PeriodScope
          options={PERIODS}
          value={String(days)}
          head={
            <div className="grid gap-1">
              <h2 className="text-h3">Choix de la période</h2>
              <code className="num text-small text-ink-2">PeriodScope</code>
              <p className="max-w-[62ch] pt-1 text-small text-ink-2">Une seule rangée au-dessus des graphiques qu’elle règle ; la période va dans l’adresse et le serveur refait les séries. Pendant ce temps, les graphiques restent en place, estompés.</p>
            </div>
          }
        >
          <div className="grid gap-x-6 gap-y-12 lg:grid-cols-2">
            <Demo title="Courbe de tendance" use="LineChart (ligne, bande, points)" help="Le poids : la tendance en trait d’encre, la fourchette des 7 derniers jours en bande, les pesées en points pâles. La dernière valeur est écrite au bout.">
              <ChartFigure
                title="Poids"
                value={<ChartValue value={fmt(trend[trend.length - 1], 1)} unit="kg en tendance" />}
                legend={
                  <Legend
                    items={[
                      { label: "pesée du jour", color: "var(--c-ink-3)", shape: "dot" },
                      { label: "fourchette sur 7 jours", color: "var(--c-viz-band)", shape: "band" },
                      { label: "tendance", color: "var(--c-ink)", shape: "line" },
                    ]}
                  />
                }
              >
                <LineChart
                  x={wDays.map(dayNum)}
                  xTicks={dateTicks(wDays[0], TODAY).map((d) => ({ x: dayNum(d.date), label: d.label }))}
                  titles={wDays.map((d) => fmtDay(d, "weekday"))}
                  layers={[
                    { type: "band", label: "fourchette", lo: wDays.map((_, i) => (win(i).length ? Math.min(...win(i)) : null)), hi: wDays.map((_, i) => (win(i).length ? Math.max(...win(i)) : null)) },
                    { type: "dots", label: "pesée", values: kg },
                    { type: "line", label: "tendance", values: trend },
                  ]}
                  format={(v) => `${fmt(v, 1)}${NB}kg`}
                  unit="kg"
                  minSpan={2}
                  label="Poids d’exemple"
                />
              </ChartFigure>
            </Demo>

            <Demo title="Barres par jour" use="BarChart" help="Une série : barres de 24 px au plus, 2 px de papier entre elles, la barre du jour (pas finie) plus pâle, la moyenne en filet.">
              <ChartFigure title="Pas" value={<ChartValue value={fmt(meanSteps)} unit="pas par jour en moyenne" />}>
                <BarChart
                  data={steps.map((s, i) => ({ value: s.value, partial: i === steps.length - 1, title: fmtDay(s.date, "weekday") }))}
                  format={(v) => `${fmt(v)}${NB}pas`}
                  label="Pas par jour, exemple"
                  xTicks={dateTicks(steps[0].date, TODAY).map((d) => ({ i: wDays.indexOf(d.date), label: d.label }))}
                  mean={{ value: meanSteps, label: `moy. ${fmt(meanSteps)}` }}
                />
              </ChartFigure>
            </Demo>
          </div>
        </PeriodScope>
      </section>

      <div className="grid gap-x-6 gap-y-12 lg:grid-cols-2">
        <Demo title="Barres empilées, ordinales" use="BarChart series={…}" help="Le sommeil par phase : une rampe d’une seule teinte, du plus profond (foncé) au plus léger.">
          <ChartFigure title="Sommeil" value={<ChartValue value={hmin((nights.reduce((s, n) => s + n.total, 0) / nights.length) * 60)} unit="par nuit en moyenne" />} legend={<Legend items={[{ label: "profond", color: VIZ_SLEEP.deep, shape: "rect" }, { label: "léger", color: VIZ_SLEEP.core, shape: "rect" }, { label: "paradoxal", color: VIZ_SLEEP.rem, shape: "rect" }]} />}>
            <BarChart
              data={nights.map((n) => ({ value: n.total, parts: { deep: n.deep, core: n.core, rem: n.rem }, title: `nuit du ${fmtDay(n.date, "weekday")}` }))}
              series={[
                { key: "deep", label: "profond", color: VIZ_SLEEP.deep },
                { key: "core", label: "léger", color: VIZ_SLEEP.core },
                { key: "rem", label: "paradoxal", color: VIZ_SLEEP.rem },
              ]}
              format={(v) => hmin(v * 60)}
              unit="h"
              label="Sommeil par phase, exemple"
              xTicks={nights.flatMap((n, i) => (i % 3 === 1 ? [{ i, label: fmtDay(n.date) }] : []))}
            />
          </ChartFigure>
        </Demo>

        <Demo title="Barres empilées, catégorielles" use="BarChart series={…} + HBarChart en légende" help="Le temps par type de séance : quatre teintes au plus, dans l’ordre fixe, le reste en « Autre ». Un type garde sa couleur quand la période change.">
          <ChartFigure
            title="Temps par type de séance"
            value={<ChartValue value={hmin(allTypes)} unit="en tout" />}
            legend={<HBarChart label="Temps par type, exemple" rows={typeTotals.map((x) => ({ label: x.k, value: x.m, text: `${hmin(x.m)} · ${fmt((x.m / allTypes) * 100)}${NB}%`, color: colorOf(x.k) }))} />}
          >
            <BarChart
              data={weeks.map((w, i) => ({ value: w.total, parts: w.parts, partial: i === weeks.length - 1, title: `semaine du ${fmtDay(w.start)}` }))}
              series={types.map((k) => ({ key: k, label: k, color: colorOf(k) }))}
              format={(v) => hmin(v)}
              unit="min"
              label="Temps par type de séance et par semaine, exemple"
              xTicks={weeks.flatMap((w, i) => (i % 3 === 2 ? [{ i, label: fmtDay(w.start) }] : []))}
            />
          </ChartFigure>
        </Demo>

        <Demo title="Calendrier de régularité" use="CalendarHeat" help="Un an sur ordinateur, six mois sur téléphone. Flèches gauche et droite : une semaine ; haut et bas : un jour." wide>
          <CalendarHeat
            values={year}
            to={TODAY}
            label="Minutes de séance par jour, exemple"
            legend="minutes de séance par jour"
            tip={(d, v) => ({ title: fmtDay(d, "full"), rows: [{ value: v ? hmin(v) : "repos" }] })}
          />
        </Demo>

        <Demo title="Série dense et zones" use="LineChart zones={…}" help="Pour le module Course : 540 points (un toutes les 5 s) sans peine, et les zones cardiaques en bandes pâles derrière la courbe.">
          <ChartFigure title="Fréquence cardiaque" value={<ChartValue value={fmt(run.reduce((s, v) => s + v, 0) / run.length)} unit="bpm en moyenne" />}>
            <LineChart
              x={run.map((_, i) => i * 5)}
              xTicks={[0, 600, 1200, 1800, 2400].map((s) => ({ x: s, label: `${s / 60}${NB}min` }))}
              titles={run.map((_, i) => mmss(i * 5))}
              layers={[{ type: "line", label: "fréquence", values: run, width: 1.5 }]}
              zones={ZONES}
              format={(v) => `${fmt(v)}${NB}bpm`}
              unit="bpm"
              height={200}
              label="Fréquence cardiaque d’une course, exemple"
            />
          </ChartFigure>
        </Demo>

        <Demo title="Histogramme horizontal" use="HBarChart" help="Une répartition : chaque valeur écrite au bout de sa barre, pas d’infobulle à chercher.">
          <ChartFigure title="Temps dans chaque zone">
            <HBarChart label="Temps dans chaque zone, exemple" rows={ZONES.map((z, k) => ({ label: z.label, value: inZone[k], text: `${mmss(inZone[k])} · ${fmt((inZone[k] / zoneTotal) * 100)}${NB}%`, color: z.color }))} />
          </ChartFigure>
        </Demo>

        <Demo title="Petite courbe" use="Sparkline" help="Dans une tuile chiffrée : le chiffre dit la valeur, la courbe dit la forme des 30 derniers jours.">
          <div className="grid grid-cols-2 gap-6">
            {[
              { label: "Pas", value: fmt(meanSteps), values: steps.slice(-30, -1).map((s) => s.value) },
              { label: "FC au repos", value: "58", unit: "bpm", values: Array.from({ length: 30 }, (_, i) => (i % 9 === 4 ? null : 58 + Math.round(r() * 4))) },
            ].map((x) => (
              <div key={x.label} className="grid content-start gap-2 border-t border-line pt-4">
                <span className="label text-ink-2">{x.label}</span>
                <b className="num-tight text-[40px] leading-[0.9]">
                  {x.value}
                  {x.unit && <span className="ml-1.5 text-[0.36em] text-ink-2">{x.unit}</span>}
                </b>
                <Sparkline values={x.values} label={`${x.label}, 30 jours`} />
              </div>
            ))}
          </div>
        </Demo>

        <Demo title="Rien sur la période" use="ChartEmpty" help="À la hauteur du graphique, pour que rien ne saute ; une phrase dit ce qui manque.">
          <ChartFigure title="Variabilité cardiaque">
            <ChartEmpty>Pas de mesure sur cette période.</ChartEmpty>
          </ChartFigure>
        </Demo>
      </div>
    </div>
  );
}

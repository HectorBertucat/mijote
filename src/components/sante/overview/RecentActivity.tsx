// « Activité » : la régularité sur l'année (calendrier, toute la largeur), puis les dernières séances en liste à
// filets (type, durée, distance, énergie), sur deux colonnes à l'ordinateur. Carnet guidé et Apple Santé réunis (src/lib/health/overview.ts).
import { CalendarHeat } from "@/components/ui/charts";
import { fmt, fmtDay, hmin, NB, shiftDay as shift } from "@/components/ui/charts/core";
import type { Overview } from "@/lib/health/overview";
import { minutesByDay, type Activity } from "@/lib/health/series";
import { Section } from "../carnet";

/** « 6,2 km », « 1 500 m » (la natation se compte en mètres). */
function distance(a: Activity) {
  if (!a.distanceM) return null;
  return /nata|swim/i.test(a.label) || a.distanceM < 1000 ? `${fmt(Math.round(a.distanceM / 10) * 10)}${NB}m` : `${fmt(a.distanceM / 1000, 1)}${NB}km`;
}

export function RecentActivity({ o }: { o: Overview }) {
  const acts = o.activities;
  const target = o.sessions.perWeek;
  if (!acts.length && !target) return null;
  const year = acts.filter((a) => a.date > shift(o.today, -371));
  const byDay = minutesByDay(year);
  const activeDays = [...byDay.keys()].filter((d) => d > shift(o.today, -364)).length;
  const recent = acts.slice(0, 8);
  const perWeek = year.filter((a) => a.date > shift(o.today, -364)).length / 52;
  return (
    <Section title="Activité" id="activite" aside={target > 0 && <span className="label text-ink-2">{`visé${NB}: ${target} séance${target > 1 ? "s" : ""} par semaine`}</span>}>
      {acts.length ? (
        <div className="grid gap-12">
          <figure className="grid min-w-0 content-start gap-4">
            <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="label text-ink-2">Régularité sur un an</span>
              <span className="text-small text-ink-2">
                <b className="num text-ink">{activeDays}</b> jours actifs, <b className="num text-ink">{fmt(perWeek, 1)}</b> {perWeek >= 2 ? "séances" : "séance"} par semaine en moyenne
              </span>
            </figcaption>
            <CalendarHeat
              values={byDay}
              to={o.today}
              label="Minutes de séance par jour, sur un an"
              legend="minutes de séance par jour"
              tip={(d, v) => {
                const day = year.filter((a) => a.date === d);
                return { title: fmtDay(d, "full"), rows: v ? day.map((a) => ({ value: a.minutes ? hmin(a.minutes) : "—", label: a.label })) : [{ value: "repos" }] };
              }}
            />
          </figure>
          <div className="grid min-w-0 content-start gap-4">
            <span className="label text-ink-2">Dernières séances</span>
            <ul className="grid border-t border-line lg:grid-flow-col lg:grid-cols-2 lg:grid-rows-4 lg:gap-x-6">
              {recent.map((a, i) => {
                const facts = [a.minutes ? hmin(a.minutes) : null, distance(a), a.kcal ? `${fmt(a.kcal)}${NB}kcal` : null].filter(Boolean);
                return (
                  <li key={`${a.date}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b border-line py-3">
                    <span className="min-w-0 truncate">
                      <b className="font-bold">{a.label}</b>
                      {a.sub && <span className="text-ink-2">{` · ${a.sub}`}</span>}
                    </span>
                    <span className="text-small whitespace-nowrap text-ink-2">{fmtDay(a.date, "weekday")}</span>
                    {facts.length > 0 && <span className="num col-span-2 text-small text-ink-2">{facts.join(" · ")}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : (
        <p className="max-w-[62ch] text-body text-ink-2">Aucune séance encore. Les séances guidées de l’onglet Entraînement s’ajoutent seules ; la natation, la course ou le vélo viennent d’Apple Santé.</p>
      )}
    </Section>
  );
}

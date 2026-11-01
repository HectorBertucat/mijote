// Calendrier de régularité (rendu serveur) : une colonne par semaine (lundi en haut), une case par jour,
// plus foncée quand on a bougé plus. Un an sur ordinateur, six mois sur téléphone (les colonnes les plus
// anciennes se cachent). Survol, doigt et clavier (flèches : semaine, jour) avec ChartHover en mode cases.
import { fmtDay, levelOf, shiftDay as addDays, VIZ_HEAT, type Tip } from "./core";
import { ChartHover } from "./hover";
import { ChartTable } from "./parts";

const ROWS = ["lun.", "", "mer.", "", "ven.", "", ""];

export function CalendarHeat({
  values,
  to,
  tip,
  label,
  weeks = 53,
  phoneWeeks = 26,
  levels = [1, 20, 40, 60, 90],
  legend,
}: {
  /** Valeur par jour (AAAA-MM-JJ). */
  values: Map<string, number>;
  /** Dernier jour affiché (aujourd'hui). */
  to: string;
  /** L'infobulle d'un jour. */
  tip: (date: string, value: number | null) => Tip;
  label: string;
  weeks?: number;
  phoneWeeks?: number;
  /** Seuils des niveaux 1 à 5. */
  levels?: number[];
  /** Ce que mesure la couleur (« minutes de séance »). */
  legend: string;
}) {
  const wd = (new Date(`${to}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(to, -wd - (weeks - 1) * 7);
  const days = Array.from({ length: weeks * 7 }, (_, k) => addDays(start, k));
  const n = days.findIndex((d) => d > to);
  const count = n < 0 ? days.length : n;
  const tips = days.slice(0, count).map((d) => tip(d, values.get(d) ?? null));
  // Le nom du mois sur la première colonne qui y entre, s'il reste au moins trois colonnes avant le suivant.
  const starts = Array.from({ length: weeks }, (_, w) => w).filter((w) => w > 0 && days[w * 7].slice(5, 7) !== days[(w - 1) * 7].slice(5, 7));
  const keep = (list: number[]) => list.filter((w, k) => w < weeks - 2 && (list[k + 1] ?? Infinity) - w >= 3);
  const months = new Set(keep([0, ...starts]));
  // Sur téléphone, la première colonne visible prend son mois si le suivant est assez loin.
  const first = weeks - phoneWeeks;
  const phoneOnly = new Set(keep([first, ...starts.filter((w) => w > first)]).filter((w) => w === first && !months.has(w)));
  for (const w of phoneOnly) months.add(w);
  const hidden = (w: number) => (w < weeks - phoneWeeks ? "max-sm:hidden" : "");
  const cols = { "--w": weeks, "--wp": phoneWeeks } as React.CSSProperties;
  const grid = "grid [grid-template-columns:repeat(var(--wp),minmax(0,1fr))] sm:[grid-template-columns:repeat(var(--w),minmax(0,1fr))] gap-[3px]";

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
        <span />
        <div aria-hidden className={`${grid} h-4 text-[12px] leading-none text-ink-2`} style={cols}>
          {Array.from({ length: weeks }, (_, w) => {
            const d = days[w * 7];
            return (
              <span key={w} className={`relative ${hidden(w)}`}>
                {months.has(w) && <span className={`absolute left-0 whitespace-nowrap ${w < weeks - phoneWeeks ? "" : phoneOnly.has(w) ? "sm:hidden" : ""}`}>{fmtDay(d.slice(0, 8) + "15", "month")}</span>}
              </span>
            );
          })}
        </div>
        <div aria-hidden className="grid grid-rows-7 gap-[3px] text-[11px] leading-none text-ink-2">
          {ROWS.map((r, k) => (
            <span key={k} className="flex items-center">
              {r}
            </span>
          ))}
        </div>
        <ChartHover tips={tips} mode="cells" rows={7} label={label}>
          <ol aria-hidden className={`${grid} grid-flow-col grid-rows-7`} style={cols}>
            {days.map((d, k) => {
              const future = k >= count;
              const lvl = levelOf(values.get(d), levels);
              return (
                <li
                  key={d}
                  data-i={future ? undefined : k}
                  className={`viz-cell aspect-square rounded-[3px] ${hidden(Math.floor(k / 7))} ${future ? "invisible" : ""}`}
                  style={{ background: VIZ_HEAT[lvl] }}
                />
              );
            })}
          </ol>
        </ChartHover>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 text-small text-ink-2">
        <span>{legend}</span>
        <span className="inline-flex items-center gap-[3px]" aria-hidden>
          moins
          {VIZ_HEAT.map((c, k) => (
            <i key={k} className="inline-block size-3 rounded-[3px]" style={{ background: c }} />
          ))}
          plus
        </span>
      </div>
      <ChartTable caption={label} tips={tips.filter((_, k) => values.has(days[k]))} />
    </div>
  );
}

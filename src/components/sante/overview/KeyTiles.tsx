// « Cette semaine » : un chiffre par signal reçu (pas, énergie, séances, sommeil, cœur, VO2max, masse grasse),
// sa comparaison au mois d'avant et sa petite courbe sur 30 jours. Seuls les signaux présents s'affichent :
// une personne sans montre voit ses séances, et rien d'autre ne laisse de trou.
import type { ReactNode } from "react";
import { Sparkline } from "@/components/ui/charts";
import { fmt, hmin, shiftDay as shift } from "@/components/ui/charts/core";
import type { Overview } from "@/lib/health/overview";
import { typo } from "@/lib/typo";
import { HowCalc, NB, Section, signed } from "../carnet";

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" });

/** « +12 % sur le mois d’avant », rien sous 1 % ou sans comparaison. */
const delta = (pct: number | null) => (pct == null ? null : Math.abs(pct) < 1 ? "comme le mois d’avant" : `${signed(pct, 0)}${NB}% sur le mois d’avant`);

function Tile({ label, value, unit, sub, note, spark, sparkLabel }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; note?: ReactNode; spark?: (number | null)[]; sparkLabel?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-2 border-t border-line pt-4">
      <span className="label text-ink-2">{label}</span>
      <b className="num-tight block text-[clamp(2.25rem,1.9rem+1vw,2.75rem)] leading-[0.9] whitespace-nowrap text-ink">
        {value}
        {unit && <span className="ml-1.5 text-[0.36em] font-[650] tracking-normal text-ink-2 [font-stretch:100%]">{unit}</span>}
      </b>
      {sub && <span className="text-small text-ink-2">{sub}</span>}
      {spark && <Sparkline values={spark} label={sparkLabel ?? `${label}, 30 derniers jours`} className="mt-1" />}
      {note && <span className="text-small text-ink-2">{note}</span>}
    </div>
  );
}

export function KeyTiles({ o }: { o: Overview }) {
  const t = o.tiles;
  const s = o.sessions;
  const tiles: ReactNode[] = [];
  if (t.steps?.now != null) tiles.push(<Tile key="steps" label="Pas" value={fmt(t.steps.now)} sub="par jour, 7 derniers jours" note={delta(t.steps.pct)} spark={t.steps.spark} />);
  if (t.activeKcal?.now != null) tiles.push(<Tile key="kcal" label="Énergie active" value={fmt(t.activeKcal.now)} unit="kcal" sub="par jour, 7 derniers jours" note={delta(t.activeKcal.pct)} spark={t.activeKcal.spark} />);
  if (s.count || s.perWeek || o.activities.length)
    tiles.push(
      <Tile
        key="sessions"
        label="Séances"
        value={s.count}
        unit={s.count > 1 ? "séances" : "séance"}
        sub={s.count ? `${hmin(s.minutes)} en 7 jours` : "ces 7 derniers jours"}
        note={s.perWeek ? `${s.perWeek} prévue${s.perWeek > 1 ? "s" : ""} par semaine` : null}
      />
    );
  else if (t.exercise?.now != null) tiles.push(<Tile key="ex" label="Activité" value={fmt(t.exercise.now)} unit="min" sub="par jour, 7 derniers jours" note={delta(t.exercise.pct)} spark={t.exercise.spark} />);
  if (t.sleep) {
    const last = t.sleep.nights[t.sleep.nights.length - 1];
    tiles.push(
      <Tile
        key="sleep"
        label="Sommeil"
        value={hmin(t.sleep.avgMin)}
        sub={`par nuit, ${t.sleep.nights.length} ${t.sleep.nights.length > 1 ? "nuits" : "nuit"}`}
        note={last && last.deepMin != null && last.remMin != null ? `La dernière${NB}: ${hmin(last.asleepMin)}, dont ${hmin(last.deepMin)} de profond` : null}
        spark={t.sleep.spark}
        sparkLabel="Sommeil, 30 dernières nuits"
      />
    );
  }
  if (t.restingHr?.now != null) tiles.push(<Tile key="rhr" label="FC au repos" value={Math.round(t.restingHr.now)} unit="bpm" sub="moyenne sur 7 jours" note={t.restingHr.before != null ? `mois d’avant${NB}: ${Math.round(t.restingHr.before)}` : null} spark={t.restingHr.spark} />);
  if (t.hrv?.now != null) tiles.push(<Tile key="hrv" label="Variabilité cardiaque" value={Math.round(t.hrv.now)} unit="ms" sub="moyenne sur 7 jours" note={t.hrv.before != null ? `mois d’avant${NB}: ${Math.round(t.hrv.before)}` : null} spark={t.hrv.spark} />);
  if (t.vo2max) tiles.push(<Tile key="vo2" label="VO2max" value={fmt(t.vo2max.value, 1)} unit="mL/kg/min" sub={`au ${fmtDay(t.vo2max.at)}`} note={t.vo2max.before != null ? `un mois plus tôt${NB}: ${fmt(t.vo2max.before, 1)}` : null} spark={t.vo2max.spark} sparkLabel="VO2max, l’année" />);
  if (t.bodyFat) tiles.push(<Tile key="fat" label="Masse grasse" value={fmt(t.bodyFat.value, 1)} unit="%" sub={`au ${fmtDay(t.bodyFat.at)}`} note={t.bodyFat.before != null ? `un mois plus tôt${NB}: ${fmt(t.bodyFat.before, 1)}${NB}%` : null} spark={t.bodyFat.spark} sparkLabel="Masse grasse, l’année" />);
  if (!tiles.length) return null;
  const body = t.sleep || t.restingHr || t.hrv || t.vo2max || t.bodyFat;
  return (
    <Section title="Cette semaine" id="semaine" aside={<span className="label text-ink-2">{`du ${fmtDay(shift(o.today, -6))} au ${fmtDay(o.today)}`}</span>}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">{tiles}</div>
      {body && (
        <HowCalc title="Comment les lire">
          <p>{typo("Ces chiffres viennent de la montre ou de la balance, par l’app Mijote Santé. Ils ne changent pas la cible : ils aident à comprendre une semaine difficile.")}</p>
          <p>Une FC au repos qui monte de quelques battements, ou une variabilité qui baisse, signale souvent la fatigue, un rhume ou un manque de sommeil. Comparer à soi-même, jamais aux autres.</p>
        </HowCalc>
      )}
    </Section>
  );
}

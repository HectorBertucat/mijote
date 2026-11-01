// Une sortie (docs/course.md § 3 et § 7) : les chiffres clés, la courbe de FC sur ses zones, le temps par zone,
// les temps au kilomètre, le découplage et l'efficacité en une phrase, la séance prévue et la comparaison, les
// conditions, et le ressenti à noter (il alimente l'adaptation du plan). Tout vient de l'analyse gardée
// (src/lib/running/analysis.ts) et de page.ts ; rien n'est calculé ici.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { HowCalc, KeyFigure, NB, Note, Section, Verdict } from "@/components/sante/carnet";
import { FeedbackForm } from "@/components/sante/course/Feedback";
import { SessionBlocks } from "@/components/sante/course/Session";
import { ChartFigure, ChartValue, HBarChart, LineChart } from "@/components/ui/charts";
import { fmt, fmtDay, VIZ_ZONE } from "@/components/ui/charts/core";
import { Icon } from "@/components/ui";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { LONGEST_LABEL } from "@/lib/running/load";
import { runView, type RunView } from "@/lib/running/page";
import { decouplingText, durText, easyShareOf, efText, kmText, paceText, planCompare, readableBlocks, runTitle } from "@/lib/running/view";
import { ZONE_NAMES, zoneRange } from "@/lib/running/zones";
import { typo } from "@/lib/typo";

export const dynamic = "force-dynamic";

const LINK = "inline-flex min-h-tap items-center gap-1 text-small font-bold text-ink-2 hover:text-ink";
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", `${NB}h${NB}`);

export default async function Sortie({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erreur?: string }> }) {
  const person = await activePerson();
  const { id } = await params;
  const { erreur } = await searchParams;
  const r = runView(db, person.id, id);
  if (!r) notFound();
  const a = r.analysis;
  const kind = r.planned?.kind ?? null;
  const cmp = planCompare(r.planned ? { kind: r.planned.kind, minutes: r.planned.minutes } : null, { movingMin: a.movingMin || r.run.minutes, hrHighShare: a.hrHighShare, easyShare: easyShareOf(a.seiler) });
  const tone = cmp.verdict === "comme_prevu" ? "ok" : cmp.verdict === "libre" ? "idle" : "warn";
  const word = { comme_prevu: "comme prévu", plus_long: "plus longue", plus_court: "plus courte", plus_intense: "plus intense", libre: "hors plan" }[cmp.verdict];
  const fb = r.feedback;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <header className="grid gap-4">
        <nav aria-label="Sorties" className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/sante/course" className={LINK}>
            <Icon name="chev" size="s" className="rotate-180" />
            Course
          </Link>
          <span className="flex gap-4">
            {r.prev && (
              <Link href={`/sante/course/${r.prev}`} className={LINK}>
                <Icon name="chev" size="s" className="rotate-180" />
                Précédente
              </Link>
            )}
            {r.next && (
              <Link href={`/sante/course/${r.next}`} className={LINK}>
                Suivante
                <Icon name="chev" size="s" />
              </Link>
            )}
          </span>
        </nav>
        <p className="label text-ink-2">{`${fmtDay(r.run.date, "full")} · ${timeOf(r.run.start)}${r.source ? ` · ${r.source}` : ""}`}</p>
        <h2 className="text-h1">{runTitle(kind)}</h2>
        <div className="grid max-w-[62ch] gap-2">
          <Verdict tone={tone}>{word}</Verdict>
          <p className="text-lead text-pretty">{typo(cmp.text)}</p>
        </div>
        {erreur && <p className="text-ko-ink">{erreur}</p>}
      </header>

      <KeyFigures r={r} />
      <HrSection r={r} />
      <Splits r={r} />
      <Reading r={r} />

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
        <Section title="Ton ressenti" id="ressenti" className="lg:col-span-7">
          {fb && (fb.effort != null || fb.pain != null) && (
            <p className="text-body text-ink-2">
              {[fb.effort != null ? `Effort ${fb.effort}` : null, fb.pain != null ? `douleur ${fb.pain}${fb.painWhere ? ` (${fb.painWhere})` : ""}` : null, fb.enjoy != null ? `plaisir : ${["", "pénible", "bof", "correct", "bien", "super"][fb.enjoy]}` : null].filter(Boolean).join(", ")}. Tu peux le changer.
            </p>
          )}
          <FeedbackForm date={r.run.date} back={`/sante/course/${r.run.sampleId}`} initial={fb} title={fb ? "Changer le ressenti" : "Comment ça s’est passé ?"} />
        </Section>
        {r.planned && (
          <Section title="La séance prévue" id="prevue" className="lg:col-span-5">
            <p className="text-body text-ink-2">{r.planned.session.title}</p>
            <SessionBlocks blocks={readableBlocks(r.planned.session, r.zones)} compact />
          </Section>
        )}
      </div>
    </div>
  );
}

function KeyFigures({ r }: { r: RunView }) {
  const a = r.analysis;
  const tiles: ReactNode[] = [];
  if (a.distanceKm) tiles.push(<KeyFigure key="km" size="lg" label="Distance" value={fmt(a.distanceKm, 2)} unit="km" />);
  tiles.push(<KeyFigure key="t" size="lg" label="Durée" value={durText((a.movingMin || r.run.minutes) * 60)} sub={a.walkMin >= 1 ? `dont ${durText(a.walkMin * 60)} de marche` : null} />);
  if (a.pace) tiles.push(<KeyFigure key="p" size="lg" label="Allure" value={paceText(a.pace)} unit="/km" sub={a.gap && Math.abs(a.gap - a.pace) >= 3 ? `${paceText(a.gap)}/km ajustée à la pente` : null} />);
  if (r.hrAvg) tiles.push(<KeyFigure key="hr" size="lg" label="FC moyenne" value={Math.round(r.hrAvg)} unit="bpm" sub={r.hrMax ? `max ${Math.round(r.hrMax)}${NB}bpm` : null} />);
  if (r.elevGainM != null) tiles.push(<KeyFigure key="d" size="lg" label="Dénivelé" value={`+${Math.round(r.elevGainM)}`} unit="m" sub={r.elevLossM != null ? `−${Math.round(r.elevLossM)}${NB}m` : null} />);
  if (r.cadence) tiles.push(<KeyFigure key="c" size="lg" label="Cadence" value={Math.round(r.cadence)} unit="pas/min" sub={r.strideM ? `foulée ${fmt(r.strideM, 2)}${NB}m` : null} />);
  tiles.push(<KeyFigure key="l" size="lg" label="Charge" value={Math.round(a.load)} unit="points" sub={r.kcal ? `${fmt(r.kcal)}${NB}kcal` : null} />);
  if (a.tempC != null) tiles.push(<KeyFigure key="w" size="lg" label="Météo" value={`${fmt(a.tempC)}${NB}°`} sub={[r.humidity != null ? `${fmt(r.humidity)}${NB}% d’humidité` : null, a.heat ? "chaleur" : null].filter(Boolean).join(", ") || null} />);
  else if (r.indoor) tiles.push(<KeyFigure key="w" size="lg" label="Lieu" value="Intérieur" />);
  return (
    <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line-strong pt-6 sm:grid-cols-3 lg:grid-cols-4">
      {tiles}
    </section>
  );
}

function HrSection({ r }: { r: RunView }) {
  const a = r.analysis;
  const z = r.zones;
  const zoneRows = [
    ...([5, 4, 3, 2, 1] as const).map((k) => ({ label: `Z${k} ${ZONE_NAMES[k]}`, value: a.zoneSec[k] ?? 0, color: VIZ_ZONE[k - 1] })),
    { label: "sous les zones", value: a.zoneSec[0] ?? 0, color: "var(--c-viz-soft)" },
    ...(a.walkSec >= 30 ? [{ label: "marche", value: a.walkSec, color: "var(--c-surface-2)" }] : []),
  ];
  const total = zoneRows.reduce((s, x) => s + x.value, 0);
  const hr = r.hr;
  if (!hr.length && !total) return null;
  const end = hr.length ? hr[hr.length - 1][0] : 0;
  const every = end > 5400 ? 1800 : end > 2400 ? 600 : 300;
  const ticks = Array.from({ length: Math.floor(end / every) + 1 }, (_, i) => ({ x: i * every, label: i ? durText(i * every) : "0" }));
  const easy = easyShareOf(a.seiler);
  return (
    <Section title="Fréquence cardiaque" id="fc">
      <div className="grid gap-x-6 gap-y-12 lg:grid-cols-12">
        {hr.length > 1 && (
          <ChartFigure className="lg:col-span-8" title="FC au fil de la sortie" value={a.doubtful ? "FC douteuse : affichée, mais la sortie ne compte pas dans les tendances." : r.hrAvg ? <ChartValue value={Math.round(r.hrAvg)} unit="bpm en moyenne" /> : null}>
            <LineChart
              x={hr.map((p) => p[0])}
              xDomain={[0, end]}
              xTicks={ticks}
              titles={hr.map((p) => durText(p[0]))}
              layers={[{ type: "line", label: "FC", values: hr.map((p) => p[1]) }]}
              zones={([1, 2, 3, 4, 5] as const).map((k) => {
                const [lo, hi] = zoneRange(z, k);
                return { from: lo, to: hi + 1, label: `Z${k}`, color: VIZ_ZONE[k - 1] };
              })}
              format={(v) => `${Math.round(v)}${NB}bpm`}
              unit="bpm"
              endLabel={false}
              height={240}
              label="Fréquence cardiaque au fil de la sortie, sur les zones"
            />
          </ChartFigure>
        )}
        {total > 0 && (
          <ChartFigure className={hr.length > 1 ? "lg:col-span-4" : "lg:col-span-6"} title="Temps par zone" value={easy != null ? `${fmt(easy * 100)}${NB}% du temps de course en facile` : null}>
            <HBarChart rows={zoneRows.filter((x) => x.value > 0).map((x) => ({ label: x.label, value: x.value, color: x.color, text: `${durText(x.value)} · ${fmt((100 * x.value) / total)}${NB}%` }))} label="Temps passé dans chaque zone cardiaque" />
          </ChartFigure>
        )}
      </div>
    </Section>
  );
}

function Splits({ r }: { r: RunView }) {
  const rows = r.analysis.splits;
  if (!rows.length) return null;
  const paces = rows.map((x) => x.pace);
  const fast = Math.min(...paces);
  const slow = Math.max(...paces);
  const width = (p: number) => (slow === fast ? 100 : 35 + (65 * (slow - p)) / (slow - fast));
  const showGap = rows.some((x) => Math.abs(x.gap - x.pace) >= 3);
  const elev = rows.some((x) => x.elevGainM != null);
  return (
    <Section title="Au kilomètre" id="splits" aside={<span className="text-small text-ink-2">{`le plus rapide en ${paceText(fast)}/km`}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-left">
          <caption className="sr-only">Temps au kilomètre : allure, allure ajustée à la pente, FC moyenne et dénivelé</caption>
          <thead>
            <tr className="label border-b border-line-strong text-ink-2">
              <th scope="col" className="py-2 pr-4 font-[650]">
                Km
              </th>
              <th scope="col" className="py-2 pr-4 font-[650]">
                Allure
              </th>
              <th scope="col" className="w-full py-2 pr-4">
                <span className="sr-only">Barre d’allure</span>
              </th>
              {showGap && (
                <th scope="col" className="hidden py-2 pr-4 text-right font-[650] sm:table-cell">
                  Ajustée
                </th>
              )}
              <th scope="col" className="py-2 pr-4 text-right font-[650]">
                FC
              </th>
              {elev && (
                <th scope="col" className="py-2 text-right font-[650]">
                  Dénivelé
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => {
              const from = i ? rows[i - 1].km : 0;
              const part = x.km - from < 0.98;
              return (
                <tr key={x.km} className="border-b border-line">
                  <th scope="row" className="num py-2 pr-4 text-left font-bold">
                    {part ? fmt(x.km - from, 2) : Math.round(x.km)}
                  </th>
                  <td className="num py-2 pr-4 font-bold whitespace-nowrap">{paceText(x.pace)}</td>
                  <td aria-hidden className="py-2 pr-4">
                    <span className={`block h-2 rounded-r-[4px] ${x.pace === fast ? "bg-ink" : "bg-[var(--c-viz-mark)]"}`} style={{ width: `${width(x.pace)}%` }} />
                  </td>
                  {showGap && <td className="num hidden py-2 pr-4 text-right whitespace-nowrap text-ink-2 sm:table-cell">{paceText(x.gap)}</td>}
                  <td className="num py-2 pr-4 text-right whitespace-nowrap">{x.hrAvg ? Math.round(x.hrAvg) : "—"}</td>
                  {elev && <td className="num py-2 text-right whitespace-nowrap text-ink-2">{x.elevGainM != null ? `+${Math.round(x.elevGainM)}${x.elevLossM ? ` −${Math.round(x.elevLossM)}` : ""}` : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Reading({ r }: { r: RunView }) {
  const a = r.analysis;
  const ef = efText(a.ef, r.refEf);
  const lr = r.longest;
  const long = lr.ratio != null && lr.category !== "dans_la_regle";
  return (
    <Section title="Ce que dit la sortie" id="lecture">
      <ul className="grid max-w-[68ch] gap-4">
        <li className="text-body text-pretty">{typo(decouplingText(a.decoupling, a.heat))}</li>
        {ef && <li className="text-body text-pretty">{typo(ef)}</li>}
        {a.vo2 != null && <li className="text-body text-pretty">{`VO2max estimée sur cette sortie : ${fmt(a.vo2, 1)}${NB}mL/kg/min. Une indication, à lire en tendance avec celle de la montre.`}</li>}
        {r.run.distanceKm != null && <li className="text-body text-pretty">{`${kmText(r.run.distanceKm)}${lr.ratio != null ? `, ${fmt(lr.ratio * 100)}${NB}% de la plus longue des 30 jours d’avant (${LONGEST_LABEL[lr.category]}).` : " : pas de course dans les 30 jours d’avant."}`}</li>}
      </ul>
      {long && <Note tone="warn" title={`Plus longue de ${fmt((lr.ratio! - 1) * 100)}${NB}% que la plus longue des 30 jours`}>La prochaine sortie longue attend au moins 7 jours : c’est au-delà de 10 % que le risque de blessure monte.</Note>}
      <HowCalc>
        <p>{typo("Découplage : on coupe la sortie en deux moitiés de même durée, sans les 10 premières minutes, et on compare l’allure par battement de cœur. Sous 5 %, l’endurance tient ; au-delà de 8 %, le cœur a dérivé (durée, chaleur, eau, fatigue). Il faut 30 minutes stables en endurance pour le calculer.")}</p>
        <p>Allure ajustée : un kilomètre en montée compte comme plus rapide, en descente comme un peu plus lent (Minetti, borné).</p>
        <p>Charge : ta fréquence cardiaque seconde par seconde, pondérée vers les minutes intenses ; 100 points, c’est une heure à ton seuil.</p>
      </HowCalc>
    </Section>
  );
}

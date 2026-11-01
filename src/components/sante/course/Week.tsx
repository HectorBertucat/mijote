// La semaine en cours : sept colonnes (un jour chacune) avec la course prévue, faite ou manquée, et la natation
// ou le renforcement autour ; dessous, les séances en liste à filets avec leur état. Rendu serveur.
import Link from "next/link";
import { Icon } from "@/components/ui";
import type { CourseView } from "@/lib/running/page";
import { KIND_LABEL, type SessionKind } from "@/lib/running/workout";
import { OTHER_LABEL, type OtherKind, type PlannedRow, type WeekDay } from "@/lib/running/view";
import { dayLabel } from "@/lib/running/dates";
import { NB, Section } from "../carnet";
import { hourText } from "./Today";

/** Au téléphone, une colonne fait 45 px : le mot court ; plus large, le mot entier. */
const SHORT: Record<OtherKind, string> = { natation: "nage", kettlebell: "kb", renfo: "renfo", velo: "vélo", marche: "marche", autre: "autre" };
export const STATUS_TEXT: Record<PlannedRow["status"], string> = { prevue: "prévue", programmee: "sur ta montre", faite: "faite", manquee: "manquée", annulee: "annulée" };

/** La marque d'un jour : la course (minutes) pleine si faite, au trait si prévue, barrée si manquée. */
function DayMark({ d }: { d: WeekDay }) {
  const r = d.planned[0];
  const extra = d.runs.filter((x) => !x.plannedId || x.plannedId !== r?.id);
  if (!r && !extra.length) return <span className="block h-9" />;
  if (!r) return <span className="num grid h-9 place-items-center rounded-[8px] bg-ink text-small font-bold text-bg">{Math.round(extra[0].minutes)}</span>;
  const cls =
    r.status === "faite"
      ? "bg-ink text-bg"
      : r.status === "manquee"
        ? "text-ink-3 line-through"
        : r.status === "annulee"
          ? "text-ink-3 line-through"
          : d.today
            ? "border-2 border-accent text-ink"
            : "border border-line-strong text-ink";
  return <span className={`num grid h-9 place-items-center rounded-[8px] text-small font-bold ${cls}`}>{r.status === "faite" && r.sampleId ? Math.round(d.runs.find((x) => x.sampleId === r.sampleId)?.minutes ?? r.minutes) : r.minutes}</span>;
}

export function WeekStrip({ v }: { v: CourseView }) {
  const rows = v.week.flatMap((d) => d.planned);
  return (
    <Section title="La semaine" id="semaine" aside={<span className="text-small text-ink-2">{v.weekText}</span>}>
      <ol className="grid grid-cols-7 gap-1 sm:gap-2" aria-label="Les sept jours">
        {v.week.map((d) => {
          const r = d.planned[0];
          const others = [...d.others.map((o) => o.kind), ...d.fixed];
          const text = [r ? `${KIND_LABEL[r.kind as SessionKind] ?? "course"} ${r.minutes}${NB}min, ${STATUS_TEXT[r.status]}` : d.runs.length ? `course ${Math.round(d.runs[0].minutes)}${NB}min` : "pas de course", ...d.others.map((o) => `${OTHER_LABEL[o.kind].toLowerCase()} faite`), ...d.fixed.map((k) => `${OTHER_LABEL[k].toLowerCase()} prévue`)].join(", ");
          return (
            <li key={d.date} className={`grid min-w-0 content-start gap-2 border-t-2 pt-2 ${d.today ? "border-accent" : "border-line"}`}>
              <span className={`label ${d.today ? "text-accent" : "text-ink-2"}`}>
                <span aria-hidden>{d.short}</span>
                <span className="sr-only">{`${dayLabel(d.date)} : ${text}`}</span>
              </span>
              <span aria-hidden className={`num-tight text-h3 leading-none ${d.past && !d.today ? "text-ink-2" : "text-ink"}`}>
                {Number(d.date.slice(8))}
              </span>
              <span aria-hidden>
                <DayMark d={d} />
              </span>
              <span aria-hidden className="grid gap-0.5 text-[12px] leading-tight text-ink-2">
                {others.map((k, i) => (
                  <span key={`${k}-${i}`} className={`truncate ${d.fixed.includes(k as OtherKind) && i >= d.others.length ? "text-ink-3" : ""}`}>
                    <span className="sm:hidden">{SHORT[k as OtherKind]}</span>
                    <span className="max-sm:hidden">{OTHER_LABEL[k as OtherKind].toLowerCase()}</span>
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
      {rows.length > 0 && (
        <ul className="grid border-t border-line">
          {rows.map((r) => {
            const day = v.week.find((d) => d.date === r.date)!;
            const run = r.sampleId ? day.runs.find((x) => x.sampleId === r.sampleId) : null;
            const body = (
              <>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-small text-ink-2">
                    {dayLabel(r.date)}
                    {hourText(r.time) ? ` · ${hourText(r.time)}` : ""}
                  </span>
                  <span className={`font-bold ${r.status === "annulee" || r.status === "manquee" ? "text-ink-3 line-through" : "text-ink"}`}>{r.session.title}</span>
                  {r.status === "annulee" && <span className="text-small text-ink-2">{r.session.notes}</span>}
                </span>
                <span className="grid justify-items-end gap-0.5 text-right">
                  <span className="num text-small font-bold text-ink">{`${r.minutes}${NB}min`}</span>
                  <span className={`label ${r.status === "faite" ? "text-ok" : r.status === "programmee" ? "text-ink" : "text-ink-2"}`}>{STATUS_TEXT[r.status]}</span>
                </span>
              </>
            );
            return (
              <li key={r.id} className="border-b border-line">
                {run ? (
                  <Link href={`/sante/course/${run.sampleId}`} className="-mx-3 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 rounded-[8px] px-3 py-3 hover:bg-surface-2">
                    {body}
                    <Icon name="chev" size="s" className="text-ink-3" />
                  </Link>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

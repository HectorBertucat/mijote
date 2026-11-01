// « Course » dans la vue d'ensemble, quand le module est activé : la prochaine séance, la semaine en sept cases,
// la forme et sa courbe sur trois mois. Tout vient de courseView (src/lib/running/page.ts) ; le détail est sur
// la page Course.
import Link from "next/link";
import { Icon } from "@/components/ui";
import { Sparkline } from "@/components/ui/charts";
import { hourText, whenText } from "@/components/sante/course/Today";
import { STATUS_TEXT } from "@/components/sante/course/Week";
import type { CourseView } from "@/lib/running/page";
import { durText, FORM_LABEL } from "@/lib/running/view";
import { KIND_LABEL, type SessionKind } from "@/lib/running/workout";
import { NB, Section, Verdict } from "../carnet";

export function RunningSection({ v }: { v: CourseView }) {
  const h = v.head;
  const f = v.form;
  return (
    <Section
      title="Course"
      id="course"
      aside={
        <Link href="/sante/course" className="inline-flex min-h-tap items-center gap-1 font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Ouvrir
          <Icon name="chev" size="s" />
        </Link>
      }
    >
      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-3">
        <Link href="/sante/course" className="group -m-3 grid content-start gap-2 rounded-[8px] p-3 hover:bg-surface-2">
          <span className="label text-ink-2">{h ? (h.when === "today" ? "Aujourd’hui" : `Prochaine · ${whenText(h.row.date, v.today)}`) : v.plan.paused ? "En pause" : "Prochaine séance"}</span>
          {h ? (
            <>
              <b className="text-h3">{KIND_LABEL[h.row.kind as SessionKind] ?? h.row.session.title}</b>
              <span className="num-tight block text-[clamp(2.25rem,1.9rem+1vw,2.75rem)] leading-[0.9] text-ink">{durText(h.row.minutes * 60)}</span>
              <span className="text-small text-ink-2">
                {h.watch.kind === "montre" ? <Verdict tone="ok">Sur ta montre</Verdict> : `${hourText(h.row.time) ?? ""}${hourText(h.row.time) ? " · " : ""}à programmer`}
              </span>
            </>
          ) : (
            <span className="text-small text-ink-2">Rien de prévu dans les jours qui viennent.</span>
          )}
        </Link>
        <div className="grid content-start gap-3">
          <span className="label text-ink-2">La semaine</span>
          <ol className="grid grid-cols-7 gap-1" aria-label="La semaine de course">
            {v.week.map((d) => {
              const r = d.planned[0];
              const done = r?.status === "faite" || (!r && d.runs.length > 0);
              return (
                <li key={d.date} className="grid justify-items-center gap-1">
                  <span aria-hidden className={`text-[12px] leading-none ${d.today ? "font-bold text-accent" : "text-ink-2"}`}>
                    {d.short.slice(0, 1).toUpperCase()}
                  </span>
                  <span
                    aria-hidden
                    className={`block size-5 rounded-[4px] ${done ? "bg-ink" : r && r.status !== "annulee" && r.status !== "manquee" ? (d.today ? "border-2 border-accent" : "border border-line-strong") : r?.status === "manquee" ? "border border-line" : "bg-surface-2"}`}
                  />
                  <span className="sr-only">{`${d.short} : ${r ? `${KIND_LABEL[r.kind as SessionKind] ?? "course"}, ${STATUS_TEXT[r.status]}` : done ? "course faite" : "pas de course"}`}</span>
                </li>
              );
            })}
          </ol>
          <span className="text-small text-ink-2">{v.weekText}</span>
        </div>
        <div className="grid content-start gap-2">
          <span className="label text-ink-2">Forme</span>
          {f ? (
            <>
              <b className="num-tight block text-[clamp(2.25rem,1.9rem+1vw,2.75rem)] leading-[0.9] text-ink">
                {f.forme}
                {f.delta28 ? <span className="ml-1.5 text-[0.36em] font-[650] tracking-normal text-ink-2 [font-stretch:100%]">{`${f.delta28 > 0 ? "+" : "−"}${Math.abs(f.delta28)} en 4${NB}sem.`}</span> : null}
              </b>
              <Sparkline values={v.fitness.map((d) => Math.round(d.ctl))} label="Forme, trois mois" className="mt-1" />
              <span className="text-small text-ink-2">{f.band ? `${FORM_LABEL[f.band]}, fraîcheur ${f.fraicheur! > 0 ? "+" : f.fraicheur! < 0 ? "−" : ""}${Math.abs(f.fraicheur!)}${NB}%` : `fatigue ${f.fatigue}`}</span>
            </>
          ) : (
            <span className="text-small text-ink-2">Elle se lit après quelques séances.</span>
          )}
        </div>
      </div>
    </Section>
  );
}

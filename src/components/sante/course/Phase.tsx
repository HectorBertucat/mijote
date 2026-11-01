// Où j'en suis : la frise des phases jusqu'à celle de l'objectif (la phase en cours en cocotte), la semaine et
// le niveau, puis les critères de passage à la suivante, cochés par le code (plan.ts). Rendu serveur.
import { Icon } from "@/components/ui";
import type { CourseView } from "@/lib/running/page";
import { GOAL_LABEL, type RunGoal } from "@/lib/running/plan";
import { typo } from "@/lib/typo";
import { Section } from "../carnet";

export function PhaseTrack({ v }: { v: CourseView }) {
  const p = v.plan;
  const next = p.next;
  const met = next ? next.criteria.filter((c) => c.ok).length : 0;
  return (
    <Section title="Où j’en suis" id="phase" aside={<span className="text-small text-ink-2">{`Objectif : ${GOAL_LABEL[v.profile.goal as RunGoal].toLowerCase()}`}</span>}>
      <ol className="grid auto-cols-fr grid-flow-col gap-2" aria-label="Les phases du plan">
        {p.track.map((s) => (
          <li key={s.phase} aria-current={s.state === "en_cours" ? "step" : undefined} className="grid min-w-0 content-start gap-2">
            <span className={`block h-1.5 rounded-full ${s.state === "faite" ? "bg-ink" : s.state === "en_cours" ? "bg-accent" : "bg-surface-2"}`} />
            <span className={`label ${s.state === "en_cours" ? "text-accent" : s.state === "faite" ? "text-ink" : "text-ink-3"}`}>{`Phase ${s.phase}`}</span>
            <span className={`text-small text-pretty ${s.state === "a_venir" ? "text-ink-3" : "text-ink"}`}>
              {s.label}
              <span className="sr-only">{s.state === "faite" ? ", faite" : s.state === "en_cours" ? ", en cours" : ", à venir"}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="grid gap-6 lg:grid-cols-12">
        <p className="text-lead text-pretty lg:col-span-5">
          {`Semaine ${p.weekInPhase} de la phase ${p.phase}`}
          {p.level ? `, niveau ${p.level} sur 8 de marche-course` : ""}.
          {next ? ` ${met} critère${met > 1 ? "s" : ""} sur ${next.criteria.length} pour passer à la phase ${next.phase}.` : " C’est la dernière phase de ton objectif : on consolide, et c’est très bien ainsi."}
        </p>
        {next && (
          <ul className="grid content-start border-t border-line lg:col-span-7" aria-label={`Critères de la phase ${next.phase}`}>
            {next.criteria.map((c) => (
              <li key={c.label} className="flex items-start gap-3 border-b border-line py-3">
                <Icon name={c.ok ? "check" : "minus"} size="s" strokeWidth={c.ok ? 2.6 : 2} className={`mt-1 shrink-0 ${c.ok ? "text-ok" : "text-ink-3"}`} />
                <span className={c.ok ? "text-ink" : "text-ink-2"}>
                  {typo(c.label)}
                  <span className="sr-only">{c.ok ? " : rempli" : " : pas encore"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

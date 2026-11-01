// En tête de la page Course : la séance du jour (ou la prochaine). Le type en grand et la durée, l'état sur la
// montre, le profil et les blocs avec leurs cibles, pourquoi cette séance (phrase calculée, view.ts), et à
// côté ce qui l'accompagne : le conseil de nutrition, le ressenti à noter, le coach.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";
import type { CourseView } from "@/lib/running/page";
import { daysBetween, WEEKDAY_LABEL, weekday } from "@/lib/running/dates";
import { KIND_LABEL, type SessionKind } from "@/lib/running/workout";
import { durText, type FuelAdvice } from "@/lib/running/view";
import { typo } from "@/lib/typo";
import { NB, Note, Verdict } from "../carnet";
import { SessionBlocks, SessionProfile } from "./Session";

/** « aujourd’hui », « demain », « jeudi », « jeu. 13 nov. ». */
export function whenText(date: string, today: string) {
  const d = daysBetween(today, date);
  if (d === 0) return "aujourd’hui";
  if (d === 1) return "demain";
  if (d > 1 && d < 7) return WEEKDAY_LABEL[weekday(date)];
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
export const hourText = (t: string | null) => (t ? t.replace(":", `${NB}h${NB}`).replace(/ h 00$/, `${NB}h`) : null);

export function Fuel({ f }: { f: FuelAdvice }) {
  return (
    <div className="grid content-start gap-3">
      <span className="label text-ink-2">À table</span>
      <b className="text-h3">{f.title}</b>
      <ul className="grid gap-2 border-l-2 border-line-strong pl-4 text-small text-ink-2">
        {f.lines.map((l) => (
          <li key={l}>{typo(l)}</li>
        ))}
      </ul>
    </div>
  );
}

export function TodayHero({ v, aside }: { v: CourseView; aside?: ReactNode }) {
  const h = v.head;
  const done = v.doneToday;
  return (
    <section aria-labelledby="seance" className="grid gap-12 lg:grid-cols-12 lg:gap-6">
      <div className="grid min-w-0 content-start gap-6 lg:col-span-7">
        {done && (
          <Note
            title="Séance du jour faite"
            action={
              done.sampleId && (
                <Link href={`/sante/course/${done.sampleId}`} className="inline-flex min-h-tap items-center gap-1 font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  Voir la sortie
                  <Icon name="chev" size="s" />
                </Link>
              )
            }
          >
            {done.row.session.title}
          </Note>
        )}
        {v.cancelledToday && h?.when !== "today" && <Note title="Pas de course aujourd’hui">{typo(v.cancelledToday.session.notes)}</Note>}
        {h ? (
          <>
            <div className="grid gap-3">
              <p className="label text-ink-2">
                {h.when === "today" ? "Aujourd’hui" : `Prochaine séance · ${whenText(h.row.date, v.today)}`}
                {hourText(h.row.time) && <span>{` · ${hourText(h.row.time)}`}</span>}
              </p>
              <h2 id="seance" className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="text-h1">{KIND_LABEL[h.row.kind as SessionKind] ?? h.row.session.title}</span>
                <span className="num-tight text-h1 text-ink-2">{durText(h.row.minutes * 60)}</span>
              </h2>
              <p className="text-body text-ink-2">{h.row.session.title}</p>
              <p>
                {h.watch.kind === "montre" ? (
                  <Verdict tone="ok">Sur ta montre</Verdict>
                ) : (
                  <span className="inline-flex items-start gap-2 text-small text-ink-2">
                    <Icon name={h.watch.kind === "erreur" ? "alert" : "clock"} size="s" className="mt-0.5 shrink-0" />
                    {h.watch.text}
                  </span>
                )}
              </p>
            </div>
            <SessionProfile profile={h.profile} />
            <SessionBlocks blocks={h.blocks} />
            <div className="grid max-w-[62ch] gap-3">
              <p className="text-lead text-pretty text-ink">{typo(h.why.join(" "))}</p>
              {h.row.session.notes && <p className="text-small text-ink-2">{typo(h.row.session.notes)}</p>}
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <h2 id="seance" className="text-h1">
              {v.plan.paused ? "En pause" : "Rien de prévu"}
            </h2>
            <p className="max-w-[52ch] text-lead text-ink-2">
              {v.plan.paused ? typo(v.plan.messages[0] ?? "Le plan est en pause.") : "Pas de séance dans les jours qui viennent : vérifie tes jours disponibles dans les réglages."}
            </p>
          </div>
        )}
      </div>
      <aside aria-label="Autour de la séance" className="grid min-w-0 content-start gap-8 border-t border-line pt-6 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
        {h?.fuel && <Fuel f={h.fuel} />}
        {aside}
      </aside>
    </section>
  );
}

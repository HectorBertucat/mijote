// Résumé des objectifs et historique d’activité (vue d’ensemble, page Objectifs). Sans état, côté serveur.
// Mise en page carnet : sections à filet, lignes de définition, barres d’encre.
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { GOAL_LABEL } from "@/lib/health/core";
import { frDate } from "@/lib/health/goal-format";
import { projection, SPORTS, weekAgainstPlan, weeklyCounts, type Session, type SportPlanItem } from "@/lib/health/goals";
import { NB, Row, Section, signed, Verdict } from "./carnet";

const fr = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

export interface GoalSummary {
  goal: keyof typeof GOAL_LABEL | null;
  ratePct: number; // rythme effectif (profil ou défaut de l’objectif)
  proteinText: string | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  trendKg: number | null;
  plan: SportPlanItem[];
  constraints: string | null;
}

export function GoalCard({ g, sessions, monday, today, coachLink = true, className = "" }: { g: GoalSummary; sessions: Session[]; monday: string; today: string; coachLink?: boolean; className?: string }) {
  const eta = g.targetWeightKg != null && g.trendKg != null ? projection(g.trendKg, g.targetWeightKg, g.ratePct, today) : null;
  const late = eta && g.targetDate && eta.date > g.targetDate;
  const week = weekAgainstPlan(sessions, g.plan, monday);
  const empty = !g.goal && g.targetWeightKg == null && !g.plan.length;
  return (
    <Section title="Objectifs" id="objectifs" aside={g.goal && <span className="label text-ink-2">{GOAL_LABEL[g.goal]}</span>} className={className}>
      {empty ? (
        <p className="text-body text-ink-2">Pas encore d’objectifs. Le coach t’aide à les fixer en quelques messages, à partir de tes vraies données.</p>
      ) : (
        <dl className="grid border-t border-line">
          {g.targetWeightKg != null && (
            <Row k="Poids visé">
              <b className="num-tight text-[24px] leading-none">
                {fr(g.targetWeightKg)}
                {NB}kg
              </b>
              <span className="mt-1 block text-small text-ink-2">
                {g.trendKg != null && `encore ${fr(Math.abs(g.trendKg - g.targetWeightKg))}${NB}kg`}
                {eta && eta.weeks > 0 && `, vers le ${frDate(eta.date)} (${eta.weeks}${NB}sem.)`}
              </span>
              {eta && eta.weeks === 0 && <Verdict tone="ok" className="mt-2">atteint</Verdict>}
              {g.trendKg != null && !eta && <Verdict tone="warn" className="mt-2">le rythme ne va pas dans ce sens</Verdict>}
              {late && <span className="mt-2 block text-small text-warn-ink">Après l’échéance souhaitée ({frDate(g.targetDate!)}) : à ce rythme, il faut plus de temps.</span>}
            </Row>
          )}
          {g.goal && (
            <Row k="Rythme">
              <span className="num">
                {signed(g.ratePct, 2)}
                {NB}% du poids par semaine
              </span>
            </Row>
          )}
          {g.proteinText && <Row k="Protéines">{g.proteinText}</Row>}
          {week.length > 0 && (
            <Row k="Sport cette semaine">
              <ul className="grid gap-1">
                {week.map((w) => {
                  const met = w.planned && w.done >= w.planned;
                  return (
                    <li key={w.kind} className="flex flex-wrap items-baseline gap-x-3">
                      <span>
                        {SPORTS[w.kind]} <span className="num text-ink-2">{`${w.done}${w.planned ? `${NB}/${NB}${w.planned}` : ""}`}</span>
                      </span>
                      {met ? <Verdict tone="ok">tenu</Verdict> : null}
                    </li>
                  );
                })}
              </ul>
            </Row>
          )}
          {g.constraints && (
            <Row k="Ce que tu peux faire">
              <span className="whitespace-pre-wrap text-small">{g.constraints}</span>
            </Row>
          )}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {coachLink && (
          <Link href="/sante/objectifs" className={buttonClass({ size: "sm", variant: empty ? "primary" : "secondary" })}>
            {empty ? "Fixer mes objectifs" : "En parler au coach"}
          </Link>
        )}
        <Link href="/sante/profil" className={buttonClass({ size: "sm", variant: "quiet" })}>
          Modifier à la main
        </Link>
      </div>
    </Section>
  );
}

export function ActivityCard({ sessions, plan, monday, className = "", compact = false }: { sessions: Session[]; plan: SportPlanItem[]; monday: string; className?: string; compact?: boolean }) {
  const weeks = weeklyCounts(sessions, monday, 12);
  const target = plan.reduce((s, p) => s + p.perWeek, 0);
  const max = Math.max(target + 1, ...weeks.map((w) => w.count), 3);
  const recent = sessions.slice(0, 6);
  const H = 120;
  return (
    <Section title="Activité" id="activite" aside={target > 0 && <span className="label text-ink-2">{`visé ${target} séance${target > 1 ? "s" : ""} par semaine`}</span>} className={className}>
      {sessions.length ? (
        <div className={`grid gap-12 ${compact ? "" : "lg:grid-cols-12 lg:gap-6"}`}>
          <figure className={`grid gap-3 ${compact ? "" : "lg:col-span-7"}`}>
            <div className="relative" style={{ height: H }}>
              <ol className="absolute inset-0 grid items-end gap-2" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }} aria-label="Séances par semaine, sur 12 semaines">
                {weeks.map((w, i) => {
                  const now = i === weeks.length - 1;
                  return (
                    <li key={w.weekStart} className="grid h-full content-end justify-items-center gap-1" title={`Semaine du ${frDate(w.weekStart)} : ${w.count} séance${w.count > 1 ? "s" : ""}`}>
                      {w.count > 0 && <span className={`num text-[12px] ${now ? "text-ink" : "text-ink-3"}`}>{w.count}</span>}
                      <i aria-hidden className={`block w-full max-w-6 ${w.count ? (now ? "bg-ink" : "bg-ink-2") : "h-px bg-line-strong"}`} style={w.count ? { height: `${(w.count / max) * (H - 20)}px` } : undefined} />
                      <span className="sr-only">{`Semaine du ${frDate(w.weekStart)} : ${w.count}`}</span>
                    </li>
                  );
                })}
              </ol>
              {target > 0 && <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-3" style={{ bottom: (target / max) * (H - 20) }} />}
            </div>
            <div className="grid gap-2 text-[12px] text-ink-3" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }} aria-hidden>
              {weeks.map((w, i) => (
                <span key={w.weekStart} className="num text-center">
                  {i % 2 === 0 || i === weeks.length - 1 ? Number(w.weekStart.slice(8, 10)) : ""}
                </span>
              ))}
            </div>
            <figcaption className="text-small text-ink-2">Séances par semaine, du lundi au dimanche ; carnet et Apple Santé réunis.</figcaption>
          </figure>
          <ul className={`reveal grid content-start border-t border-line ${compact ? "" : "lg:col-span-5"}`}>
            {recent.map((s, i) => (
              <li key={`${s.date}-${i}`} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                <span className="min-w-0">
                  <b className="font-bold">{s.label}</b>
                  {s.minutes ? <span className="num text-ink-2">{` · ${s.minutes}${NB}min`}</span> : null}
                </span>
                <span className="whitespace-nowrap text-small text-ink-2">{shortDay(s.date)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="max-w-[62ch] text-body text-ink-2">Aucune séance encore. Les séances guidées de l’onglet Entraînement s’ajoutent seules ; la natation, la course ou le vélo viennent d’Apple Santé.</p>
      )}
    </Section>
  );
}

// Résumé des objectifs et historique d'activité (vue d'ensemble, page Objectifs). Sans état, côté serveur.
import Link from "next/link";
import { buttonClass, Card, DayBars, Pill } from "@/components/ui";
import { GOAL_LABEL } from "@/lib/health/core";
import { frDate } from "@/lib/health/goal-format";
import { projection, SPORTS, weekAgainstPlan, weeklyCounts, type Session, type SportPlanItem } from "@/lib/health/goals";

const fr = (x: number, d = 1) => x.toFixed(d).replace(".", ",");
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

export interface GoalSummary {
  goal: keyof typeof GOAL_LABEL | null;
  ratePct: number; // rythme effectif (profil ou défaut de l'objectif)
  proteinText: string | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  trendKg: number | null;
  plan: SportPlanItem[];
  constraints: string | null;
}

export function GoalCard({ g, sessions, monday, today, coachLink = true }: { g: GoalSummary; sessions: Session[]; monday: string; today: string; coachLink?: boolean }) {
  const eta = g.targetWeightKg != null && g.trendKg != null ? projection(g.trendKg, g.targetWeightKg, g.ratePct, today) : null;
  const late = eta && g.targetDate && eta.date > g.targetDate;
  const week = weekAgainstPlan(sessions, g.plan, monday);
  const empty = !g.goal && g.targetWeightKg == null && !g.plan.length;
  return (
    <Card pad="md" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[18px] font-bold">Objectifs</h2>
        {g.goal && <Pill tone="idle" icon="scale">{GOAL_LABEL[g.goal]}</Pill>}
      </div>
      {empty ? (
        <p className="text-[14px] text-ink-2">Pas encore d'objectifs. Le coach t'aide à les fixer en quelques messages, à partir de tes vraies données.</p>
      ) : (
        <dl className="grid gap-2 text-[14px]">
          {g.targetWeightKg != null && (
            <div className="grid gap-0.5">
              <dt className="text-ink-2">Poids visé</dt>
              <dd>
                <b className="text-[16px]">{fr(g.targetWeightKg)} kg</b>
                {g.trendKg != null && <span className="text-ink-2"> · encore {fr(Math.abs(g.trendKg - g.targetWeightKg))} kg</span>}
                {eta && eta.weeks > 0 && <span className="text-ink-2"> · vers le {frDate(eta.date)} ({eta.weeks} sem.)</span>}
                {eta && eta.weeks === 0 && <span className="text-ok-ink"> · atteint</span>}
                {g.trendKg != null && !eta && <span className="text-warn-ink"> · le rythme ne va pas dans ce sens</span>}
                {late && <span className="block text-[13px] text-warn-ink">Après l'échéance souhaitée ({frDate(g.targetDate!)}) : à ce rythme, il faut plus de temps.</span>}
              </dd>
            </div>
          )}
          {g.goal && (
            <div className="grid gap-0.5">
              <dt className="text-ink-2">Rythme et protéines</dt>
              <dd>
                {`${g.ratePct > 0 ? "+" : ""}${fr(g.ratePct, 2)} % du poids/sem.`}
                {g.proteinText && ` · ${g.proteinText}`}
              </dd>
            </div>
          )}
          {week.length > 0 && (
            <div className="grid gap-1">
              <dt className="text-ink-2">Sport cette semaine</dt>
              <dd className="flex flex-wrap gap-1.5">
                {week.map((w) => (
                  <Pill key={w.kind} tone={w.planned && w.done >= w.planned ? "ok" : "idle"} icon={w.planned && w.done >= w.planned ? "check" : "clock"}>
                    {`${SPORTS[w.kind]} ${w.done}${w.planned ? `/${w.planned}` : ""}`}
                  </Pill>
                ))}
              </dd>
            </div>
          )}
          {g.constraints && (
            <div className="grid gap-0.5">
              <dt className="text-ink-2">Ce que tu peux faire</dt>
              <dd className="whitespace-pre-wrap">{g.constraints}</dd>
            </div>
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
    </Card>
  );
}

export function ActivityCard({ sessions, plan, monday }: { sessions: Session[]; plan: SportPlanItem[]; monday: string }) {
  const weeks = weeklyCounts(sessions, monday, 12);
  const target = plan.reduce((s, p) => s + p.perWeek, 0);
  const max = Math.max(target + 1, ...weeks.map((w) => w.count), 3);
  const recent = sessions.slice(0, 6);
  return (
    <Card pad="md" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[18px] font-bold">Activité</h2>
        {target > 0 && <span className="text-[13px] text-ink-2">{`visé ${target} séance${target > 1 ? "s" : ""}/sem.`}</span>}
      </div>
      {sessions.length ? (
        <>
          <DayBars
            days={weeks.map((w) => ({
              label: String(Number(w.weekStart.slice(8, 10))),
              value: w.count,
              tone: target ? (w.count >= target ? "ok" : undefined) : undefined,
              title: `Semaine du ${frDate(w.weekStart)} : ${w.count} séance${w.count > 1 ? "s" : ""}`,
            }))}
            max={max}
            target={target || undefined}
          />
          <p className="text-[12px] text-faint">Séances par semaine sur 12 semaines (lundi de chaque semaine), carnet et Apple Santé réunis.</p>
          <ul className="grid gap-1 text-[14px]">
            {recent.map((s, i) => (
              <li key={`${s.date}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {s.label}
                  {s.minutes ? <span className="text-ink-2"> · {s.minutes} min</span> : null}
                </span>
                <span className="text-ink-2">{shortDay(s.date)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[14px] text-ink-2">
          Aucune séance encore. Les séances guidées de l'onglet Entraînement s'ajoutent seules ; les autres (natation, course…) viennent d'Apple Santé, par le Raccourci ou l'export.
        </p>
      )}
    </Card>
  );
}

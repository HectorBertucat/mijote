import { Card } from "@/components/ui";
import { Coach, type CoachView } from "@/components/sante/Coach";
import { ActivityCard, GoalCard } from "@/components/sante/Objectives";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { listCoach } from "@/lib/health/coach";
import { describeChanges, frDate } from "@/lib/health/goal-format";
import type { GoalProposal } from "@/lib/health/goals";
import { currentMonday, goalSummary, goalValues, listSessions } from "@/lib/health/objectives";
import { todayParis } from "@/lib/health/store";

export const dynamic = "force-dynamic";

const STARTERS = ["Aide-moi à fixer mes objectifs", "Je veux perdre du ventre", "Combien de protéines pour moi ?", "Quel sport je peux tenir ?", "Où j'en suis ?"];

export default async function Objectifs() {
  const person = await activePerson();
  const current = goalValues(person);
  const none = { ...current, ...Object.fromEntries(Object.keys(current).map((k) => [k, null])) } as typeof current;
  const messages: CoachView[] = listCoach(db, person.id).map((m) => {
    const p = (m.proposal ?? null) as (GoalProposal & { eta?: { date: string; weeks: number }; why?: string }) | null;
    return {
      id: m.id,
      role: m.role,
      text: m.text,
      status: m.status,
      // « avant → après » seulement tant que la proposition est en attente : après, l'avant a changé.
      changes: p ? describeChanges(m.status === "proposed" ? current : none, p) : [],
      notes: m.notes ?? [],
      eta: p?.eta && p.eta.weeks > 0 ? `${frDate(p.eta.date)}, dans ${p.eta.weeks} semaines` : null,
      why: p?.why ?? null,
      suggestions: m.suggestions ?? [],
    };
  });
  const sessions = listSessions(db, person.id);
  const g = goalSummary(db, person);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Card pad="md" className="grid gap-3">
        <div>
          <h2 className="text-[18px] font-bold">Coach</h2>
          <p className="text-[13px] text-ink-2">Il lit ta courbe, ton journal et tes séances. Ce qu'il propose est vérifié par l'appli (rythme, protéines, poids sain, plancher calorique) avant que tu l'appliques.</p>
        </div>
        <Coach personId={person.id} personName={person.name} messages={messages} starters={STARTERS} />
      </Card>
      <div className="grid gap-5">
        <GoalCard g={g} sessions={sessions} monday={currentMonday()} today={todayParis()} coachLink={false} />
        <ActivityCard sessions={sessions} plan={g.plan} monday={currentMonday()} />
      </div>
    </div>
  );
}

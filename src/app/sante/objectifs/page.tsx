import { Section } from "@/components/sante/carnet";
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

const STARTERS = ["Aide-moi à fixer mes objectifs", "Je veux perdre du ventre", "Combien de protéines pour moi\u00a0?", "Quel sport je peux tenir\u00a0?", "Où j’en suis\u00a0?"];

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
    <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-6">
      <Section
        title="Coach"
        id="coach"
        className="lg:col-span-7 lg:pr-6"
        aside={<span className="label text-ink-2">Chaque proposition est vérifiée</span>}
      >
        <Coach personId={person.id} personName={person.name} messages={messages} starters={STARTERS} />
      </Section>
      <div className="grid gap-12 lg:col-span-5">
        <GoalCard g={g} sessions={sessions} monday={currentMonday()} today={todayParis()} coachLink={false} />
        <ActivityCard sessions={sessions} plan={g.plan} monday={currentMonday()} compact />
      </div>
    </div>
  );
}

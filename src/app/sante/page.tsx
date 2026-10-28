import Link from "next/link";
import { Alert, buttonClass, Card, EmptyState, Macro, MacroRow, Pill } from "@/components/ui";
import { ActivityCard, GoalCard } from "@/components/sante/Objectives";
import { QuickLog } from "@/components/sante/QuickLog";
import { WeightChart } from "@/components/sante/WeightChart";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { dailyWeights, missingForEstimate, rateOf, trendSeries, weeklyRate, type Confidence } from "@/lib/health/core";
import { currentMonday, goalSummary, listSessions } from "@/lib/health/objectives";
import { currentReview, listWaist, listWeighIns, todayParis, toProfile } from "@/lib/health/store";

export const dynamic = "force-dynamic";

const kg1 = (v: number) => v.toFixed(1).replace(".", ",");
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits).replace(".", ",")}`;
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

const CONFIDENCE: Record<Confidence, { tone: "ok" | "warn" | "idle"; word: string }> = {
  adaptive: { tone: "ok", word: "mesurée" },
  holding: { tone: "warn", word: "en attente" },
  estimate: { tone: "idle", word: "estimation" },
};

export default async function Sante() {
  const person = await activePerson();
  const profile = toProfile(person);
  const today = todayParis();
  const weighs = listWeighIns(db, person.id);
  const series = trendSeries(dailyWeights(weighs), today);
  const last = series[series.length - 1];
  const rate = weeklyRate(series);
  const aimed = last ? (rateOf(profile) / 100) * last.trend : null;
  const review = currentReview(db, person);
  const waist = listWaist(db, person.id);
  const missing = missingForEstimate(profile);
  const weighedToday = weighs.some((w) => w.date === today);
  const sessions = listSessions(db, person.id);
  const goals = goalSummary(db, person);
  const monday = currentMonday();
  const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {(missing.length > 0 || !person.goal) && (
        <Alert
          tone="info"
          title={`Profil de ${person.name} à compléter`}
          action={
            <Link href="/sante/profil" className={buttonClass({ size: "sm", variant: "primary" })}>
              Compléter
            </Link>
          }
        >
          Il manque : {[...missing, !person.goal && "objectif"].filter(Boolean).join(", ")}. Avec ça et une première pesée, l'appli calcule tes cibles.
        </Alert>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          <Card pad="md" className="grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              {last ? (
                <MacroRow>
                  <Macro size="lg" value={kg1(last.trend)} unit="kg" sub="tendance du poids" icon={null} />
                  {rate != null && <Macro value={signed(rate, 2)} unit="kg/sem." sub={aimed != null ? `visé ${signed(aimed, 2)} kg/sem.` : "sur 2 semaines"} icon={null} />}
                </MacroRow>
              ) : (
                <p className="text-ink-2">Pas encore de pesée.</p>
              )}
              {!weighedToday && <QuickLog personId={person.id} kind="weight" placeholder={last ? kg1(last.trend) : "00,0"} />}
            </div>
            {series.length > 1 ? (
              <WeightChart series={series} />
            ) : (
              <EmptyState icon="scale" title="La courbe arrive">
                Une pesée par jour, le matin à jeun, de préférence. Bientôt, ta balance l'enverra seule via Apple Santé.
              </EmptyState>
            )}
          </Card>
          <ActivityCard sessions={sessions} plan={goals.plan} monday={monday} />
        </div>

        <div className="grid gap-5">
          <GoalCard g={goals} sessions={sessions} monday={monday} today={today} />
          <Card pad="md" className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[18px] font-bold">Cible de la semaine</h2>
              {review && <Pill tone={CONFIDENCE[review.confidence].tone}>{`dépense ${CONFIDENCE[review.confidence].word}`}</Pill>}
            </div>
            {review ? (
              <>
                <MacroRow>
                  <Macro size="lg" value={review.targets.kcal} unit="kcal/j" sub={`dépense ${review.tdee} kcal, ${signed(review.targets.dailyDeltaKcal, 0)} visé`} icon={null} />
                  <Macro value={review.targets.proteinG} unit="g" sub="protéines par jour" icon={null} />
                  <Macro value={review.targets.fatMinG} unit="g" sub="lipides, au moins" icon={null} />
                </MacroRow>
                <p className="text-[14px] text-ink-2">{review.explanation}</p>
                {review.confidence !== "adaptive" && (
                  <p className="text-[13px] text-faint">La dépense devient « mesurée » après 3 semaines avec au moins 4 journées complètes sur 7 et une pesée par semaine. Les repas se notent dans l'onglet Aujourd'hui.</p>
                )}
              </>
            ) : (
              <p className="text-[14px] text-ink-2">Il faut un profil complet et une première pesée.</p>
            )}
          </Card>

          <Card pad="md" className="grid gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[18px] font-bold">Tour de taille</h2>
              {isMonday && (
                <Pill tone="idle" icon="cal">
                  c'est lundi
                </Pill>
              )}
            </div>
            {waist.length > 0 ? (
              <MacroRow>
                <Macro value={String(waist[waist.length - 1].cm).replace(".", ",")} unit="cm" sub={`le ${fmtDay(waist[waist.length - 1].date)}`} icon={null} />
                {waist.length > 1 && <Macro value={signed(waist[waist.length - 1].cm - waist[0].cm)} unit="cm" sub={`depuis le ${fmtDay(waist[0].date)}`} icon={null} />}
              </MacroRow>
            ) : (
              <p className="text-[14px] text-ink-2">Mesuré le lundi matin, au niveau du nombril, ventre relâché. Pour perdre du ventre, c'est le vrai juge : le poids peut stagner pendant que la taille baisse.</p>
            )}
            <QuickLog personId={person.id} kind="waist" placeholder="84" />
          </Card>
        </div>
      </div>
    </div>
  );
}

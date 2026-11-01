import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { de, HowCalc, KeyFigure, NB, NNB, Note, Section, signed, Verdict } from "@/components/sante/carnet";
import { GoalCard } from "@/components/sante/Objectives";
import { QuickLog } from "@/components/sante/QuickLog";
import { Evolution } from "@/components/sante/overview/Evolution";
import { KeyTiles } from "@/components/sante/overview/KeyTiles";
import { RecentActivity } from "@/components/sante/overview/RecentActivity";
import { RunningSection } from "@/components/sante/overview/Running";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { missingForEstimate, rateOf, type Confidence } from "@/lib/health/core";
import { currentMonday, goalSummary, listSessions } from "@/lib/health/objectives";
import { overview } from "@/lib/health/overview";
import { DEFAULT_PERIOD, isPeriod } from "@/lib/health/series";
import { currentReview, listWaist, todayParis, toProfile } from "@/lib/health/store";
import { courseView } from "@/lib/running/page";
import { getRunProfile } from "@/lib/running/store";
import { typo } from "@/lib/typo";

export const dynamic = "force-dynamic";

const kg1 = (v: number) => v.toFixed(1).replace(".", ",");
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

const CONFIDENCE: Record<Confidence, { tone: "ok" | "warn" | "idle"; word: string }> = {
  adaptive: { tone: "ok", word: "mesurée" },
  holding: { tone: "warn", word: "en attente" },
  estimate: { tone: "idle", word: "estimation" },
};

// La vue d'ensemble se lit de haut en bas : la phrase de la semaine, les chiffres du jour (poids, cible),
// ceux de la semaine (pas, séances, sommeil, cœur), l'activité, puis l'évolution sur la période choisie.
// Chaque partie est un composant de src/components/sante/overview/ : une rubrique de plus (la course) s'y ajoute.
export default async function Sante({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const { periode } = await searchParams;
  const person = await activePerson();
  const profile = toProfile(person);
  const today = todayParis();
  const o = overview(db, person, isPeriod(periode) ? periode : DEFAULT_PERIOD, today);
  const last = o.trend;
  const aimed = last ? (rateOf(profile) / 100) * last.kg : null;
  const review = currentReview(db, person);
  const waist = listWaist(db, person.id);
  const missing = missingForEstimate(profile);
  const weighedToday = o.weight.length > 0 && o.weight[o.weight.length - 1].date === today && o.weight[o.weight.length - 1].kg != null;
  const sessions = listSessions(db, person.id);
  const goals = goalSummary(db, person);
  const monday = currentMonday();
  const isMonday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  const tone = review ? CONFIDENCE[review.confidence] : null;
  const running = getRunProfile(db, person.id)?.enabled ? courseView(db, person.id) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      {(missing.length > 0 || !person.goal) && (
        <Note
          title={`Profil ${de(person.name)} à compléter`}
          action={
            <Link href="/sante/profil" className={buttonClass({ size: "sm", variant: "primary" })}>
              Compléter
            </Link>
          }
        >
          Il manque : {[...missing, !person.goal && "objectif"].filter(Boolean).join(", ")}. Avec ça et une première pesée, l’appli calcule tes cibles.
        </Note>
      )}

      {/* La phrase de la semaine, calculée (src/lib/health/series.ts, `synthesis`) : des chiffres, pas d’avis. */}
      <p className="max-w-[62ch] text-lead text-pretty text-ink">
        {o.synthesis.length ? typo(o.synthesis.join(" ")) : "Rien de mesuré ces derniers jours. Une pesée, une séance ou l’app Mijote Santé, et cette page se remplit."}
      </p>

      {/* Les chiffres du jour, en grand : la tendance d’abord, la cible et les protéines ensuite. */}
      <section aria-label="Chiffres du jour" className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-4 lg:col-span-5">
          {last ? (
            <KeyFigure
              size="display"
              label="Tendance du poids"
              value={kg1(last.kg)}
              unit="kg"
              sub={
                last.rate != null ? (
                  <>
                    <b className="num text-ink">{`${signed(last.rate, 2)}${NB}kg`}</b> par semaine
                    {aimed != null && <>{`, visé ${signed(aimed, 2)}${NB}kg`}</>}
                  </>
                ) : (
                  "le rythme se calcule sur deux semaines"
                )
              }
            />
          ) : (
            <KeyFigure size="display" label="Tendance du poids" value="—" sub="Pas encore de pesée." />
          )}
          {!weighedToday && <QuickLog personId={person.id} kind="weight" placeholder={last ? kg1(last.kg) : "00,0"} />}
        </div>
        <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 lg:col-span-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          {review ? (
            <>
              <KeyFigure label="Cible du jour" value={review.targets.kcal.toLocaleString("fr-FR")} unit="kcal" sub={tone && <Verdict tone={tone.tone}>{`dépense ${tone.word}`}</Verdict>} />
              <KeyFigure label="Protéines" value={review.targets.proteinG} unit="g" sub={`par jour ; lipides, ${review.targets.fatMinG}${NB}g au moins`} />
              <HowCalc className="col-span-2">
                <p>
                  Dépense estimée {review.tdee.toLocaleString("fr-FR")}
                  {NB}kcal par jour, {signed(review.targets.dailyDeltaKcal, 0)}
                  {NB}kcal visés pour suivre ton rythme.
                </p>
                <p>{review.explanation}</p>
                {review.confidence !== "adaptive" && <p>La dépense devient «{NNB}mesurée{NNB}» après 3 semaines avec au moins 4 journées complètes sur 7 et une pesée par semaine. Les repas se notent dans l’onglet Aujourd’hui.</p>}
                <p>{typo("Le poids du jour bouge d’un kilo avec l’eau, le sel et le transit. La tendance est une moyenne qui lisse ces écarts : c’est elle qui dit si tu perds, pas la pesée du matin. Le rythme compare la tendance d’aujourd’hui à celle d’il y a deux semaines.")}</p>
              </HowCalc>
            </>
          ) : (
            <p className="col-span-2 max-w-[40ch] self-center text-body text-ink-2">La cible du jour et les protéines arrivent avec un profil complet et une première pesée.</p>
          )}
        </div>
      </section>

      <KeyTiles o={o} />
      {running && <RunningSection v={running} />}
      <RecentActivity o={o} />
      <Evolution o={o} />

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
        <GoalCard g={goals} sessions={sessions} monday={monday} today={today} ai={aiEnabled()} className="lg:col-span-7" />
        <Section title="Tour de taille" id="taille" className="lg:col-span-5" aside={isMonday && <span className="label text-accent">C’est lundi</span>}>
          {waist.length > 0 ? (
            <div className="grid grid-cols-2 gap-6">
              <KeyFigure size="lg" label={`Le ${fmtDay(waist[waist.length - 1].date)}`} value={String(waist[waist.length - 1].cm).replace(".", ",")} unit="cm" />
              {waist.length > 1 && <KeyFigure size="lg" label={`Depuis le ${fmtDay(waist[0].date)}`} value={signed(waist[waist.length - 1].cm - waist[0].cm)} unit="cm" />}
            </div>
          ) : (
            <p className="text-body text-ink-2">Mesuré le lundi matin, au nombril, ventre relâché. Le poids peut stagner pendant que la taille baisse : pour le ventre, c’est elle le vrai juge.</p>
          )}
          <QuickLog personId={person.id} kind="waist" placeholder="84" />
        </Section>
      </div>
    </div>
  );
}

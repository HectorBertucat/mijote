import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { de, HowCalc, KeyFigure, NB, NNB, Note, Section, signed, Verdict } from "@/components/sante/carnet";
import { ActivityCard, GoalCard } from "@/components/sante/Objectives";
import { QuickLog } from "@/components/sante/QuickLog";
import { WeightChart } from "@/components/sante/WeightChart";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { dailyWeights, missingForEstimate, rateOf, trendSeries, weeklyRate, type Confidence } from "@/lib/health/core";
import { currentMonday, goalSummary, listSessions } from "@/lib/health/objectives";
import { currentReview, listWaist, listWeighIns, todayParis, toProfile } from "@/lib/health/store";
import { bodySignals, type Signal } from "@/lib/health/samples";
import { hm } from "@/lib/health/sleep";

export const dynamic = "force-dynamic";

const kg1 = (v: number) => v.toFixed(1).replace(".", ",");
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const dec = (v: number, digits: number) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** « il y a un mois : 58 », s'il y a de quoi comparer. */
const monthAgo = (s: Signal, digits = 0, unit = "") => (s.before != null ? `il y a un mois : ${dec(s.before, digits)}${unit && NB + unit}` : `au ${fmtDay(s.at)}`);

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
  const body = bodySignals(db, person.id, today);
  const lastNight = body.sleep?.nights[body.sleep.nights.length - 1];

  const tone = review ? CONFIDENCE[review.confidence] : null;

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

      {/* Les trois chiffres du jour, en grand : la tendance d’abord, la cible et les protéines ensuite. */}
      <section aria-label="Chiffres du jour" className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-4 lg:col-span-5">
          {last ? (
            <KeyFigure
              size="display"
              label="Tendance du poids"
              value={kg1(last.trend)}
              unit="kg"
              sub={
                rate != null ? (
                  <>
                    <b className="num text-ink">{`${signed(rate, 2)}${NB}kg`}</b> par semaine
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
              </HowCalc>
            </>
          ) : (
            <p className="col-span-2 max-w-[40ch] self-center text-body text-ink-2">La cible du jour et les protéines arrivent avec un profil complet et une première pesée.</p>
          )}
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
        <Section
          title="Poids"
          id="poids"
          className="lg:col-span-8"
          aside={!weighedToday && <QuickLog personId={person.id} kind="weight" placeholder={last ? kg1(last.trend) : "00,0"} />}
        >
          {series.length > 1 ? (
            <WeightChart series={series} />
          ) : (
            <p className="max-w-[52ch] text-body text-ink-2">La courbe arrive avec la deuxième pesée. Une par jour, le matin à jeun, de préférence ; Apple Santé peut l’envoyer seul.</p>
          )}
          <HowCalc>
            <p>Le poids du jour bouge d’un kilo avec l’eau, le sel et le transit. La tendance est une moyenne qui lisse ces écarts : c’est elle qui dit si tu perds, pas la pesée du matin.</p>
            <p>Le rythme compare la tendance d’aujourd’hui à celle d’il y a deux semaines.</p>
          </HowCalc>
        </Section>

        <div className="grid content-start gap-12 lg:col-span-4">
          <GoalCard g={goals} sessions={sessions} monday={monday} today={today} />
          <Section title="Tour de taille" id="taille" aside={isMonday && <span className="label text-accent">C’est lundi</span>}>
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

      {/* Ce que l’app Mijote Santé envoie en plus du poids : seulement ce qui est arrivé. */}
      {(body.sleep || body.restingHr || body.hrv || body.vo2max || body.bodyFat) && (
        <Section title="Sommeil et forme" id="forme" aside={<span className="label text-ink-2">Apple Santé</span>}>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {body.sleep && lastNight && (
              <KeyFigure
                size="lg"
                className="col-span-2"
                label="Sommeil"
                value={hm(body.sleep.avgMin)}
                sub={
                  <>
                    par nuit sur {body.sleep.nights.length} {body.sleep.nights.length > 1 ? "nuits" : "nuit"} ; la dernière, {hm(lastNight.asleepMin)}
                    {lastNight.deepMin != null && lastNight.remMin != null && `, dont ${hm(lastNight.deepMin)} de profond et ${hm(lastNight.remMin)} de paradoxal`}
                  </>
                }
              />
            )}
            {body.restingHr && <KeyFigure size="lg" label="FC au repos" value={Math.round(body.restingHr.value)} unit="bpm" sub={`moyenne sur 7 jours ; ${monthAgo(body.restingHr)}`} />}
            {body.hrv && <KeyFigure size="lg" label="Variabilité cardiaque" value={Math.round(body.hrv.value)} unit="ms" sub={`moyenne sur 7 jours ; ${monthAgo(body.hrv)}`} />}
            {body.vo2max && <KeyFigure size="lg" label="VO2max" value={dec(body.vo2max.value, 1)} unit="mL/kg/min" sub={monthAgo(body.vo2max, 1)} />}
            {body.bodyFat && <KeyFigure size="lg" label="Masse grasse" value={dec(body.bodyFat.value, 1)} unit="%" sub={monthAgo(body.bodyFat, 1, "%")} />}
          </div>
          <HowCalc title="Comment les lire">
            <p>Ces chiffres viennent de la montre ou de la balance, par l’app Mijote Santé. Ils ne changent pas la cible : ils aident à comprendre une semaine difficile.</p>
            <p>Une FC au repos qui monte de quelques battements, ou une variabilité qui baisse, signale souvent la fatigue, un rhume ou un manque de sommeil. Comparer à soi-même, jamais aux autres.</p>
          </HowCalc>
        </Section>
      )}

      <ActivityCard sessions={sessions} plan={goals.plan} monday={monday} />
    </div>
  );
}

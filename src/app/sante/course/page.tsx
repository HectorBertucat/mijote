// Course (docs/course.md) : la séance du jour en tête (ou la prochaine) avec ce qui l'accompagne (nutrition,
// ressenti, coach), les signaux de prudence quand ils comptent, la semaine, la phase, la forme sur trois mois,
// le volume et la régularité, l'allure à FC égale, les sorties, les zones, les réglages. Tout est calculé par
// src/lib/running/ (page.ts assemble) ; la page ne fait que mettre en forme.
import Link from "next/link";
import { HowCalc, NB, Note, Section } from "@/components/sante/carnet";
import { AskCoach } from "@/components/sante/course/AskCoach";
import { Cautions, MorningLine } from "@/components/sante/course/Caution";
import { FeedbackForm } from "@/components/sante/course/Feedback";
import { PhaseTrack } from "@/components/sante/course/Phase";
import { RunList } from "@/components/sante/course/RunList";
import { whenText } from "@/components/sante/course/Today";
import { TodayHero } from "@/components/sante/course/Today";
import { EfficiencyChart, FormChart, IntensityBar, Regularity, VolumeChart } from "@/components/sante/course/Trends";
import { WeekStrip } from "@/components/sante/course/Week";
import { ZonesSection } from "@/components/sante/course/Zones";
import { Button, buttonClass, Icon } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { WEEKDAY_LABEL } from "@/lib/running/dates";
import { courseView, type CourseView } from "@/lib/running/page";
import { GOAL_LABEL, type RunGoal } from "@/lib/running/plan";
import { getRunProfile } from "@/lib/running/store";
import { typo } from "@/lib/typo";
import { pauseAction, resumeAction } from "./actions";

export const dynamic = "force-dynamic";

const LINK = "inline-flex min-h-tap items-center gap-1 font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink";

export default async function Course({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const person = await activePerson();
  const { erreur } = await searchParams;
  const profile = getRunProfile(db, person.id);
  const v = profile?.enabled ? courseView(db, person.id) : null;
  if (!v) return <Off name={person.name} known={!!profile} />;
  const ai = aiEnabled();
  const due = v.feedbackDue;
  const questions = [
    v.head ? "Pourquoi cette séance ?" : "Quand est-ce que je reprends ?",
    v.head?.when === "today" ? "Je ne peux pas courir aujourd’hui : on décale ?" : "Je ne peux pas courir à la date prévue : on décale ?",
    v.runs.length ? "Explique-moi ma dernière sortie." : "Comment bien commencer ?",
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      {erreur && <p className="text-ko-ink">{erreur}</p>}
      <Cautions v={v} />
      <TodayHero
        v={v}
        aside={
          <>
            {due && (
              <div id="ressenti" className="grid gap-2">
                <span className="label text-ink-2">{`Ta sortie ${whenText(due.date, v.today)}`}</span>
                <FeedbackForm date={due.date} back="/sante/course" title="Comment ça s’est passé ?" />
              </div>
            )}
            <MorningLine v={v} />
            {ai && <AskCoach questions={questions} />}
          </>
        }
      />
      <WeekStrip v={v} />
      <PhaseTrack v={v} />
      <FormChart v={v} />
      <Section title="Volume et régularité" id="volume">
        <div className="grid gap-x-6 gap-y-12 lg:grid-cols-2">
          <VolumeChart v={v} />
          <Regularity v={v} />
          <EfficiencyChart v={v} />
          <IntensityBar v={v} />
        </div>
      </Section>
      <Section
        title="Sorties"
        id="sorties"
        aside={
          v.runs.length > 6 && (
            <Link href="/sante/course/sorties" className={LINK}>
              {`Toutes (${v.runs.length})`}
              <Icon name="chev" size="s" />
            </Link>
          )
        }
      >
        {v.runs.length ? (
          <RunList runs={v.runs.slice(0, 6)} />
        ) : (
          <p className="max-w-[56ch] text-body text-ink-2">{typo("Pas encore de course reçue. Lance la séance depuis ta montre : à la fin, l’app Mijote Santé l’envoie ici avec sa fréquence cardiaque et ses temps au kilomètre, et le plan s’ajuste.")}</p>
        )}
        {v.runs.length > 0 && !v.hasHr && <Note title="Pas de fréquence cardiaque reçue">Sans elle, la charge vient de la durée et de l’effort que tu notes. Avec une montre, l’app Mijote Santé l’envoie avec chaque course.</Note>}
      </Section>
      <ZonesSection z={v.zones} ageKnown={v.ageKnown} pending={v.observed.maxPending} hasHr={v.hasHr} />
      <Settings v={v} />
    </div>
  );
}

/** Les réglages en une ligne, et la pause. */
function Settings({ v }: { v: CourseView }) {
  const p = v.profile;
  const days = p.days.map((d) => WEEKDAY_LABEL[d.weekday]).join(", ");
  return (
    <Section
      title="Réglages"
      id="reglages"
      aside={
        <Link href="/sante/course/reglages" className={buttonClass({ size: "sm", variant: "secondary" })}>
          <Icon name="sliders" size="s" />
          Changer
        </Link>
      }
    >
      <p className="max-w-[62ch] text-body text-ink-2">
        {`${p.perWeek} sorties par semaine, ${days} ; objectif : ${GOAL_LABEL[p.goal as RunGoal].toLowerCase()}`}
        {p.goalNote ? typo(` (« ${p.goalNote} »)`) : ""}.
      </p>
      <form className="flex flex-wrap items-center gap-4">
        {v.plan.paused ? (
          <Button type="submit" formAction={resumeAction} variant="primary">
            Rouvrir le plan
          </Button>
        ) : (
          <Button type="submit" formAction={pauseAction} variant="quiet">
            Mettre en pause
          </Button>
        )}
        <span className="text-small text-ink-2">{v.plan.paused ? "La reprise recalcule le départ d’après ton arrêt." : "Vacances, maladie : le plan attend, sans rien rattraper."}</span>
      </form>
    </Section>
  );
}

/** Le module n'est pas activé pour cette personne : ce qu'il fait, et l'activer. */
function Off({ name, known }: { name: string; known: boolean }) {
  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
      <section aria-labelledby="off" className="grid content-start gap-6 lg:col-span-7">
        <p className="label text-ink-2">{known ? "Course désactivée" : "Course"}</p>
        <h2 id="off" className="text-h1">
          Reprendre la course, sans se blesser.
        </h2>
        <p className="max-w-[52ch] text-lead text-ink-2">
          {typo(`Un plan prudent pour ${name}, calculé d’après tes courses, ton cœur et ton ressenti : de la marche-course jusqu’à une heure sans t’arrêter, puis plus loin si tu veux. Les séances partent sur la montre par l’app Mijote Santé.`)}
        </p>
        <div>
          <Link href="/sante/course/reglages" className={buttonClass({ variant: "primary" })}>
            {known ? "Réactiver la course" : "Activer la course"}
            <Icon name="chev" />
          </Link>
        </div>
      </section>
      <ul className="grid content-start border-t border-line-strong lg:col-span-5">
        {[
          ["La séance du jour", "Ses blocs et ses cibles de FC en bpm, sur la montre ; pourquoi elle, aujourd’hui."],
          ["Un plan qui s’adapte", "Séance manquée, fatigue, nuit courte, douleur : la suite se recalcule, jamais de rattrapage."],
          ["Ce que dit ton cœur", `Forme, fatigue, allure à FC égale : la progression se lit en semaines${NB}; les chiffres viennent du code.`],
          ["Avec le reste", "La natation et le renforcement comptent ; les jours de sortie longue, un conseil pour manger."],
        ].map(([t, d]) => (
          <li key={t} className="grid gap-1 border-b border-line py-4">
            <b className="text-h3">{t}</b>
            <span className="text-small text-ink-2">{typo(d)}</span>
          </li>
        ))}
      </ul>
      <HowCalc title="Sans montre ?" className="lg:col-span-12">
        <p>Tout marche avec la durée et l’effort que tu notes après chaque sortie. La fréquence cardiaque rend les zones et la charge plus justes.</p>
      </HowCalc>
    </div>
  );
}

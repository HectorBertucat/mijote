import { HowCalc, KeyFigure, NB, NNB } from "@/components/sante/carnet";
import { AdviceCard } from "@/components/sante/AdviceCard";
import { Habits } from "@/components/sante/Habits";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { getPerson } from "@/lib/health/store";
import { listHabits } from "@/lib/eaters/setup";
import { adviceFor, eaterOf } from "@/lib/eaters/store";
import { WEEKDAYS } from "@/lib/eaters/habits";

export const dynamic = "force-dynamic";

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");

/** Habitudes hors batch (?p=<id>) : elles font le hors batch du jour, donc la part de chaque recette. */
export default async function Habitudes({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const active = await activePerson();
  const person = (p ? getPerson(db, p) : null) ?? active;
  const e = eaterOf(db, person);
  const habits = listHabits(db, person.id);

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
      <div className="grid content-start gap-8 lg:col-span-5">
        <div className="grid gap-4">
          <h2 className="text-h2">Hors batch{person.id !== active.id && ` · ${person.name}`}</h2>
          <p className="text-lead text-ink-2">Le batch couvre le midi et le soir. Le shaker, le petit-déjeuner, l’en-cas se notent une fois ici, avec leurs jours.</p>
          <HowCalc>
            <p>Ce que tu prends à côté est retiré de ta cible avant de la partager entre les deux repas du batch : ta part de chaque recette en dépend. Il est aussi proposé d’office dans le journal du jour.</p>
          </HowCalc>
        </div>

        {e.outsideSource === "habitudes" && e.outsideByDay ? (
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-6">
              <KeyFigure size="lg" label="Par jour, en moyenne" value={`~${fr(e.outside!.kcal)}`} unit="kcal" />
              <KeyFigure size="lg" label="Protéines" value={fr(e.outside!.protein)} unit="g" />
            </div>
            <ol className="grid grid-cols-7 border-t border-line" aria-label="Hors batch jour par jour, en kcal">
              {e.outsideByDay.map((o, i) => (
                <li key={i} className="grid justify-items-center gap-1 border-r border-line py-3 last:border-r-0">
                  <span className="label text-ink-3">{WEEKDAYS[i]}</span>
                  <span className="num text-small">{fr(o.kcal)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : e.outsideSource === "chiffre" ? (
          <p className="text-body">
            Hors batch : <b className="num">~{fr(e.outside!.kcal)}{NB}kcal</b> et <b className="num">{fr(e.outside!.protein)}{NB}g</b> de protéines par jour{e.outside!.kcal === 0 ? " (rien)" : ", un chiffre saisi"}. Une habitude le remplace, jour par jour.
          </p>
        ) : (
          <p className="text-body text-ink-2">Rien de noté : ta part compte un petit-déjeuner moyen, un cinquième de ta journée. Choisis ce qui te ressemble, ou «{NNB}Rien hors batch{NNB}».</p>
        )}

        <AdviceCard advice={adviceFor(db, e)} />
      </div>

      <div className="lg:col-span-7 lg:col-start-6 lg:border-l lg:border-line lg:pl-6">
        <Habits
          key={person.id}
          personId={person.id}
          name={person.name}
          habits={habits.map((h) => ({ id: h.id, label: h.label, meal: h.meal, weekdays: h.weekdays, items: h.items, kcal: h.kcal, proteinG: h.proteinG, shared: h.personId == null }))}
        />
      </div>
    </div>
  );
}

import { Card } from "@/components/ui";
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
    <div className="grid max-w-2xl gap-5">
      <div className="grid gap-2">
        <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">Hors batch · {person.name}</h2>
        <p className="text-ink-2">
          Le batch couvre le midi et le soir. Ce que tu prends à côté (shaker, petit-déjeuner, en-cas) se note une fois ici, avec ses jours : il est retiré de ta cible avant de la partager entre les deux repas, et proposé d&apos;office dans le journal du jour.
        </p>
      </div>

      <AdviceCard advice={adviceFor(db, e)} />

      <Card pad="md" className="grid gap-2">
        {e.outsideSource === "habitudes" && e.outsideByDay ? (
          <>
            <p className="text-[15px]">
              Hors batch, en moyenne : <b className="num">~{fr(e.outside!.kcal)} kcal</b> et <b className="num">{fr(e.outside!.protein)} g</b> de protéines par jour.
            </p>
            <ul className="grid grid-cols-7 gap-1 text-center text-[12px]" aria-label="Hors batch jour par jour">
              {e.outsideByDay.map((o, i) => (
                <li key={i} className="grid gap-0.5 rounded-[8px] bg-surface-2 px-1 py-1.5">
                  <b className="text-ink-2">{WEEKDAYS[i]}</b>
                  <span className="num">{fr(o.kcal)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : e.outsideSource === "chiffre" ? (
          <p className="text-[15px]">
            Hors batch : <b className="num">~{fr(e.outside!.kcal)} kcal</b> et <b className="num">{fr(e.outside!.protein)} g</b> de protéines par jour{e.outside!.kcal === 0 ? " (rien)" : ", un chiffre saisi"}. Une habitude le remplace, jour par jour.
          </p>
        ) : (
          <p className="text-[15px] text-ink-2">Rien de noté : ta part compte un petit-déjeuner moyen (un cinquième de ta journée). Choisis ci-dessous ce qui te ressemble, ou « Rien hors batch ».</p>
        )}
      </Card>

      <Habits
        key={person.id}
        personId={person.id}
        name={person.name}
        habits={habits.map((h) => ({ id: h.id, label: h.label, meal: h.meal, weekdays: h.weekdays, items: h.items, kcal: h.kcal, proteinG: h.proteinG, shared: h.personId == null }))}
      />
    </div>
  );
}

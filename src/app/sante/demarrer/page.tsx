import Link from "next/link";
import { verdictTone } from "@/components/ui";
import { de, HowCalc, KeyFigure, NB, NNB, Note, Row, Section, Verdict } from "@/components/sante/carnet";
import { SetupForm } from "@/components/sante/SetupForm";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { getPerson, listWeighIns } from "@/lib/health/store";
import { adviceFor, eaterOf } from "@/lib/eaters/store";
import { listDislikes, listHabits } from "@/lib/eaters/setup";
import { counts, daysLabel } from "@/lib/eaters/habits";
import { AdviceCard } from "@/components/sante/AdviceCard";
import { portionOf, unitsLabel } from "@/lib/eaters/core";
import { listRecipes } from "@/lib/recipes/queries";
import { joinFr } from "@/lib/week/tastes";
import { planOf } from "@/lib/health/objectives";

export const dynamic = "force-dynamic";

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const SOURCE = { sante: "dépense mesurée par la balance", fixe: "repère fixe du profil", estimation: "estimation par formule, affinée par tes pesées" } as const;
const WORD = { ok: "dans ta cible", low: "un peu juste", high: "au-dessus" } as const;

/** Mise en route d’un mangeur (?p=<id>) : ce qui manque, le formulaire, et ce qui en découle. */
export default async function Demarrer({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p } = await searchParams;
  const active = await activePerson();
  const person = (p ? getPerson(db, p) : null) ?? active;
  const e = eaterOf(db, person);
  const habits = listHabits(db, person.id);
  const lastKg = listWeighIns(db, person.id).at(-1)?.kg ?? null;
  const examples = listRecipes(db)
    .filter((r) => r.status !== "archived" && r.kcalUnit != null && !r.parentId)
    .sort((a, b) => Number(b.status === "liked") - Number(a.status === "liked") || a.name.localeCompare(b.name, "fr"))
    .slice(0, 8)
    .map((r) => ({ r, part: portionOf(e, r) }));

  return (
    <div className="grid gap-12 lg:gap-18">
      <div className="grid max-w-[62ch] gap-4">
        <h2 className="text-h2">Mise en route{person.id !== active.id && ` · ${person.name}`}</h2>
        {person.id !== active.id && <p className="text-small text-ink-2">Tu remplis le profil {de(person.name)} (le profil choisi en haut reste {active.name}).</p>}
        <p className="text-lead text-ink-2">Quelques chiffres, ton objectif, ce que tu manges à côté : ta part de chaque recette suivra ta cible.</p>
        <HowCalc>
          <p>Chaque recette est cuite en unités : le plat cuit, pesé, divisé en parts égales. Ta part se calcule sur ta cible : ce que tu manges au midi et au soir, en kcal, divisé par les kcal d’une unité de ce plat. Les protéines disent si le plat te convient.</p>
        </HowCalc>
      </div>

      {e.missing.length > 0 ? (
        <Note tone="warn" title={e.ref ? "Ta part est déjà calculée, mais elle peut être plus juste" : "Ta part reste à la taille habituelle"}>
          Il manque {joinFr(e.missing)}.
        </Note>
      ) : (
        e.setupDone && (
          <Note title="Tout est réglé">
            Ta part suit ta cible, et la Semaine la reprend toute seule. Pèse-toi une fois par semaine au moins, et coche «{NNB}Journée complète{NNB}» dans{" "}
            <Link href="/sante/aujourdhui" className="font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Aujourd’hui
            </Link>{" "}
            : la cible s’ajuste à ta vraie dépense.
          </Note>
        )
      )}

      <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-6">
        {e.ref && (
          <Section title="Ta part, aujourd’hui" id="ta-part" className="scroll-mt-20 lg:order-2 lg:col-span-5 lg:col-start-8">
            <div className="grid grid-cols-2 gap-6">
              {e.dayTarget && <KeyFigure size="lg" label="Cible du jour" value={fr(e.dayTarget.kcal)} unit="kcal" sub={`${fr(e.dayTarget.proteinG)}${NB}g de protéines`} />}
              <KeyFigure size="lg" label="Un repas du batch" value={`${fr(e.ref.kcalMin)}–${fr(e.ref.kcalMax)}`} unit="kcal" sub={`${e.ref.proteinMin}–${e.ref.proteinMax}${NB}g de protéines`} />
            </div>
            <dl className="grid border-t border-line">
              {e.source && <Row k="D’où vient la cible">{SOURCE[e.source]}</Row>}
              <Row k="Hors batch">
                {e.outside ? (
                  <>
                    <span className="num">{`~${fr(e.outside.kcal)}${NB}kcal, ${fr(e.outside.protein)}${NB}g`}</span>
                    {e.outsideSource === "habitudes" && <span className="block text-small text-ink-2">tes habitudes, en moyenne sur la semaine</span>}
                  </>
                ) : (
                  <span className="text-ink-2">un petit-déjeuner moyen, tant que tu n’as rien noté</span>
                )}
              </Row>
            </dl>
            <AdviceCard advice={adviceFor(db, e)} link />
            {examples.length > 0 && (
              <div className="grid gap-2">
                <span className="label text-ink-2">Ta part de quelques recettes</span>
                <ul className="grid border-t border-line">
                  {examples.map(({ r, part }) => (
                    <li key={r.id} className="grid gap-1 border-b border-line py-3">
                      <span className="flex items-baseline justify-between gap-4">
                        <Link href={`/recettes/${r.slug}`} className="-my-2.5 min-w-0 py-2.5 font-bold hover:underline hover:underline-offset-4">
                          {r.name}
                        </Link>
                        <b className="num whitespace-nowrap">{unitsLabel(part.units)}</b>
                      </span>
                      <span className="flex flex-wrap items-baseline justify-between gap-x-4 text-small text-ink-2">
                        <span className="num">{`${part.kcal}${NB}kcal · ${part.protein}${NB}g`}</span>
                        {part.verdict && <Verdict tone={verdictTone(part.verdict.protein === "low" ? "low" : part.verdict.kcal)}>{part.verdict.protein === "low" ? "peu de protéines" : WORD[part.verdict.kcal]}</Verdict>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        <div className="lg:order-1 lg:col-span-7">
          <SetupForm
          key={person.id}
          personId={person.id}
          name={person.name}
          lastKg={lastKg}
          outside={e.outside}
          habits={e.outsideSource === "habitudes" ? habits.filter(counts).map((h) => `${h.label}, ${daysLabel(h.weekdays)}`) : null}
          dislikes={listDislikes(db, person.id).map((d) => ({ id: d.id, text: d.text }))}
          values={{ sex: person.sex, birthDate: person.birthDate, heightCm: person.heightCm, activity: person.activity, goal: person.goal, ratePct: person.ratePct, proteinGPerKg: person.proteinGPerKg, proteinG: person.proteinG, targetWeightKg: person.targetWeightKg, targetDate: person.targetDate, sportPlan: planOf(person), constraints: person.constraints }}
      />
        </div>
      </div>
    </div>
  );
}

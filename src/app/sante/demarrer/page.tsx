import Link from "next/link";
import { Alert, Card, Pill, verdictTone } from "@/components/ui";
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

/** Mise en route d'un mangeur (?p=<id>) : ce qui manque, le formulaire, et ce qui en découle. */
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
    <div className="grid gap-5">
      <div className="grid max-w-2xl gap-2">
        <h2 className="text-[22px] font-extrabold tracking-[-0.02em]">Mise en route · {person.name}</h2>
        {person.id !== active.id && <p className="text-[14px] text-ink-2">Tu remplis le profil de {person.name} (le profil choisi en haut reste {active.name}).</p>}
        <p className="text-ink-2">
          Chaque recette est cuite en unités (le plat cuit, pesé, divisé en parts égales). Ta part de chaque recette se calcule sur ta cible : ce que tu manges au midi et au soir, en kcal, divisé par les kcal d&apos;une unité de ce plat. Les protéines disent si le plat te convient.
        </p>
      </div>

      {e.missing.length > 0 ? (
        <Alert tone="warn" title={e.ref ? "Ta part est déjà calculée, mais elle peut être plus juste" : "Ta part reste à la taille habituelle"}>
          Il manque {joinFr(e.missing)}.
        </Alert>
      ) : (
        e.setupDone && (
          <Alert tone="ok" title="Tout est réglé">
            Ta part suit ta cible, et la Semaine la reprend toute seule. Pèse-toi une fois par semaine au moins, et coche « Journée complète » dans <Link href="/sante/aujourdhui" className="font-semibold underline">Aujourd&apos;hui</Link> : la cible s&apos;ajuste à ta vraie dépense.
          </Alert>
        )
      )}

      {e.ref && (
        <Card as="section" pad="md" className="grid max-w-2xl scroll-mt-20 gap-3" id="ta-part">
          <h3 className="text-[18px] font-bold">Ta part, aujourd&apos;hui</h3>
          <div className="grid gap-1 text-[15px]">
            {e.dayTarget && (
              <p>
                Cible du jour : <b className="num">{fr(e.dayTarget.kcal)} kcal</b> et <b className="num">{fr(e.dayTarget.proteinG)} g</b> de protéines{" "}
                <span className="text-ink-2">({SOURCE[e.source!]})</span>.
              </p>
            )}
            {e.outside ? (
              <p>
                Hors batch : <span className="num">~{fr(e.outside.kcal)} kcal</span>, <span className="num">{fr(e.outside.protein)} g</span> de protéines
                {e.outsideSource === "habitudes" ? " (tes habitudes, en moyenne sur la semaine)" : ""}.
              </p>
            ) : (
              <p className="text-ink-2">Hors batch : un petit-déjeuner moyen, tant que tu n&apos;as rien noté.</p>
            )}
            <p>
              Un repas du batch :{" "}
              <b className="num">
                {fr(e.ref.kcalMin)}-{fr(e.ref.kcalMax)} kcal
              </b>{" "}
              et{" "}
              <b className="num">
                {e.ref.proteinMin}-{e.ref.proteinMax} g
              </b>{" "}
              de protéines{e.source === "fixe" && <span className="text-ink-2"> ({SOURCE.fixe})</span>}.
            </p>
          </div>
          <AdviceCard advice={adviceFor(db, e)} link />
          {examples.length > 0 && (
            <div className="grid gap-1.5">
              <b className="text-[14px] text-ink-2">Ta part de quelques recettes</b>
              <ul className="grid gap-1">
                {examples.map(({ r, part }) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-dashed border-line py-1.5 text-[14px] last:border-b-0">
                    <Link href={`/recettes/${r.slug}`} className="min-w-0 font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <span className="flex items-baseline gap-2 tabular-nums">
                      <b>{unitsLabel(part.units)}</b>
                      <span>
                        {part.kcal} kcal · {part.protein} g
                      </span>
                      {part.verdict && (
                        <Pill tone={verdictTone(part.verdict.protein === "low" ? "low" : part.verdict.kcal)}>
                          {part.verdict.protein === "low" ? "peu de protéines" : WORD[part.verdict.kcal]}
                        </Pill>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

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
  );
}

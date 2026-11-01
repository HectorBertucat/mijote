"use client";

// Mise en route, une question par écran : qui mange (le foyer), la cuisine (sept questions et un résumé), où se font
// les courses. Les réponses s’enregistrent au fil de l’eau (mêmes actions que Réglages) ; le dernier écran ouvre l’appli.
import { useState } from "react";
import { Button } from "@/components/ui";
import { HomeForm } from "@/components/reglages/HomeForm";
import { Household, type PersonRow } from "@/components/reglages/Household";
import { KitchenForm } from "@/components/reglages/KitchenForm";
import { QuestionHead } from "@/components/reglages/parts";
import type { KitchenConfig } from "@/lib/kitchen/presets";

const PARTS = ["Le foyer", "La cuisine", "Les courses"] as const;
const NB = " ";

/** Les trois temps de la mise en route, en tête : fait (encre), en cours (cocotte), à venir (filet). */
function Parts({ at }: { at: number }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Mise en route">
      {PARTS.map((p, i) => (
        <li key={p} aria-current={i === at ? "step" : undefined} className="grid gap-2">
          <span className={`h-0.5 transition-colors duration-[var(--dur-2)] ease-[var(--ease-out)] ${i < at ? "bg-ink" : i === at ? "bg-accent" : "bg-line"}`} />
          <span className={`label num ${i === at ? "text-ink" : i < at ? "text-ink-2" : "text-faint"}`}>
            {i + 1}. {p}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Onboarding({ people, kitchen, home, store, catalog, ai }: { people: PersonRow[]; kitchen: KitchenConfig; home: string; store: string; catalog: boolean; ai: boolean }) {
  const [at, setStep] = useState(0);
  const setAt = (i: number) => {
    setStep(i);
    window.scrollTo({ top: 0 });
  };
  const ready = people.length > 0;
  const n = people.length;
  return (
    <div className="grid gap-12">
      <div className="grid gap-4">
        <p className="label text-faint">Bienvenue dans Mijote</p>
        <Parts at={at} />
      </div>

      {at === 0 && (
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-6">
          <div className="grid min-w-0 content-start gap-8 lg:col-span-7">
            <div className="reveal">
              <QuestionHead
                as="h1"
                title={`Qui mange ici${NB}?`}
                hint={ready ? `${n} personne${n > 1 ? "s" : ""} au foyer. Quelqu’un d’autre, ou on passe à la cuisine.` : "Un prénom et une taille de part suffisent. Six recettes t’attendent déjà pour essayer."}
              />
            </div>
            <Household people={people} />
            <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
              <Button variant="primary" disabled={!ready} onClick={() => setAt(1)}>
                Passer à la cuisine
              </Button>
              {!ready && <span className="text-small text-ink-2">Au moins une personne pour continuer.</span>}
            </div>
          </div>
          <aside className="hidden content-start gap-3 border-t border-line-strong pt-4 lg:col-span-4 lg:col-start-9 lg:mt-12 lg:grid">
            <p className="label text-faint">Trois questions, deux minutes</p>
            <p className="text-body text-ink-2">Qui mange, avec quoi tu cuisines, où tu fais les courses. Tout se change ensuite dans Réglages.</p>
            <p className="text-body text-ink-2">La part de chacun se calcule sur sa cible, qu’on règle juste après dans Santé.</p>
          </aside>
        </div>
      )}

      {at === 1 && <KitchenForm initial={kitchen} guided kicker="La cuisine" onExit={() => setAt(0)} onSaved={() => setAt(2)} />}

      {at === 2 && (
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-x-6">
          <div className="grid min-w-0 content-start gap-8 lg:col-span-7">
            <div className="reveal">
              <QuestionHead as="h1" title={`Où fais-tu les courses${NB}?`} hint={`Un marché, un supermarché, un drive${NB}: la liste se range par rayon${ai ? ", et l’IA propose des produits qu’on y trouve" : ""}.`} />
            </div>
            <HomeForm home={home} store={store} catalog={catalog} ai={ai} finish>
              <Button variant="quiet" onClick={() => setAt(1)}>
                Revoir la cuisine
              </Button>
            </HomeForm>
          </div>
          <aside className="hidden content-start gap-3 border-t border-line-strong pt-4 lg:col-span-4 lg:col-start-9 lg:mt-12 lg:grid">
            <p className="label text-faint">Ensuite</p>
            <p className="text-body text-ink-2">Le profil de chacun dans Santé (cible, goûts), puis ta première semaine : trois plats, les courses, et une session de cuisine le dimanche.</p>
          </aside>
        </div>
      )}
    </div>
  );
}

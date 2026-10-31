// Réglages de l’instance : un document à sections séparées par des filets (le foyer, la cuisine, les courses, la prise en main).
// La mise en route (/bienvenue) pose les mêmes questions une par une (src/app/bienvenue/Onboarding.tsx).
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import { HomeForm } from "@/components/reglages/HomeForm";
import { Household } from "@/components/reglages/Household";
import { KitchenForm } from "@/components/reglages/KitchenForm";
import { DocSection } from "@/components/reglages/parts";
import { catalogEnabled } from "@/lib/chronocatalog";
import { db } from "@/lib/db/client";
import { listPeople } from "@/lib/health/store";
import { loadKitchen } from "@/lib/kitchen/store";
import { getSetting, SETTING } from "@/lib/settings";
import { tourView } from "@/lib/tour/store";
import { firstStepsAction } from "./actions";

export function Settings({ profileId }: { profileId: string }) {
  const tour = tourView(db, profileId);
  const people = listPeople(db).map((p) => ({ id: p.id, name: p.name, portionUnits: p.portionUnits }));
  return (
    <div className="grid gap-12 sm:gap-18">
      <DocSection id="foyer" title="Le foyer" lead="Chacun a sa part de chaque recette : sa cible dans Santé, sinon la taille de part choisie ici.">
        <Household people={people} />
      </DocSection>
      <DocSection id="cuisine" title="La cuisine" lead="Le planificateur répartit les étapes sur ces foyers, ce four et ces récipients, et sur rien d’autre.">
        <KitchenForm initial={loadKitchen(db)} />
      </DocSection>
      <DocSection id="courses" title="Les courses" lead="Le magasin aide l’IA à proposer des produits qui existent ; le nom de la maison s’affiche dans l’en-tête.">
        <HomeForm home={getSetting(db, SETTING.homeName) ?? ""} store={getSetting(db, SETTING.storeLabel) ?? ""} catalog={catalogEnabled()} />
      </DocSection>
      <DocSection id="prise-en-main" title="La prise en main" lead="La visite montre le cycle de la semaine en quelques étapes : choisir, acheter, cuisiner, ranger.">
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/?visite=1" className={buttonClass({ variant: "secondary" })}>
            Revoir la visite
          </Link>
          {tour.hidden && !tour.steps.complete && (
            <form action={firstStepsAction}>
              <input type="hidden" name="hidden" value="0" />
              <button type="submit" className={buttonClass({ variant: "quiet" })}>
                Remettre les premiers pas sur l’accueil
              </button>
            </form>
          )}
        </div>
      </DocSection>
    </div>
  );
}

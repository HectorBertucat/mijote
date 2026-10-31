// Réglages de l'instance : un document à sections séparées par des filets (le foyer, la cuisine, les courses).
// La mise en route (/bienvenue) pose les mêmes questions une par une (src/app/bienvenue/Onboarding.tsx).
import { HomeForm } from "@/components/reglages/HomeForm";
import { Household } from "@/components/reglages/Household";
import { KitchenForm } from "@/components/reglages/KitchenForm";
import { DocSection } from "@/components/reglages/parts";
import { catalogEnabled } from "@/lib/chronocatalog";
import { db } from "@/lib/db/client";
import { listPeople } from "@/lib/health/store";
import { loadKitchen } from "@/lib/kitchen/store";
import { getSetting, SETTING } from "@/lib/settings";

export function Settings() {
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
    </div>
  );
}

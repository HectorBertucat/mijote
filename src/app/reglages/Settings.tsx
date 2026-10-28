// Réglages de l'instance, partagés par la mise en route (/bienvenue) et la page Réglages.
import { HomeForm } from "@/components/reglages/HomeForm";
import { Household } from "@/components/reglages/Household";
import { KitchenForm } from "@/components/reglages/KitchenForm";
import { catalogEnabled } from "@/lib/chronocatalog";
import { db } from "@/lib/db/client";
import { listPeople } from "@/lib/health/store";
import { loadKitchen } from "@/lib/kitchen/store";
import { getSetting, SETTING } from "@/lib/settings";

export function Settings({ first = false }: { first?: boolean }) {
  const people = listPeople(db).map((p) => ({ id: p.id, name: p.name, portionUnits: p.portionUnits }));
  return (
    <div className="grid gap-6">
      <section className="grid gap-2.5" aria-labelledby="foyer">
        <h2 id="foyer" className="text-[20px] font-extrabold">
          {first ? "1. " : ""}Le foyer
        </h2>
        <p className="text-[14px] text-ink-2">Chaque personne a sa part de chaque recette, calculée sur sa cible (Santé) ; sans profil, sa taille de part.</p>
        <Household people={people} />
      </section>
      <section className="grid gap-2.5" aria-labelledby="cuisine">
        <h2 id="cuisine" className="text-[20px] font-extrabold">
          {first ? "2. " : ""}La cuisine
        </h2>
        <p className="text-[14px] text-ink-2">Le planificateur de session répartit les étapes sur ces foyers, ce four et ces récipients.</p>
        <KitchenForm initial={loadKitchen(db)} />
      </section>
      <section className="grid gap-2.5" aria-labelledby="courses">
        <h2 id="courses" className="text-[20px] font-extrabold">
          {first ? "3. " : ""}La maison et les courses
        </h2>
        <HomeForm home={getSetting(db, SETTING.homeName) ?? ""} store={getSetting(db, SETTING.storeLabel) ?? ""} catalog={catalogEnabled()} />
      </section>
    </div>
  );
}

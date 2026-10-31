import { redirect } from "next/navigation";
import { catalogEnabled } from "@/lib/chronocatalog";
import { db } from "@/lib/db/client";
import { listPeople } from "@/lib/health/store";
import { loadKitchen } from "@/lib/kitchen/store";
import { getSetting, isSetupDone, SETTING } from "@/lib/settings";
import { Onboarding } from "./Onboarding";

export const dynamic = "force-dynamic";

/** Mise en route d’une instance neuve : le foyer, la cuisine, les courses. Ensuite, Santé › Démarrer pour chacun. */
export default function Bienvenue() {
  if (isSetupDone(db)) redirect("/");
  const people = listPeople(db).map((p) => ({ id: p.id, name: p.name, portionUnits: p.portionUnits }));
  return <Onboarding people={people} kitchen={loadKitchen(db)} home={getSetting(db, SETTING.homeName) ?? ""} store={getSetting(db, SETTING.storeLabel) ?? ""} catalog={catalogEnabled()} />;
}

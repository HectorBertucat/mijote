import { redirect } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { FoodIllu } from "@/components/illus/Illu";
import { finishSetupAction } from "@/app/reglages/actions";
import { Settings } from "@/app/reglages/Settings";
import { db } from "@/lib/db/client";
import { listPeople } from "@/lib/health/store";
import { isSetupDone } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Mise en route d'une instance neuve : le foyer, la cuisine, les courses. Ensuite, Santé › Démarrer pour chacun. */
export default function Bienvenue() {
  if (isSetupDone(db)) redirect("/");
  const ready = listPeople(db).length > 0;
  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-4">
        <FoodIllu id="tomate" size={56} label="" />
        <div>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Bienvenue dans Mijote</h1>
          <p className="mt-1.5 max-w-[60ch] text-ink-2">
            Trois réglages, deux minutes : qui mange, avec quoi on cuisine, où se font les courses. Tout se change ensuite dans Réglages. Six recettes sont déjà là pour essayer.
          </p>
        </div>
      </div>
      <Settings first />
      <Card pad="md" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] text-ink-2">{ready ? "Ensuite : le profil de chacun (cible, goûts) dans Santé, puis ta première semaine." : "Ajoute au moins une personne pour continuer."}</p>
        <form action={finishSetupAction}>
          <Button type="submit" variant="primary" icon="check" disabled={!ready}>
            C&apos;est parti
          </Button>
        </form>
      </Card>
    </div>
  );
}

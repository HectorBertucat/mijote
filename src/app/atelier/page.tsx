import { AtelierApp } from "@/components/atelier/AtelierApp";
import { aiEnabled, monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { db } from "@/lib/db/client";
import { listRecipes } from "@/lib/recipes/queries";
import { demoEnabled } from "@/lib/demo/core";
import { DemoNotice } from "@/components/demo/DemoNotice";

export const dynamic = "force-dynamic";

export default async function Atelier({ searchParams }: { searchParams: Promise<{ envie?: string }> }) {
  const { envie } = await searchParams;
  if (demoEnabled())
    return (
      <DemoNotice title="L’Atelier a besoin de l’IA">
        Chez toi, il ajuste une recette ou en crée une à partir d’une envie, au besoin d’après de vraies recettes publiées (sources citées), puis le code vérifie tout : ingrédients connus, macros recalculées, ton équipement. Pas d’IA dans la démo.
      </DemoNotice>
    );
  const count = listRecipes(db).length;
  return <AtelierApp initialEnvie={envie?.slice(0, 600) ?? ""} count={count} creer={aiEnabled()} budget={{ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }} />;
}

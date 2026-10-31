import { AtelierApp } from "@/components/atelier/AtelierApp";
import { monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { db } from "@/lib/db/client";
import { listRecipes } from "@/lib/recipes/queries";

export const dynamic = "force-dynamic";

export default async function Atelier({ searchParams }: { searchParams: Promise<{ envie?: string }> }) {
  const { envie } = await searchParams;
  const count = listRecipes(db).length;
  return <AtelierApp initialEnvie={envie?.slice(0, 600) ?? ""} count={count} budget={{ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }} />;
}

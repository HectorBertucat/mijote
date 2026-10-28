import Link from "next/link";
import { AtelierApp } from "@/components/atelier/AtelierApp";
import { Icon } from "@/components/ui";
import { monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { db } from "@/lib/db/client";
import { listRecipes } from "@/lib/recipes/queries";

export const dynamic = "force-dynamic";

export default async function Atelier({ searchParams }: { searchParams: Promise<{ envie?: string }> }) {
  const { envie } = await searchParams;
  const count = listRecipes(db).length;
  return (
    <div className="grid gap-3.5">
      <Link href="/recettes" className="inline-flex w-fit items-center gap-1 text-[14px] font-semibold text-ink-2 hover:text-ink">
        <Icon name="chev" size="s" className="rotate-180" />
        Recettes
      </Link>
      <AtelierApp initialEnvie={envie?.slice(0, 600) ?? ""} count={count} budget={{ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }} />
    </div>
  );
}

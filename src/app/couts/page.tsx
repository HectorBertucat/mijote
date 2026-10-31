import Link from "next/link";
import { CostTable } from "@/components/cart/CostTable";
import { buttonClass, EmptyState, Icon } from "@/components/ui";
import { BackLink, Figure, Figures, PageHead, SectionHead } from "@/components/cart/Carnet";
import { db } from "@/lib/db/client";
import { DishBox } from "@/components/ui/dish";
import { listDishRecipes } from "@/lib/recipes/queries";
import { allRecipeCosts, pantryTotals, spendingTotals } from "@/lib/costs";

export const dynamic = "force-dynamic";

const num = (v: number) => v.toFixed(2).replace(".", ",");

export default function Couts() {
  const costs = allRecipeCosts(db);
  const spent = spendingTotals(db);
  const pantry = pantryTotals(db);
  const known = costs.filter((c) => c.kind !== "none");
  const unknown = costs.filter((c) => c.kind === "none");
  const waste = known.reduce((s, c) => s + (c.waste ?? 0), 0);
  const slugs = new Set(known.map((c) => c.slug));
  const dishes = Object.fromEntries([...listDishRecipes(db).values()].filter((d) => slugs.has(d.slug)).map((d) => [d.slug, <DishBox key={d.slug} recipe={d} size="sm" />]));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <PageHead back={<BackLink href="/courses">Courses</BackLink>} title="Coûts" lead="Ce que coûte une part de chaque plat, et ce qui part à la poubelle.">
        <Figures className="mt-6">
          <Figure value={num(spent.spent)} unit="€" label={`dépensés, ${spent.purchases} achats`} />
          <Figure href="/placard" value={num(pantry.okValue)} unit="€" label="au placard" />
          <Figure value={num(pantry.lostValue)} unit="€" label="perdus au placard" />
          {known.length > 0 && <Figure value={num(waste)} unit="€" label="gaspillés, toutes fournées" />}
        </Figures>
      </PageHead>

      {known.length === 0 ? (
        <EmptyState
          icon="basket"
          title="Pas encore de coût"
          action={
            <Link href="/composer" className={buttonClass({ size: "sm" })}>
              Ouvrir le Composer
            </Link>
          }
        >
          Fais une liste de courses depuis le Composer, valide-la, puis « J’ai cuisiné » sur la fiche.
        </EmptyState>
      ) : (
        <section className="grid gap-6" aria-labelledby="part-titre">
          <SectionHead id="part-titre" title="Coût par part" count={known.length} />
          <CostTable costs={known} dishes={dishes} />
          <details className="group max-w-[70ch]">
            <summary className="label flex min-h-tap cursor-pointer list-none items-center gap-2 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-open:rotate-90" />
              Comment c’est calculé
            </summary>
            <p className="mt-2 text-small text-ink-2">
              Par part de base de chaque personne du foyer. Consommé : ce qui est réellement mangé. Payé : les paquets entiers, moins les restes qui servent ailleurs. Jeté : payé moins consommé, sur toute la fournée.
            </p>
          </details>
        </section>
      )}
      {unknown.length > 0 && <p className="text-small text-ink-2">Sans liste de courses, donc sans coût : {unknown.map((c) => c.name).join(", ")}.</p>}
    </div>
  );
}

import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LotList } from "@/components/cart/LotList";
import { CostTable } from "@/components/cart/CostTable";
import { buttonClass, EmptyState, Icon } from "@/components/ui";
import { BackLink, Figure, Figures, PageHead, SectionHead } from "@/components/cart/Carnet";
import { db } from "@/lib/db/client";
import { DishBox } from "@/components/ui/dish";
import { listDishRecipes } from "@/lib/recipes/queries";
import { allRecipeCosts, listLots, pantryTotals } from "@/lib/costs";
import { plural } from "@/components/semaine/format";
import { catalogEnabled } from "@/lib/chronocatalog";

export const dynamic = "force-dynamic";

const num = (v: number) => v.toFixed(2).replace(".", ",");

export default function Placard() {
  const lots = listLots(db, "ok");
  const closed = listLots(db, "closed");
  const t = pantryTotals(db);
  // Sans catalogue, un coût sans aucun prix connu vaut 0 € partout : on ne l’affiche pas.
  const costs = allRecipeCosts(db).filter((c) => c.kind !== "none" && (catalogEnabled() || c.coverage > 0));
  const parts = costs.map((c) => c.partLead?.practical).filter((v): v is number => v != null);
  const avg = parts.length ? parts.reduce((s, v) => s + v, 0) / parts.length : null;
  const toLot = (l: (typeof lots)[number]) => ({
    id: l.lot.id,
    item: l.lot.item,
    name: l.name,
    gramsLeft: l.lot.gramsLeft,
    gramsInitial: l.lot.gramsInitial,
    valueLeft: l.lot.valueLeft,
    status: l.lot.status,
    boughtAt: l.boughtAt,
    closedAt: l.lot.closedAt,
  });
  const slugs = new Set(costs.map((c) => c.slug));
  const dishes = Object.fromEntries([...listDishRecipes(db).values()].filter((d) => slugs.has(d.slug)).map((d) => [d.slug, <DishBox key={d.slug} recipe={d} size="sm" />]));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <AutoRefresh />
      <PageHead back={<BackLink href="/courses">Courses</BackLink>} title="Placard" lead="Ce qui reste des paquets achetés. Un reste a servi ailleurs ou part à la poubelle : un tap.">
        {/* Sans prix (pas de catalogue) ni reste : pas de rangée de « 0,00 € ». */}
        {(t.okValue > 0 || t.lostValue > 0 || (t.okCount ?? 0) > 0 || avg != null) && <Figures className="mt-6">
          <Figure value={num(t.okValue)} unit="€" label={`au placard, ${plural(t.okCount ?? 0, "reste")}`} />
          <Figure value={num(t.lostValue)} unit="€" label="jeté, compté aux recettes" />
          {avg != null && <Figure value={num(avg)} unit="€" label="la part, en moyenne" />}
        </Figures>}
      </PageHead>
      <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-x-6">
        <section className="grid gap-6 lg:col-span-7" aria-labelledby="restes-titre">
          <SectionHead id="restes-titre" title="Restes" count={lots.length || undefined} />
          {lots.length === 0 ? (
            <EmptyState
              scene="fridge"
              title="Placard vide"
              action={
                <Link href="/courses" className={buttonClass({ size: "sm" })}>
                  Listes de courses
                </Link>
              }
            >
              Valide une commande depuis une liste de courses : chaque article y devient un reste.
            </EmptyState>
          ) : (
            <div className="-mt-6">
              <LotList lots={lots.map(toLot)} />
            </div>
          )}
          {closed.length > 0 && (
            <details className="group">
              <summary className="label flex min-h-tap cursor-pointer list-none items-center gap-2 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-open:rotate-90" />
                Terminés récemment · <span className="num">{closed.length}</span>
              </summary>
              <div className="mt-2 border-t border-line">
                <LotList lots={closed.map(toLot)} closed />
              </div>
            </details>
          )}
        </section>
        <section className="grid gap-6 lg:col-span-5" aria-labelledby="part-titre">
          <SectionHead
            id="part-titre"
            title="Coût par part"
            action={
              <Link href="/couts" className="-my-3 inline-flex min-h-tap items-center gap-1 text-small font-semibold text-accent underline-offset-4 hover:underline">
                Tous les coûts <Icon name="chev" size="s" />
              </Link>
            }
          />
          {costs.length ? <CostTable costs={costs} compact dishes={dishes} /> : <p className="text-small text-ink-2">{catalogEnabled() ? "Pas encore de coût : il faut une liste de courses avec la recette." : "Pas encore de prix : note le prix payé à côté d’un article de la liste de courses."}</p>}
        </section>
      </div>
    </div>
  );
}

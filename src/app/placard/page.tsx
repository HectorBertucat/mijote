import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LotList } from "@/components/cart/LotList";
import { CostTable } from "@/components/cart/CostTable";
import { buttonClass, Card, EmptyState, Icon, Macro, MacroRow } from "@/components/ui";
import { db } from "@/lib/db/client";
import { allRecipeCosts, listLots, pantryTotals } from "@/lib/costs";

export const dynamic = "force-dynamic";

const num = (v: number) => v.toFixed(2).replace(".", ",");

export default function Placard() {
  const lots = listLots(db, "ok");
  const closed = listLots(db, "closed");
  const t = pantryTotals(db);
  const costs = allRecipeCosts(db).filter((c) => c.kind !== "none");
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
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <AutoRefresh />
      <div>
        <Link href="/courses" className="inline-flex min-h-tap items-center gap-1 text-[14px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Courses
        </Link>
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Placard</h1>
        <p className="mt-1.5 text-ink-2">Ce qui reste des commandes validées. Un tap quand un reste a servi ailleurs ou part à la poubelle.</p>
      </div>
      <MacroRow>
        <Macro value={num(t.okValue)} unit="€" sub={`dans le placard · ${t.okCount ?? 0} lots`} />
        <Macro value={num(t.lostValue)} unit="€" sub="jeté, compté aux recettes" tone={t.lostValue > 0 ? "ko" : undefined} icon={null} />
        {avg != null && <Macro value={num(avg)} unit="€" sub="par part, en moyenne" />}
      </MacroRow>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="grid gap-2.5" aria-labelledby="restes-titre">
          <h2 id="restes-titre" className="text-[18px] font-bold">
            Restes
          </h2>
          {lots.length === 0 ? (
            <Card flat>
              <EmptyState
                scene="fridge"
                title="Placard vide"
                action={
                  <Link href="/courses" className={buttonClass({ size: "sm" })}>
                    Listes de courses
                  </Link>
                }
              >
                Valide une commande depuis une liste de courses : chaque article y devient un lot.
              </EmptyState>
            </Card>
          ) : (
            <LotList lots={lots.map(toLot)} />
          )}
          {closed.length > 0 && (
            <details className="group rounded-[14px] border border-line bg-surface">
              <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 px-3.5 text-[14px] font-semibold">
                Terminés récemment <span className="num text-faint">{closed.length}</span>
                <Icon name="chev" size="s" className="ml-auto text-faint transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t border-line">
                <LotList lots={closed.map(toLot)} closed />
              </div>
            </details>
          )}
        </section>
        <section className="grid gap-2.5" aria-labelledby="part-titre">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="part-titre" className="text-[18px] font-bold">
              Coût par part
            </h2>
            <Link href="/couts" className="inline-flex min-h-tap items-center gap-1 text-[14px] font-semibold text-accent hover:underline">
              Tous les coûts <Icon name="chev" size="s" />
            </Link>
          </div>
          {costs.length ? <CostTable costs={costs} /> : <p className="text-[14px] text-ink-2">Pas encore de coût : il faut une liste de courses avec la recette.</p>}
        </section>
      </div>
    </div>
  );
}

import Link from "next/link";
import { CostTable } from "@/components/cart/CostTable";
import { buttonClass, Card, EmptyState, Icon, Macro, MacroRow } from "@/components/ui";
import { db } from "@/lib/db/client";
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
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <Link href="/courses" className="inline-flex min-h-tap items-center gap-1 text-[14px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Courses
        </Link>
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Coûts</h1>
        <p className="mt-1.5 max-w-[70ch] text-ink-2">
          Par part de base de chaque personne du foyer. Consommé : ce qui est réellement mangé. Payé : les paquets entiers, moins les restes qui servent ailleurs.
        </p>
      </div>

      <MacroRow>
        <Macro value={num(spent.spent)} unit="€" sub={`dépensé · ${spent.purchases} achats`} />
        <Macro value={num(pantry.okValue)} unit="€" sub="au placard" />
        <Macro value={num(pantry.lostValue)} unit="€" sub="perdu au placard" tone={pantry.lostValue > 0 ? "ko" : undefined} icon={null} />
        {known.length > 0 && <Macro value={num(waste)} unit="€" sub="gaspillé par fournée, en tout" tone={waste > 0.005 ? "warn" : "ok"} icon={null} />}
      </MacroRow>

      {known.length === 0 ? (
        <Card flat>
          <EmptyState
            icon="basket"
            title="Pas encore de coût"
            action={
              <Link href="/composer" className={buttonClass({ size: "sm" })}>
                Ouvrir le Composer
              </Link>
            }
          >
            Fais une liste de courses depuis le Composer, valide-la, puis « J&apos;ai cuisiné » sur la fiche.
          </EmptyState>
        </Card>
      ) : (
        <section className="grid gap-2.5" aria-labelledby="part-titre">
          <h2 id="part-titre" className="text-[18px] font-bold">
            Coût par part
          </h2>
          <CostTable costs={known} />
        </section>
      )}
      {unknown.length > 0 && <p className="text-[13px] text-ink-2">Sans liste de courses, donc sans coût : {unknown.map((c) => c.name).join(", ")}.</p>}
    </div>
  );
}

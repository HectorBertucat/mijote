import Link from "next/link";
import { desc } from "drizzle-orm";
import { buttonClass, cardClass, EmptyState, Icon, Macro, type PillTone } from "@/components/ui";
import { ListsManager } from "@/components/cart/ListsManager";
import { db } from "@/lib/db/client";
import { shoppingLists, weekPlans } from "@/lib/db/schema";
import { periodLabel } from "@/lib/week/period";
import { pantryTotals, spendingTotals } from "@/lib/costs";
import { catalogEnabled } from "@/lib/chronocatalog";
import { storeLabel } from "@/lib/settings";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, PillTone]> = {
  draft: ["brouillon", "idle"],
  checked: ["vérifiée", "idle"],
  ordered: ["commandée", "ok"],
  paid: ["payée", "ok"],
};

const num = (v: number) => v.toFixed(2).replace(".", ",");

export default function Listes() {
  const store = storeLabel(db);
  const lists = db.select().from(shoppingLists).orderBy(desc(shoppingLists.createdAt)).limit(60).all();
  const weekOf = new Map(db.select().from(weekPlans).all().map((w) => [w.id, w]));
  const rows = lists.map((l) => {
    const [label, tone] = STATUS[l.status] ?? [l.status, "idle" as PillTone];
    const wk = l.weekPlanId ? weekOf.get(l.weekPlanId) : null;
    const when = new Date(l.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
    const week = wk ? ` · ${periodLabel(wk.weekStart, wk.days, "short")}` : "";
    return { id: l.id, title: l.title ?? "Liste de courses", sub: when + week, label, tone, ordered: l.status === "ordered" || l.status === "paid", archived: Boolean(l.archivedAt) };
  });
  const pantry = pantryTotals(db);
  const spent = spendingTotals(db);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Courses</h1>
          <p className="mt-1.5 text-ink-2">{store ? `Listes pour ${store}` : "Tes listes de courses"}{catalogEnabled() ? ", vérifiées sur le catalogue" : ""}</p>
        </div>
        <Link href="/composer" className={buttonClass({ variant: "primary" })}>
          <Icon name="plus" />
          Nouvelle liste
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/placard" className={cardClass({ className: "grid gap-2 p-3.5" })}>
          <span className="flex items-center justify-between font-display text-[17px] font-bold">
            Placard <Icon name="chev" size="s" className="text-faint" />
          </span>
          <Macro value={num(pantry.okValue)} unit="€" sub={`${pantry.okCount ?? 0} lots restants`} />
        </Link>
        <Link href="/couts" className={cardClass({ className: "grid gap-2 p-3.5" })}>
          <span className="flex items-center justify-between font-display text-[17px] font-bold">
            Coûts <Icon name="chev" size="s" className="text-faint" />
          </span>
          <Macro value={num(spent.spent)} unit="€" sub={`dépensés · ${spent.purchases} achats`} />
        </Link>
      </div>

      {lists.length === 0 ? (
        <EmptyState
          scene="basket"
          title="Aucune liste"
          action={
            <Link href="/composer" className={buttonClass({ size: "sm" })}>
              Ouvrir le Composer
            </Link>
          }
        >
          Choisis tes recettes dans le Composer ou la Semaine, puis « Faire la liste de courses ».
        </EmptyState>
      ) : (
        <ListsManager lists={rows.filter((l) => !l.archived)} archived={rows.filter((l) => l.archived)} />
      )}
    </div>
  );
}

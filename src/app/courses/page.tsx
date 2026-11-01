import Link from "next/link";
import { desc } from "drizzle-orm";
import { buttonClass, EmptyState, Icon, type PillTone } from "@/components/ui";
import { Figure, Figures, PageHead } from "@/components/cart/Carnet";
import { ListsManager } from "@/components/cart/ListsManager";
import { db } from "@/lib/db/client";
import { shoppingLists, weekPlans } from "@/lib/db/schema";
import { periodLabel } from "@/lib/week/period";
import { pantryTotals, spendingTotals } from "@/lib/costs";
import { catalogEnabled } from "@/lib/chronocatalog";
import { storeLabel } from "@/lib/settings";
import { plural } from "@/components/semaine/format";
import { firstOfMonth } from "@/lib/typo";

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
    const at = new Date(l.createdAt);
    const day = firstOfMonth(at.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }));
    const time = at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", "\u00a0h\u00a0");
    const week = wk ? `${periodLabel(wk.weekStart, wk.days, "short")} · ` : "";
    return { id: l.id, title: l.title ?? "Liste de courses", day, sub: `${week}faite à ${time}`, label, tone, ordered: l.status === "ordered" || l.status === "paid", archived: Boolean(l.archivedAt) };
  });
  const pantry = pantryTotals(db);
  const spent = spendingTotals(db);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <PageHead
        title="Courses"
        lead={`${store ? `Listes pour ${store}` : "Tes listes de courses"}${catalogEnabled() ? ", vérifiées sur le catalogue" : ""}.`}
        aside={
          <Link href="/composer" className={buttonClass({ variant: "primary" })}>
            <Icon name="plus" />
            Nouvelle liste
          </Link>
        }
      >
        {/* Sans aucun prix (pas de catalogue, rien d’acheté encore) : pas de rangée de « 0,00 € ». */}
        {(pantry.okValue > 0 || spent.spent > 0 || (pantry.okCount ?? 0) > 0) && (
          <Figures className="mt-6">
            <Figure href="/placard" value={num(pantry.okValue)} unit="€" label={`au placard, ${plural(pantry.okCount ?? 0, "reste")}`} />
            <Figure href="/couts" value={num(spent.spent)} unit="€" label={`dépensés, ${plural(spent.purchases, "achat")}`} />
          </Figures>
        )}
      </PageHead>

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

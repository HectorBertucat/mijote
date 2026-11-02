// Nos plats : ce qui est fixe, c’est qui mange combien de portions de quel plat ; le jour est libre. Pour la
// personne affichée (le profil de l’appareil, ou `?pour=`), chaque plat de la réserve avec ses portions
// restantes et les grammes de la prochaine, « J’ai mangé une portion » d’un geste ; puis les plats de la
// période pas encore cuisinés, et ce qu’elle a mangé ces trois derniers jours. Remplace le Frigo : une
// boîte n’est qu’une portion rangée (frigo ou congélo), elle se voit dans la fiche de son plat. En tête,
// le batch du moment : son bilan (/plats/batch/<id>), les plats pas encore pesés (portions estimées).
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DishList } from "@/components/plats/DishList";
import { portions } from "@/components/plats/words";
import { buttonClass, Icon, Pill } from "@/components/ui";
import { DishBox } from "@/components/ui/dish";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { listPeople, todayParis } from "@/lib/health/store";
import { listDishRecipes } from "@/lib/recipes/queries";
import { currentBatch, listDishes, recentServings } from "@/lib/reserve/store";
import { recipeColor } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Plats({ searchParams }: { searchParams: Promise<{ pour?: string }> }) {
  const me = await activeProfileId();
  const people = listPeople(db);
  const { pour } = await searchParams;
  const who = people.find((p) => p.id === pour) ?? people.find((p) => p.id === me) ?? people[0];
  const now = new Date();
  const today = todayParis(now);
  const dishes = who ? listDishes(db, who.id, now) : [];
  const eaten = who ? recentServings(db, who.id, now) : [];
  const slugs = new Set(dishes.map((d) => d.slug));
  const arts = Object.fromEntries([...listDishRecipes(db).values()].filter((d) => slugs.has(d.slug)).map((d) => [d.slug, <DishBox key={d.slug} recipe={d} size="sm" />]));
  const colors = Object.fromEntries(dishes.filter((d) => d.slug).map((d) => [d.slug!, recipeColor(d.slug!)]));
  const cooked = dishes.filter((d) => d.status === "cooked");
  const mine = (d: (typeof dishes)[number]) => d.people.find((p) => p.personId === who?.id);
  const left = cooked.reduce((s, d) => s + (mine(d)?.left ?? 0), 0);
  const withLeft = cooked.filter((d) => (mine(d)?.left ?? 0) > 0).length;
  const self = who?.id === me;
  const batch = currentBatch(db, now);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18 lg:grid-cols-12 lg:gap-x-6">
      <AutoRefresh />
      <header className="grid gap-6 lg:col-span-12">
        <h1 className="text-h1">Nos plats</h1>
        {who && (
          <p className="num max-w-[52ch] text-lead text-ink-2">
            {cooked.length
              ? `${self ? "Pour toi" : `Pour ${who.name}`} : ${portions(left)} dans ${withLeft} plat${withLeft > 1 ? "s" : ""}${cooked.some((d) => d.estimated) ? ", en partie estimées (pas encore pesées)" : ""}. Le jour est libre : chacun mange ses portions quand il veut.`
              : "Rien en réserve. Après la session, on pèse chaque récipient et je dis combien de portions pour chacun."}
          </p>
        )}
        {people.length > 1 && (
          <nav aria-label="Pour qui" className="inline-flex w-fit gap-0.5 rounded-[8px] border border-line bg-surface-2 p-[3px]">
            {people.map((p) => {
              const on = p.id === who?.id;
              return (
                <Link key={p.id} href={p.id === me ? "/plats" : `/plats?pour=${p.id}`} aria-current={on ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-[6px] px-3 text-[14px] font-bold ${on ? "bg-surface text-ink ring-1 ring-line-strong" : "text-ink-2 hover:text-ink"}`}>
                  {p.name}
                </Link>
              );
            })}
          </nav>
        )}
        {batch && (
          <Link href={`/plats/batch/${batch.id}`} className="flex min-w-0 items-center gap-4 border-y border-line-strong py-4 hover:bg-surface-2 lg:max-w-[66%]" data-link="bilan">
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="font-display text-h3 font-bold tracking-[-0.015em]">{batch.title}</span>
              <span className="num text-small text-ink-2">
                {batch.summary.dishes} plat{batch.summary.dishes > 1 ? "s" : ""} · {portions(batch.summary.portions)}
                {batch.summary.toWeigh > 0 ? " · portions estimées d’après le cru : pèse quand tu peux" : " · tout est pesé"}
              </span>
            </span>
            {batch.summary.toWeigh > 0 && (
              <Pill tone="warn" icon="scale">
                {batch.summary.toWeigh} à peser
              </Pill>
            )}
            <Icon name="chev" className="shrink-0 text-faint" />
          </Link>
        )}
      </header>
      <div className="grid gap-12 md:gap-18 lg:col-span-8">
        {who && <DishList dishes={dishes} eaten={eaten} who={{ id: who.id, name: who.name }} me={me} today={today} arts={arts} colors={colors} />}
        {!dishes.length && (
          <section className="grid max-w-[60ch] justify-items-start gap-6 border-t border-line pt-8">
            <h2 className="text-h2">Aucun plat pour l’instant.</h2>
            <p className="text-lead text-ink-2">Choisis les plats de la semaine : je compte les portions de chacun. Après la session, on pèse le plat, le riz, les légumes, et je dis les grammes de chaque portion.</p>
            <Link href="/semaine" className={buttonClass({ variant: "primary" })}>
              Choisir les plats de la semaine
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}

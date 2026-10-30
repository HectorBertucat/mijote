import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BoxList } from "@/components/boxes/BoxList";
import { buttonClass, Card, EmptyState } from "@/components/ui";
import { db } from "@/lib/db/client";
import { listStock } from "@/lib/boxes/store";
import { activePerson } from "@/lib/health/active";
import { todayParis } from "@/lib/health/store";
import { recipeColor } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function Frigo() {
  const today = todayParis();
  const boxes = listStock(db, today);
  const eater = (await activePerson())?.name ?? "";
  const colors = Object.fromEntries(boxes.filter((b) => b.slug).map((b) => [b.slug!, recipeColor(b.slug!)]));
  const places = [
    { id: "fridge", title: "Frigo", boxes: boxes.filter((b) => b.place === "fridge") },
    { id: "freezer", title: "Congélo", boxes: boxes.filter((b) => b.place === "freezer") },
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <AutoRefresh />
      <div>
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Frigo</h1>
        <p className="mt-1.5 text-ink-2">Les boîtes des sessions de cuisine. Une faim : on pioche ici avant de commander.{eater ? ` « Je la mange » note la boîte au journal de ${eater}.` : ""}</p>
      </div>
      {boxes.length === 0 ? (
        <Card flat>
          <EmptyState
            scene="fridge"
            title="Aucune boîte"
            action={
              <Link href="/semaine" className={buttonClass({ size: "sm" })}>
                Préparer la semaine
              </Link>
            }
          >
            Les boîtes arrivent à la fin d&apos;une session de cuisine : on pèse la marmite, l&apos;appli dit combien mettre dans chaque boîte et les range ici.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {places.map((p) => (
            <section key={p.id} className="grid gap-2.5" aria-labelledby={`${p.id}-titre`}>
              <h2 id={`${p.id}-titre`} className="flex items-baseline gap-2 text-[18px] font-bold">
                {p.title}
                <span className="num text-[14px] font-semibold text-faint">{p.boxes.length}</span>
              </h2>
              {p.boxes.length ? <BoxList boxes={p.boxes} colors={colors} today={today} eater={eater} /> : <p className="text-[14px] text-ink-2">{p.id === "fridge" ? "Rien au frigo." : "Rien au congélo."}</p>}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

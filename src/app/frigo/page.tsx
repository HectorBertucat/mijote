import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BoxList } from "@/components/boxes/BoxList";
import { buttonClass, EmptyState } from "@/components/ui";
import { db } from "@/lib/db/client";
import { listStock } from "@/lib/boxes/store";
import { activePerson } from "@/lib/health/active";
import { todayParis } from "@/lib/health/store";
import { recipeColor } from "@/lib/ui";

export const dynamic = "force-dynamic";

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k > 1 ? many : one}`;
const when = (b: { limit: string; freshness: string }, today: string) =>
  b.freshness === "past" ? "à jeter" : b.limit === today ? "à manger aujourd’hui" : b.freshness === "soon" ? "à manger demain" : `jusqu’au ${new Date(`${b.limit}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`;

export default async function Frigo() {
  const today = todayParis();
  const boxes = listStock(db, today);
  const eater = (await activePerson())?.name ?? "";
  const colors = Object.fromEntries(boxes.filter((b) => b.slug).map((b) => [b.slug!, recipeColor(b.slug!)]));
  const places = [
    { id: "fridge", title: "Frigo", empty: "Rien au frigo. Sors une boîte du congélo la veille.", boxes: boxes.filter((b) => b.place === "fridge") },
    { id: "freezer", title: "Congélo", empty: "Rien au congélo.", boxes: boxes.filter((b) => b.place === "freezer") },
  ];
  const first = places[0].boxes[0];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18">
      <AutoRefresh />
      <header className="grid gap-4">
        <h1 className="text-h1">Frigo</h1>
        {boxes.length > 0 && (
          <p className="num max-w-[48ch] text-lead text-ink-2">
            {n(places[0].boxes.length, "boîte")} au frigo, {places[1].boxes.length} au congélo.
            {first ? ` La plus pressée : ${first.name.split(",")[0]}, ${when(first, today)}.` : ""}
          </p>
        )}
      </header>
      {boxes.length === 0 ? (
        <EmptyState
          scene="fridge"
          title="Aucune boîte"
          action={
            <Link href="/semaine" className={buttonClass({ variant: "primary" })}>
              Préparer la semaine
            </Link>
          }
        >
          Les boîtes arrivent à la fin d&apos;une session : on pèse la marmite, l&apos;appli dit combien mettre dans chaque boîte et les range ici.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-6">
          {places.map((p, i) => (
            <section key={p.id} className={`grid gap-6 ${i === 0 ? "lg:col-span-7" : "lg:col-span-5"}`} aria-labelledby={`${p.id}-titre`}>
              <h2 id={`${p.id}-titre`} className="flex items-baseline gap-3 text-h2">
                {p.title}
                <span className="num-tight text-[0.8em] text-ink-3">{p.boxes.length}</span>
              </h2>
              {p.boxes.length ? <BoxList boxes={p.boxes} colors={colors} today={today} eater={eater} /> : <p className="border-y border-line py-4 text-[17px] text-ink-2">{p.empty}</p>}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

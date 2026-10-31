"use client";

// Fin de session : on pèse chaque marmite, l’appli dit les grammes de chaque boîte et les range
// au frigo ou au congélo (src/lib/boxes). Les marmites sont lues à l’ouverture de l’écran.
// Une section de page (filets, pas de carte) : une marmite après l’autre.
import { useContext, useEffect, useState } from "react";
import { DishArts } from "./parts";
import { PotSplit } from "@/components/boxes/PotSplit";
import { loadSessionPots } from "@/app/frigo/actions";
import type { SessionPlan } from "@/lib/session/planner";

type Pots = Awaited<ReturnType<typeof loadSessionPots>>;

export function SessionBoxes({ id, plan, kitchen = false }: { id: string; plan: SessionPlan; kitchen?: boolean }) {
  const [data, setData] = useState<Pots | undefined>(undefined);
  const dishes = useContext(DishArts);
  useEffect(() => {
    let live = true;
    loadSessionPots(id).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [id]);
  if (data === undefined) return <p className="text-[17px] text-ink-2">Je prépare les boîtes…</p>;
  if (!data?.pots.length) return null;
  const colorOf = (slug: string) => plan.recipes.find((r) => r.slug === slug)?.color ?? "var(--c-ink-3)";
  return (
    <section className="grid gap-6 md:grid-cols-12 md:gap-6" aria-labelledby="boites-titre">
      <div className="grid content-start gap-3 md:col-span-4">
        <h2 id="boites-titre" className="text-h2">
          Peser, puis ranger
        </h2>
        <p className="text-[17px] text-ink-2">Pèse chaque marmite : l’appli dit combien mettre dans chaque boîte. Une boîte par repas prévu, le reste au congélo.</p>
      </div>
      <ol className="grid content-start md:col-span-8">
        {data.pots.map((m) => (
          <li key={m.recipeId} className="border-t border-line-strong py-6 first:pt-6">
            <PotSplit model={m} color={colorOf(m.slug)} session={id} stored={data.stored[m.recipeId] ?? null} kitchen={kitchen} art={dishes[m.slug]} />
          </li>
        ))}
      </ol>
    </section>
  );
}

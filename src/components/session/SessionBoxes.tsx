"use client";

// Fin de session : on pèse chaque marmite, l'appli dit les grammes de chaque boîte et les range
// au frigo ou au congélo (src/lib/boxes). Les marmites sont lues à l'ouverture de l'écran.
import { useEffect, useState } from "react";
import { PotSplit } from "@/components/boxes/PotSplit";
import { loadSessionPots } from "@/app/frigo/actions";
import type { SessionPlan } from "@/lib/session/planner";

type Pots = Awaited<ReturnType<typeof loadSessionPots>>;

export function SessionBoxes({ id, plan }: { id: string; plan: SessionPlan }) {
  const [data, setData] = useState<Pots | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadSessionPots(id).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [id]);
  if (data === undefined) return <p className="text-[14px] text-ink-2">Je prépare les boîtes…</p>;
  if (!data?.pots.length) return null;
  const colorOf = (slug: string) => plan.recipes.find((r) => r.slug === slug)?.color ?? "var(--c-ink-3)";
  return (
    <section className="grid gap-4 rounded-[18px] border border-line bg-surface p-5 text-left" aria-labelledby="boites-titre">
      <div>
        <p id="boites-titre" className="font-display text-[20px] leading-tight font-extrabold">
          En boîtes
        </p>
        <p className="text-ink-2">Une boîte par repas prévu dans la Semaine, le reste en marge au congélo.</p>
      </div>
      <div className="grid divide-y divide-line">
        {data.pots.map((m) => (
          <div key={m.recipeId} className="py-4 first:pt-0 last:pb-0">
            <PotSplit model={m} color={colorOf(m.slug)} session={id} stored={data.stored[m.recipeId] ?? null} />
          </div>
        ))}
      </div>
    </section>
  );
}

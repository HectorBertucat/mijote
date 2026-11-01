"use client";

// Fin de session : on pèse chaque marmite, l’appli dit les grammes de chaque boîte et les range
// au frigo ou au congélo (src/lib/boxes). Les marmites sont lues à l’ouverture de l’écran.
// Une section de page (filets, pas de carte) : une marmite après l’autre. Une base cuite pour
// plusieurs recettes (le riz commun) se pèse une fois, en tête : chaque recette en reçoit sa part.
import { useContext, useEffect, useState } from "react";
import { DishArts } from "./parts";
import { PotSplit } from "@/components/boxes/PotSplit";
import { Field, Input } from "@/components/ui";
import { loadSessionPots } from "@/app/frigo/actions";
import { splitShared } from "@/lib/boxes/core";
import { sharedBases } from "@/lib/session/guide";
import type { SessionPlan } from "@/lib/session/planner";

const grams = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};

type Pots = Awaited<ReturnType<typeof loadSessionPots>>;

export function SessionBoxes({ id, plan, kitchen = false }: { id: string; plan: SessionPlan; kitchen?: boolean }) {
  const [data, setData] = useState<Pots | undefined>(undefined);
  const [common, setCommon] = useState<Record<string, string>>({});
  const dishes = useContext(DishArts);
  const bases = sharedBases(plan);
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
  // Le riz commun pesé : la part de chaque recette (au prorata du cru), qui remplit sa garniture.
  const sideOf = new Map<string, { grams: number | null; note: string }>();
  for (const b of bases) {
    const total = grams(common[b.stepId] ?? "");
    const parts = total != null ? splitShared(total, b.lines.map((l) => ({ key: l.recipeSlug, share: l.share }))) : null;
    for (const l of b.lines) sideOf.set(l.recipeSlug, { grams: parts?.[l.recipeSlug] ?? null, note: `${Math.round(l.share * 100)} % ${b.the.replace(/^le |^les |^l’/, (m) => ({ "le ": "du ", "les ": "des ", "l’": "de l’" })[m] ?? m)} commun${parts ? ` : ${parts[l.recipeSlug].toLocaleString("fr-FR")} g` : ""}` });
  }
  return (
    <section className="grid gap-6 md:grid-cols-12 md:gap-6" aria-labelledby="boites-titre">
      <div className="grid content-start gap-3 md:col-span-4">
        <h2 id="boites-titre" className="text-h2">
          Peser, puis ranger
        </h2>
        <p className="text-[17px] text-ink-2">Pèse chaque marmite : l’appli dit combien mettre dans chaque boîte. Une boîte par repas prévu, le reste au congélo.</p>
      </div>
      <ol className="grid content-start md:col-span-8">
        {bases.map((b) => (
          <li key={b.stepId} className="grid gap-3 border-t border-line-strong py-6 first:pt-6" data-commun={b.label}>
            <h3 className="text-h3">{b.the.charAt(0).toLocaleUpperCase("fr") + b.the.slice(1)} commun</h3>
            <p className="text-[17px] text-ink-2">
              Cuit ensemble{b.equipment ? ` dans ${b.equipment}` : ""} pour {b.lines.map((l) => l.name).join(" et ")}. Si tu l’as déjà partagé, pèse chaque part plus bas ; sinon pèse tout ici, chaque recette reçoit sa part.
            </p>
            <div className="max-w-[280px]">
              <Field label={`${b.label.charAt(0).toLocaleUpperCase("fr") + b.label.slice(1)} cuit, en tout`}>
                {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder="g" value={common[b.stepId] ?? ""} onChange={(e) => setCommon((x) => ({ ...x, [b.stepId]: e.target.value }))} data-field="base-commune" />}
              </Field>
            </div>
          </li>
        ))}
        {data.pots.map((m) => (
          <li key={m.recipeId} className="border-t border-line-strong py-6 first:pt-6">
            <PotSplit model={m} color={colorOf(m.slug)} session={id} stored={data.stored[m.recipeId] ?? null} kitchen={kitchen} art={dishes[m.slug]} sharedSide={sideOf.get(m.slug)} />
          </li>
        ))}
      </ol>
    </section>
  );
}

"use client";

// Fin de session : on pèse chaque groupe de chaque marmite (le plat, le riz, les haricots verts),
// l’appli dit combien de portions pour chacun et leurs grammes, puis met la marmite en réserve
// (src/lib/reserve ; les boîtes du congélo à part). Les marmites sont lues à l’ouverture de l’écran.
// Une section de page (filets, pas de carte) : une marmite après l’autre. Une base cuite pour
// plusieurs recettes (le riz commun) se pèse une fois, en tête : chaque recette en reçoit sa part.
// Sans pesée, les plats sont déjà en réserve, estimés d’après le cru ; le bilan du batch (/plats/batch/<id>)
// montre la même section, avec ses données lues par la page (`initial`), pour peser plus tard.
import Link from "next/link";
import { useContext, useEffect, useState } from "react";
import { DishArts } from "./parts";
import { ReserveCalc } from "@/components/plats/ReserveCalc";
import { Field, Input } from "@/components/ui";
import { loadSessionReserves } from "@/app/plats/actions";
import { gramsLabel, splitShared } from "@/lib/boxes/core";
import { sharedBases } from "@/lib/session/guide";
import type { SessionPlan } from "@/lib/session/planner";

const grams = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};

type Pots = Awaited<ReturnType<typeof loadSessionReserves>>;

export function SessionBoxes({ id, plan, kitchen = false, initial, arts }: { id: string; plan: SessionPlan; kitchen?: boolean; /** Le bilan : les marmites lues par la page (rafraîchies avec elle). */ initial?: Pots; arts?: Record<string, React.ReactNode> }) {
  const [loaded, setData] = useState<Pots | undefined>(undefined);
  const data = initial !== undefined ? initial : loaded;
  const [common, setCommon] = useState<Record<string, string>>({});
  const context = useContext(DishArts);
  const dishes = arts ?? context;
  const bases = sharedBases(plan);
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    loadSessionReserves(id).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [id, initial]);
  if (data === undefined) return <p className="text-[17px] text-ink-2">Je prépare les marmites…</p>;
  if (!data?.models.length) return null;
  const bilan = initial !== undefined;
  const toWeigh = data.models.filter((m) => data.saved[m.recipeId] && data.saved[m.recipeId].weigh !== "weighed" && data.saved[m.recipeId].open).length;
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
          {bilan ? "Les pesées" : "Peser, puis ranger"}
        </h2>
        <p className="text-[17px] text-ink-2">
          {bilan
            ? "Pèse chaque récipient quand tu peux, même après un repas : les grammes de chaque portion se corrigent, les kcal de la marmite restent."
            : "Pèse chaque récipient : l’appli dit combien de portions pour chacun et les grammes de chaque portion. Ce qui ne tiendra pas au frigo part en boîtes au congélo."}
        </p>
        {!bilan && toWeigh > 0 && (
          <p className="text-[17px] text-ink-2">
            Pas le temps de peser&nbsp;? Les plats sont déjà en réserve, estimés d’après le cru.{" "}
            <Link href={`/plats/batch/${id}`} className="font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" data-link="bilan">
              Peser plus tard, depuis le bilan du batch
            </Link>
          </p>
        )}
      </div>
      <ol className="grid content-start md:col-span-8">
        {data.bases.length > 0 && (
          <li className="grid gap-2 border-t border-line-strong py-6 first:pt-6" data-bases>
            <h3 className="text-h3">Les bases, dans leurs gros récipients</h3>
            <ul className="grid gap-1">
              {data.bases.map((b) => (
                <li key={b.family} className="num text-[17px]" data-base-fill={b.family}>
                  {b.the.charAt(0).toLocaleUpperCase("fr") + b.the.slice(1)} : ≈ {gramsLabel(b.cookedG)} cuit{b.label.endsWith("s") ? "s" : ""}
                  {b.boxes ? `, de quoi remplir ${b.boxes > 1 ? `${b.boxes} gros récipients` : "un gros récipient"} (${b.liters.toLocaleString("fr-FR")} L)` : ""}.
                </li>
              ))}
            </ul>
            <p className="text-small text-ink-2">Pour tous les plats : chacun s’y sert à chaque repas, la fiche de son plat dit combien. Quand un récipient est vide, Nos plats propose d’en refaire.</p>
          </li>
        )}
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
        {data.models.map((m) => {
          // Le riz commun remplit le premier féculent de la recette.
          const side = sideOf.get(m.slug);
          const starch = m.groups.find((g) => g.kind === "starch");
          return (
            <li key={m.recipeId} className="border-t border-line-strong py-6 first:pt-6">
              <ReserveCalc key={`${m.recipeId}:${data.saved[m.recipeId]?.weigh ?? ""}:${data.saved[m.recipeId]?.eaten ?? 0}`} model={m} color={colorOf(m.slug)} session={id} saved={data.saved[m.recipeId] ?? null} kitchen={kitchen} art={dishes[m.slug]} shared={side && starch ? { key: starch.key, ...side } : null} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

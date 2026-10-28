// Fiche : la famille d'une recette (recipes.parent_id). Sur une originale, ses variantes avec leurs écarts calculés
// en code (kcal et protéines d'une part, coût de la part si on a un prix) ; sur une variante, le lien vers
// l'originale, l'écart de cette version, et ses sœurs. Composant serveur.
import Link from "next/link";
import { Card, Icon, RecipeTile } from "@/components/ui";
import type { Family, FamilyMember } from "@/lib/recipes/variants";
import { recipeColor } from "@/lib/ui";
import { CardTitle } from "./RecipeParts";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
const eur = (n: number) => Math.abs(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Écarts avec l'originale : moins de kcal et plus de protéines en vert, l'inverse en orange ; le coût reste neutre. */
export function DeltaLine({ d, className = "" }: { d: FamilyMember["delta"]; className?: string }) {
  const parts = [
    d.kcal != null && (
      <b key="k" className={`font-display font-bold ${d.kcal <= 0 ? "text-ok" : "text-warn"}`}>
        {sign(d.kcal)}
        {Math.abs(d.kcal)} kcal
      </b>
    ),
    d.protein != null && (
      <b key="p" className={`font-display font-bold ${d.protein >= 0 ? "text-ok" : "text-warn"}`}>
        {sign(d.protein)}
        {Math.abs(d.protein)} g
      </b>
    ),
    d.costH != null && (
      <span key="c" className="font-semibold text-ink-2">
        {sign(d.costH)}
        {eur(d.costH)} €
      </span>
    ),
  ].filter(Boolean);
  if (!parts.length) return <span className={`text-[13px] text-faint ${className}`}>écarts inconnus (nutrition à compléter)</span>;
  return (
    <span className={`num flex flex-wrap items-baseline gap-x-2 text-[14px] ${className}`}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-baseline gap-2">
          {i > 0 && <span className="text-faint">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}

function VariantTile({ m }: { m: FamilyMember }) {
  const inner = (
    <>
      <RecipeTile color={recipeColor(m.slug)} name={m.name} size="sm" className="mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="line-clamp-2 min-w-0 text-[15px] font-semibold leading-[1.25]">{m.name}</span>
        <DeltaLine d={m.delta} />
        <span className="text-[12px] text-ink-2">
          {m.kcal != null ? `${m.kcal} kcal · ${m.protein ?? "?"} g` : "nutrition à compléter"}
          {m.status === "to_try" ? " · à essayer" : ""}
        </span>
      </span>
    </>
  );
  return (
    <Link href={`/recettes/${m.slug}`} className="flex min-w-0 items-start gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5 hover:-translate-y-px hover:border-line-strong hover:shadow-e1">
      {inner}
      <Icon name="chev" className="mt-1 shrink-0 text-faint" />
    </Link>
  );
}

export function RecipeVariants({ family, currentId }: { family: Family | null; currentId: string }) {
  if (!family || (family.isRoot && family.variants.length === 0)) return null;
  const { root, variants } = family;
  const grid = "grid gap-2 sm:grid-cols-2 xl:grid-cols-3";

  if (family.isRoot)
    return (
      <Card as="section" pad="md" className="grid gap-3" aria-label="Variantes">
        <CardTitle aside={<span className="text-[13px] text-ink-2">écarts sur une part, par rapport à cette fiche</span>}>
          {variants.length} variante{variants.length > 1 ? "s" : ""}
        </CardTitle>
        <div className={grid}>
          {variants.map((m) => (
            <VariantTile key={m.id} m={m} />
          ))}
        </div>
      </Card>
    );

  const me = variants.find((m) => m.id === currentId);
  const sisters = variants.filter((m) => m.id !== currentId);
  return (
    <Card as="section" pad="md" className="grid gap-3" aria-label="Recette d'origine et variantes">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Link href={`/recettes/${root.slug}`} className="group flex min-w-0 items-center gap-3">
          <RecipeTile color={recipeColor(root.slug)} name={root.name} size="sm" />
          <span className="grid min-w-0">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">Variante de</span>
            <span className="truncate text-[16px] font-bold text-accent group-hover:underline">{root.name}</span>
          </span>
        </Link>
        {me && (
          <span className="grid justify-items-start gap-0.5 sm:justify-items-end">
            <span className="text-[12px] text-ink-2">cette version, par part</span>
            <DeltaLine d={me.delta} />
          </span>
        )}
      </div>
      {sisters.length > 0 && (
        <>
          <div className="border-t border-line" />
          <span className="text-[13px] font-semibold text-ink-2">
            {sisters.length} autre{sisters.length > 1 ? "s" : ""} variante{sisters.length > 1 ? "s" : ""} · écarts par rapport à l&apos;originale
          </span>
          <div className={grid}>
            {sisters.map((m) => (
              <VariantTile key={m.id} m={m} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

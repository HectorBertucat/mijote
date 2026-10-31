// Fiche : la famille d’une recette (recipes.parent_id). Sur une originale, ses variantes avec leurs écarts calculés
// en code (kcal et protéines d’une part, coût de la part si on a un prix) ; sur une variante, le lien vers
// l’originale (VariantOf, en tête de fiche), l’écart de cette version, et ses sœurs. Composants serveur.
import Link from "next/link";
import { Icon, RecipeTile } from "@/components/ui";
import type { Family, FamilyMember } from "@/lib/recipes/variants";
import { recipeColor } from "@/lib/ui";
import { FicheBlock } from "./fiche/Block";

const NB = " ";
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±");
const eur = (n: number) => Math.abs(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Écarts avec l’originale : moins de kcal et plus de protéines en vert, l’inverse en orange ; le coût reste neutre. */
export function DeltaLine({ d, className = "" }: { d: FamilyMember["delta"]; className?: string }) {
  const parts = [
    d.kcal != null && (
      <b key="k" className={`font-bold ${d.kcal <= 0 ? "text-ok" : "text-warn"}`}>
        {sign(d.kcal)}
        {Math.abs(d.kcal)}
        {NB}kcal
      </b>
    ),
    d.protein != null && (
      <b key="p" className={`font-bold ${d.protein >= 0 ? "text-ok" : "text-warn"}`}>
        {sign(d.protein)}
        {Math.abs(d.protein)}
        {NB}g
      </b>
    ),
    d.costH != null && (
      <span key="c" className="font-semibold text-ink-2">
        {sign(d.costH)}
        {eur(d.costH)}
        {NB}€
      </span>
    ),
  ].filter(Boolean);
  if (!parts.length) return <span className={`text-small text-faint ${className}`}>écarts inconnus, nutrition à compléter</span>;
  return (
    <span className={`num flex flex-wrap items-baseline gap-x-3 text-small ${className}`}>
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </span>
  );
}

function VariantRow({ m }: { m: FamilyMember }) {
  return (
    <li className="border-b border-line">
      <Link href={`/recettes/${m.slug}`} className="group -mx-3 grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-[8px] px-3 py-4 hover:bg-surface-2">
        <RecipeTile color={recipeColor(m.slug)} name={m.name} size="sm" />
        <span className="grid min-w-0 gap-1">
          <span className="font-display text-h3 font-bold">{m.name}</span>
          <span className="flex flex-wrap items-baseline gap-x-3 text-small text-ink-2">
            <DeltaLine d={m.delta} />
            <span className="num">{m.kcal != null ? `${m.kcal}${NB}kcal, ${m.protein ?? "?"}${NB}g de protéines` : null}</span>
            {m.status === "to_try" && <span>à essayer</span>}
          </span>
        </span>
        <Icon name="chev" className="text-faint transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-hover:translate-x-1" />
      </Link>
    </li>
  );
}

/** En tête d’une variante : la recette d’origine, et l’écart de cette version sur une part. */
export function VariantOf({ family, currentId }: { family: Family | null; currentId: string }) {
  if (!family || family.isRoot) return null;
  const me = family.variants.find((m) => m.id === currentId);
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small text-ink-2">
      <span>
        Variante de{" "}
        <Link href={`/recettes/${family.root.slug}`} className="font-semibold text-accent underline-offset-4 hover:underline">
          {family.root.name}
        </Link>
      </span>
      {me && <DeltaLine d={me.delta} />}
    </p>
  );
}

export function RecipeVariants({ family, currentId }: { family: Family | null; currentId: string }) {
  if (!family) return null;
  const others = family.isRoot ? family.variants : family.variants.filter((m) => m.id !== currentId);
  if (!others.length) return null;
  const n = others.length;
  return (
    <FicheBlock
      label="Variantes"
      title={family.isRoot ? `${n} variante${n > 1 ? "s" : ""}` : `${n} autre${n > 1 ? "s" : ""} version${n > 1 ? "s" : ""}`}
      aside={family.isRoot ? "Écarts sur une part, par rapport à cette fiche." : "Écarts sur une part, par rapport à l’originale."}
    >
      <ul className="border-t border-line-strong">
        {others.map((m) => (
          <VariantRow key={m.id} m={m} />
        ))}
      </ul>
    </FicheBlock>
  );
}

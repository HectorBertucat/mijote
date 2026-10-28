import Link from "next/link";
import type { CSSProperties } from "react";
import { buttonClass, cardClass, ChipLink, Chips, EmptyState, Icon, Input, Macro, MacroRow, Pill, RecipeTile, StampNouveau, StampSaison, Tag, verdictTone, verdictWord } from "@/components/ui";
import { db } from "@/lib/db/client";
import { DEFAULT_PORTION_UNITS } from "@/lib/nutrition/compute";
import { cookedCounts, listKeyIngredients, listRecipes, seasonalByRecipe } from "@/lib/recipes/queries";
import { parisMonth } from "@/lib/recipes/season";
import { FoodIllu } from "@/components/illus/Illu";
import { householdUnits, loadEaters } from "@/lib/eaters/store";
import { activeProfileId } from "@/lib/health/active";
import { portionOf, unitsLabel } from "@/lib/eaters/core";
import { variantLinks } from "@/lib/recipes/variants";
import { recipeColor } from "@/lib/ui";

export const dynamic = "force-dynamic";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function Bibliotheque({ searchParams }: { searchParams: Promise<{ tag?: string; q?: string }> }) {
  const { tag, q } = await searchParams;
  const all = listRecipes(db);
  const keyIngredients = listKeyIngredients(db);
  const cooked = cookedCounts(db);
  const seasonal = seasonalByRecipe(db, parisMonth());
  const active = await activeProfileId();
  const eaters = loadEaters(db).sort((a, b) => Number(b.id === active) - Number(a.id === active));
  const count = new Map<string, number>();
  for (const r of all) for (const t of r.tags) if (t !== "à relire") count.set(t, (count.get(t) ?? 0) + 1);
  const tags = [...count.keys()].sort((a, b) => (count.get(b)! - count.get(a)!) || a.localeCompare(b, "fr"));
  const needle = q?.trim() ? fold(q.trim()) : null;
  const links = variantLinks(db);
  const nameOf = new Map(all.map((r) => [r.id, r.name]));
  // Une variante se range juste après son originale (même famille, même liseré), sans disparaître.
  const familyKey = (r: (typeof all)[number]) => fold(r.parentId ? (nameOf.get(r.parentId) ?? r.name) : r.name);
  const shown = all
    .filter((r) => (!tag || r.tags.includes(tag)) && (!needle || fold(`${r.name} ${r.description ?? ""} ${r.tags.join(" ")}`).includes(needle)))
    .sort((a, b) => familyKey(a).localeCompare(familyKey(b), "fr") || Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) || a.name.localeCompare(b.name, "fr"));
  const href = (t?: string) => {
    const p = new URLSearchParams();
    if (t) p.set("tag", t);
    if (q?.trim()) p.set("q", q.trim());
    const s = p.toString();
    return s ? `/recettes?${s}` : "/recettes";
  };
  const perMeal = householdUnits(eaters);
  const lead = eaters[0];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Recettes</h1>
          <p className="mt-1.5 text-ink-2">
            {all.length} recette{all.length > 1 ? "s" : ""} · {lead ? `part de ${lead.name}, calculée sur sa cible pour chaque recette` : "une part de base par recette"}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <form action="/recettes" className="min-w-0 flex-1 sm:w-[260px] sm:flex-none" role="search">
            {tag && <input type="hidden" name="tag" value={tag} />}
            <Input icon="search" type="search" name="q" defaultValue={q ?? ""} placeholder="Chercher une recette" aria-label="Chercher une recette" />
          </form>
          <Link href="/atelier" className={buttonClass({ variant: "primary", className: "max-sm:w-tap max-sm:!px-0" })} aria-label="Atelier : nouvelle recette">
            <Icon name="plus" />
            <span className="max-sm:hidden">Atelier</span>
          </Link>
        </div>
      </div>

      <Chips scroll className="sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <ChipLink href={href()} active={!tag} count={all.length}>
          Toutes
        </ChipLink>
        {tags.map((t) => (
          <ChipLink key={t} href={href(t)} active={tag === t} count={count.get(t)}>
            {t}
          </ChipLink>
        ))}
      </Chips>

      {shown.length === 0 ? (
        <EmptyState
          icon="search"
          title="Aucune recette"
          action={
            <Link href="/recettes" className={buttonClass({ size: "sm" })}>
              Tout afficher
            </Link>
          }
        >
          {needle ? `Rien ne correspond à « ${q} »${tag ? ` avec l'étiquette ${tag}` : ""}.` : "Aucune recette avec cette étiquette."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => {
            const parts = eaters.map((e) => ({ e, p: portionOf(e, r) }));
            const mine = parts[0]?.p;
            const kcal = mine ? mine.kcal : r.kcalUnit != null ? r.kcalUnit * DEFAULT_PORTION_UNITS : null;
            const prot = mine ? mine.protein : r.proteinUnit != null ? r.proteinUnit * DEFAULT_PORTION_UNITS : null;
            const v = mine?.verdict ?? null;
            const meals = Math.floor(r.servingsUnits / (parts.reduce((s, x) => s + x.p.units, 0) || perMeal));
            const rTags = r.tags.filter((t) => t !== "à relire" && t !== "indisponible" && !(t === "variante" && r.parentId));
            const parent = links.parentOf.get(r.id) ?? null;
            const nVariants = links.count.get(r.id) ?? 0;
            const family = parent ?? (nVariants > 0 ? { slug: r.slug } : null);
            // Un seul cachet par carte : « Nouveau » pour une recette à essayer jamais cuisinée, sinon « De saison ».
            const fresh = r.status === "to_try" && !cooked.get(r.id);
            const season = seasonal.get(r.id);
            return (
              <li key={r.id} className="min-w-0">
                <Link
                  href={`/recettes/${r.slug}`}
                  className={cardClass({
                    className: `relative grid h-full content-start gap-3 border-transparent! bg-[color-mix(in_srgb,var(--rc)_11%,var(--c-surface))]! p-3.5 hover:bg-[color-mix(in_srgb,var(--rc)_16%,var(--c-surface))]! active:scale-[0.99] ${family ? "border-l-[3px] border-l-[color:var(--rc)]" : ""}`,
                  })}
                  style={{ "--rc": recipeColor(family?.slug ?? r.slug) } as CSSProperties}
                >
                  {(fresh || season) && (
                    <span className="pointer-events-none absolute -bottom-2 right-1 z-[1]">
                      {fresh ? <StampNouveau size={92} seed={r.slug} /> : <StampSaison size={66} seed={r.slug} title={`De saison : ${season!.join(", ")}`} />}
                    </span>
                  )}
                  {parent && (
                    <span className="-mb-1 flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-ink-2">
                      <Icon name="link" size="s" className="text-faint" />
                      <span className="truncate">variante de {parent.name}</span>
                    </span>
                  )}
                  <span className="flex items-start gap-3">
                    <RecipeTile color={recipeColor(r.slug)} name={r.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[17px] font-bold leading-[1.2]">{r.name}</span>
                      <span className="mt-0.5 block text-[13px] text-ink-2">
                        {meals > 0 ? `${meals} repas à deux · ${perMeal} unités par repas` : `${r.servingsUnits} unités`}
                      </span>
                    </span>
                    {r.tags.includes("à relire") && <Tag tone="warn">à relire</Tag>}
                  </span>
                  {(keyIngredients.get(r.id)?.length ?? 0) > 0 && (
                    <span className="flex flex-wrap gap-1 rounded-[10px] bg-[color-mix(in_srgb,var(--c-surface)_70%,transparent)] p-1.5">
                      {keyIngredients.get(r.id)!.map((i) => (
                        <FoodIllu key={i.item} food={i.foodId} item={i.item} size={36} label={i.item.split(/[,(]/)[0].trim()} />
                      ))}
                    </span>
                  )}
                  {kcal != null && v && (
                    <MacroRow>
                      <Macro value={Math.round(kcal)} unit="kcal" tone={verdictTone(v.kcal)} sub={verdictWord(v.kcal)} />
                      <Macro value={Math.round(prot ?? 0)} unit="g" tone={verdictTone(v.protein)} sub="protéines" />
                    </MacroRow>
                  )}
                  <span className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
                    {r.fridgeDays != null && (
                      <span className="inline-flex items-center gap-[5px]">
                        <Icon name="fridge" size="s" />
                        frigo {r.fridgeDays} j
                      </span>
                    )}
                    {r.freezerOk && (
                      <span className="inline-flex items-center gap-[5px]">
                        <Icon name="snow" size="s" />
                        congèle
                      </span>
                    )}
                    <span>{parts.length ? parts.map((x) => `${x.e.name} ${unitsLabel(x.p.units)}`).join(" · ") : `une part · ${DEFAULT_PORTION_UNITS} u`}</span>
                    {r.notesCount > 0 && (
                      <span className="inline-flex items-center gap-[5px] font-semibold text-accent">
                        <Icon name="sparkdraft" size="s" />
                        {r.notesCount} note{r.notesCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                  {(rTags.length > 0 || r.tags.includes("indisponible") || (r.status === "to_try" && !fresh) || nVariants > 0) && (
                    <span className="flex flex-wrap gap-1.5">
                      {nVariants > 0 && (
                        <Pill tone="idle" icon="link">
                          {nVariants} variante{nVariants > 1 ? "s" : ""}
                        </Pill>
                      )}
                      {r.tags.includes("indisponible") && <Pill tone="ko">indisponible</Pill>}
                      {r.status === "to_try" && !fresh && (
                        <Pill tone="idle" icon="sparkdraft">
                          à essayer
                        </Pill>
                      )}
                      {rTags.slice(0, 4).map((t) => (
                        <Tag key={t}>{t}</Tag>
                      ))}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

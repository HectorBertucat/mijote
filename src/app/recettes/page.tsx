import Link from "next/link";
import { buttonClass, EmptyState, Icon, Input, TONE_TEXT, verdictTone, verdictWord } from "@/components/ui";
import { DishBox } from "@/components/ui/dish";
import { db } from "@/lib/db/client";
import { DEFAULT_PORTION_UNITS } from "@/lib/nutrition/compute";
import { cookedCounts, listDishRecipes, listKeyIngredients, listRecipesWithSteps, seasonalByRecipe } from "@/lib/recipes/queries";
import { parisMonth } from "@/lib/recipes/season";
import { FoodIllu } from "@/components/illus/Illu";
import { loadEaters } from "@/lib/eaters/store";
import { activeProfileId } from "@/lib/health/active";
import { portionOf } from "@/lib/eaters/core";
import { fmtMin } from "@/components/RecipeParts";
import { variantLinks } from "@/lib/recipes/variants";
import { recipeColor } from "@/lib/ui";
import { deName } from "@/components/fiche/words";

export const dynamic = "force-dynamic";

const NB = " ";
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Colonnes du tableau au bureau : boîte, plat, temps actif, part, repères.
const COLS = "sm:grid-cols-[56px_minmax(0,1fr)_6rem_8rem_10rem]";

/** Un filtre : un mot, souligné quand il est choisi ; pas de pastille. */
function TagLink({ href, active, count, children, className = "" }: { href: string; active: boolean; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-tap shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] text-small font-semibold underline-offset-[6px] ${className} ${active ? "text-ink underline decoration-2" : "text-ink-2 hover:text-ink hover:underline hover:decoration-line-strong"}`}
    >
      {children}
      {count != null && <span className="num font-normal text-faint">{count}</span>}
    </Link>
  );
}

export default async function Bibliotheque({ searchParams }: { searchParams: Promise<{ tag?: string; q?: string }> }) {
  const { tag, q } = await searchParams;
  const all = listRecipesWithSteps(db);
  const keyIngredients = listKeyIngredients(db);
  const dishes = listDishRecipes(db);
  const cooked = cookedCounts(db);
  const seasonal = seasonalByRecipe(db, parisMonth());
  const active = await activeProfileId();
  const eaters = loadEaters(db).sort((a, b) => Number(b.id === active) - Number(a.id === active));
  const count = new Map<string, number>();
  for (const r of all) for (const t of r.tags) if (t !== "à relire" && t !== "indisponible") count.set(t, (count.get(t) ?? 0) + 1);
  const tags = [...count.keys()].sort((a, b) => (count.get(b)! - count.get(a)!) || a.localeCompare(b, "fr"));
  const needle = q?.trim() ? fold(q.trim()) : null;
  const links = variantLinks(db);
  const nameOf = new Map(all.map((r) => [r.id, r.name]));
  // Une variante se range juste après son originale, sans disparaître.
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
  const lead = eaters[0];
  const partOf = lead ? `Part ${deName(lead.name)}` : "Une part";

  return (
    <div className="grid gap-12">
      <header className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="grid gap-4 lg:col-span-6">
          <h1 className="text-h1">Recettes</h1>
          <p className="max-w-[48ch] text-lead text-ink-2">
            {all.length}
            {NB}plat{all.length > 1 ? "s" : ""}.{" "}
            {lead ? `Calories et part ${deName(lead.name)}, calculées sur sa cible pour chaque plat.` : `Calories d’une part de base de ${DEFAULT_PORTION_UNITS}${NB}unités.`}
          </p>
        </div>
        <div className="flex items-center gap-2 lg:col-span-6 lg:justify-end">
          <form action="/recettes" className="min-w-0 flex-1 lg:max-w-96" role="search">
            {tag && <input type="hidden" name="tag" value={tag} />}
            <Input icon="search" type="search" name="q" defaultValue={q ?? ""} placeholder="Un plat, un ingrédient" aria-label="Chercher une recette" />
          </form>
          <Link href="/atelier/importer" className={buttonClass({ variant: "quiet", className: "max-sm:w-tap max-sm:!px-0" })} aria-label="Importer une recette depuis un texte collé">
            <Icon name="copy" />
            <span className="max-sm:hidden">Importer</span>
          </Link>
          <Link href="/atelier" className={buttonClass({ variant: "primary", className: "max-sm:w-tap max-sm:!px-0" })} aria-label="Atelier : nouvelle recette">
            <Icon name="plus" />
            <span className="max-sm:hidden">Nouvelle</span>
          </Link>
        </div>
      </header>

      <div className="grid gap-6">
        <nav aria-label="Filtrer par étiquette" className="k-noscroll -mx-5 flex items-center gap-x-6 overflow-x-auto border-y border-line px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <TagLink href={href()} active={!tag} count={all.length}>
            Toutes
          </TagLink>
          {tags.map((t) => (
            // Au bureau, les étiquettes d'un seul plat se trouvent par la recherche ; sur téléphone, la rangée défile.
            <TagLink key={t} href={href(t)} active={tag === t} count={count.get(t)} className={count.get(t)! < 2 && tag !== t ? "sm:hidden" : ""}>
              {t}
            </TagLink>
          ))}
        </nav>

        {shown.length === 0 ? (
          <EmptyState
            icon="search"
            title="Aucun plat"
            action={
              <Link href="/recettes" className={buttonClass({ size: "sm" })}>
                Tout afficher
              </Link>
            }
          >
            {needle ? `Rien ne correspond à «${NB}${q}${NB}»${tag ? ` avec l’étiquette ${tag}` : ""}.` : "Aucun plat avec cette étiquette."}
          </EmptyState>
        ) : (
          <div>
            <div className={`label hidden gap-x-6 border-b border-line-strong pb-3 text-faint sm:grid ${COLS}`} aria-hidden>
              <span />
              <span>
                {shown.length}
                {NB}plat{shown.length > 1 ? "s" : ""}
              </span>
              <span className="text-right">Actif</span>
              <span className="text-right">{partOf}</span>
              <span className="pl-6">Repères</span>
            </div>
            <ul className="reveal">
              {shown.map((r) => {
                const mine = lead ? portionOf(lead, r) : null;
                const kcal = mine ? mine.kcal : r.kcalUnit != null ? Math.round(r.kcalUnit * DEFAULT_PORTION_UNITS) : null;
                const v = mine?.verdict ?? null;
                const activeMin = r.steps.reduce((s, x) => s + (x.activeMin ?? 0), 0);
                const parent = links.parentOf.get(r.id) ?? null;
                const nVariants = links.count.get(r.id) ?? 0;
                const fresh = r.status === "to_try" && !cooked.get(r.id);
                const season = seasonal.get(r.id);
                // Deux repères au plus, du plus utile au moins utile.
                const marks = [
                  r.tags.includes("indisponible") ? { text: "indisponible", cls: "text-ko-ink" } : null,
                  r.tags.includes("à relire") ? { text: "à relire", cls: "text-warn-ink" } : null,
                  fresh ? { text: "jamais cuisinée", cls: "" } : r.status === "to_try" ? { text: "à essayer", cls: "" } : null,
                  r.notesCount > 0 ? { text: `${r.notesCount}${NB}note${r.notesCount > 1 ? "s" : ""}`, cls: "" } : null,
                  season?.length ? { text: `de saison${NB}: ${season[0]}`, cls: "" } : null,
                  r.freezerOk ? { text: "se congèle", cls: "" } : r.fridgeDays != null ? { text: `${r.fridgeDays}${NB}j au frigo`, cls: "" } : null,
                  nVariants > 0 ? { text: `${nVariants}${NB}variante${nVariants > 1 ? "s" : ""}`, cls: "" } : null,
                ]
                  .filter((x): x is { text: string; cls: string } => x != null)
                  .slice(0, 2);
                const time = activeMin > 0 ? fmtMin(activeMin)!.replace(/ /g, NB) : null;
                return (
                  <li key={r.id} className="border-b border-line">
                    <Link
                      href={`/recettes/${r.slug}`}
                      className={`group -mx-3 grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-4 sm:items-center rounded-[8px] px-3 py-4 hover:bg-surface-2 sm:gap-x-6 ${COLS}`}
                    >
                      <DishBox recipe={dishes.get(r.id) ?? { slug: r.slug, name: r.name, ingredients: [] }} color={recipeColor(r.slug)} size="sm" />
                      <span className="grid min-w-0 gap-2">
                        {parent && <span className="text-small text-ink-2">Variante de {parent.name}</span>}
                        <span className="font-display text-h3 font-extrabold [font-stretch:112%] group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{r.name}</span>
                        {(keyIngredients.get(r.id)?.length ?? 0) > 0 && (
                          <span className="flex flex-wrap gap-1" aria-label={`Avec ${keyIngredients.get(r.id)!.map((i) => i.item.split(/[,(]/)[0].trim().toLowerCase()).join(", ")}`}>
                            {keyIngredients.get(r.id)!.map((i) => (
                              <FoodIllu key={i.item} food={i.foodId} item={i.item} size="s" />
                            ))}
                          </span>
                        )}
                        {/* Téléphone : les colonnes deviennent une ligne. */}
                        <span className="num flex flex-wrap gap-x-3 text-small text-ink-2 sm:hidden">
                          {time && <span>{time} actif</span>}
                          {kcal != null && (
                            <span className={v ? TONE_TEXT[verdictTone(v.kcal)] : ""}>
                              {kcal}
                              {NB}kcal
                            </span>
                          )}
                          {marks[0] && <span className={marks[0].cls}>{marks[0].text}</span>}
                        </span>
                      </span>
                      <span className="num-tight text-right text-h3 max-sm:hidden">{time ?? <span className="text-faint">—</span>}</span>
                      <span className="grid justify-items-end gap-1 max-sm:hidden">
                        {kcal != null ? (
                          <>
                            <span className="num-tight text-h3">
                              {kcal}
                              <span className="ml-1 text-small font-semibold text-ink-2">kcal</span>
                            </span>
                            {v && (
                              <span className={`inline-flex items-center gap-1 text-small ${TONE_TEXT[verdictTone(v.kcal)]}`}>
                                <Icon name={v.kcal === "ok" ? "check" : "alert"} size="s" />
                                {verdictWord(v.kcal)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-small text-faint">à compléter</span>
                        )}
                      </span>
                      <span className="grid gap-1 pl-6 text-small text-ink-2 max-sm:hidden">
                        {marks.map((m) => (
                          <span key={m.text} className={m.cls}>
                            {m.text}
                          </span>
                        ))}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

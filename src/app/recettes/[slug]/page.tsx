import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CookAction } from "@/components/cart/CookedButton";
import { FicheSection, FicheSections } from "@/components/FicheSections";
import { NotesSection } from "@/components/NoteForm";
import { NutritionPanel } from "@/components/Nutrition";
import { ProductsPanel } from "@/components/ProductsPanel";
import { RecipeCostPanel } from "@/components/RecipeCost";
import { CardTitle, equipmentIcon, fmtMin, StepItem } from "@/components/RecipeParts";
import { AdjustButton, AdjustNotice, AdjustProvider, AdjustSlot } from "@/components/atelier/Adjust";
import { RecipeVariants } from "@/components/RecipeVariants";
import { DrawMissing } from "@/components/illus/DrawMissing";
import { missingArt } from "@/lib/illus/ai";
import { IngredientsDiff } from "@/components/atelier/RecipeDiff";
import { Alert, Card, Icon, Macro, MacroRow, Pill, RecipeTile, StampCongele, StampNouveau, StampSaison, Tag, verdictTone, verdictWord } from "@/components/ui";
import { aiMockEnabled, expectedDurationMs, monthlyCapUsd, spentThisMonth } from "@/lib/ai";
import { adjustOptions, loadProposal, loadRecipeInput, type AdjustProposal } from "@/lib/atelier";
import { familyOf } from "@/lib/recipes/variants";
import { planCookUsage, recipeCost } from "@/lib/costs";
import { db } from "@/lib/db/client";
import { round, scale } from "@/lib/nutrition/compute";
import { activeProfileId } from "@/lib/health/active";
import { cookedCounts, getRecipe, listPeople } from "@/lib/recipes/queries";
import { inSeason, parisMonth } from "@/lib/recipes/season";
import { householdMembers, householdUnits, loadEaters } from "@/lib/eaters/store";
import { portionOf } from "@/lib/eaters/core";
import { recipeColor } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function FicheRecette({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = getRecipe(db, slug);
  if (!data) notFound();
  const { recipe: r, steps, notes } = data;
  const ingredients = data.ingredients;
  const people = listPeople(db);
  const color = recipeColor(r.slug);
  const cost = recipeCost(db, r.id);
  const plan = planCookUsage(db, r.id);
  const input = loadRecipeInput(db, slug)!;
  const family = familyOf(db, r.id);

  const activeMin = steps.reduce((s, x) => s + (x.step.activeMin ?? 0), 0);
  const perUnit = r.kcalUnit != null ? { kcal: r.kcalUnit, protein: r.proteinUnit ?? 0, carbs: r.carbsUnit ?? 0, fat: r.fatUnit ?? 0, fiber: r.fiberUnit ?? 0 } : null;
  // Le profil actif en tête : l'en-tête montre sa part du jour, l'atelier parle de sa part de base.
  const active = await activeProfileId();
  const eaters = loadEaters(db).sort((a, b) => Number(b.id === active) - Number(a.id === active));
  const household = householdMembers(db, active);
  const lead = perUnit && eaters[0] ? round(scale(perUnit, eaters[0].baseUnits)) : null;
  const parts = eaters.map((e) => ({ e, p: portionOf(e, { kcalUnit: r.kcalUnit, proteinUnit: r.proteinUnit }) }));
  const first = parts[0];
  const v = first?.p.verdict ?? null;
  const meals = Math.floor(r.servingsUnits / Math.max(1, parts.reduce((s, x) => s + x.p.units, 0) || householdUnits(eaters)));
  const tags = r.tags.filter((t) => t !== "à relire" && t !== "indisponible");
  const facts = [
    `${r.servingsUnits} unités`,
    meals > 0 ? `${meals} repas${eaters.length > 1 ? ` pour ${eaters.length}` : ""}` : null,
    r.fridgeDays != null ? `frigo ${r.fridgeDays} j` : null,
    r.freezerOk ? "congèle" : null,
    steps.length > 0 && activeMin > 0 ? `≈ ${fmtMin(activeMin)} actives` : null,
  ].filter(Boolean);
  // Cachets de la fiche (deux au plus) : jamais cuisinée, de saison, se congèle.
  const season = inSeason(ingredients.filter((i) => !i.optional).map((i) => ({ item: i.item, food: i.foodId })), parisMonth());
  const stamps = [
    r.status === "to_try" && !cookedCounts(db).get(r.id) ? <StampNouveau key="n" size={104} seed={r.slug} /> : null,
    season.length ? <StampSaison key="s" size={76} seed={r.slug} title={`De saison : ${season.join(", ")}`} /> : null,
    r.freezerOk ? <StampCongele key="c" size={76} seed={`${r.slug}c`} /> : null,
  ]
    .filter(Boolean)
    .slice(0, 2);
  const rows = input.ingredients.map((i, k) => ({ key: `${k}-${i.item}`, status: "same" as const, before: null, after: i, check: null }));
  const sections = [
    { id: "ingredients", label: "Bols" },
    { id: "produits", label: "Produits" },
    { id: "etapes", label: "Étapes", count: steps.length },
    { id: "nutrition", label: "Nutrition" },
    { id: "notes", label: "Notes", count: notes.length || undefined },
  ];

  return (
    <AdjustProvider
      slug={r.slug}
      color={color}
      original={input}
      options={adjustOptions(input, household)}
      lead={lead}
      leadName={eaters[0]?.name ?? null}
      leadRef={eaters[0]?.ref ?? null}
      budget={{ spentUsd: spentThisMonth(db), capUsd: monthlyCapUsd() }}
      expectedMs={expectedDurationMs(db, "ajuster", { mock: aiMockEnabled() }).ms}
      initial={loadProposal<AdjustProposal>(db, r.id)}
    >
      <article className="grid grid-cols-1 gap-5">
        <AutoRefresh />
        <header className="relative grid gap-3.5">
          <Link href="/recettes" className="inline-flex w-fit items-center gap-1 text-[14px] font-semibold text-ink-2 hover:text-ink">
            <Icon name="chev" size="s" className="rotate-180" />
            Recettes
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <RecipeTile color={color} name={r.name} size="lg" />
              <div className="min-w-0">
                <h1 className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">{r.name}</h1>
                <p className="mt-1.5 text-[14px] text-ink-2 sm:text-[16px]">{facts.join(" · ")}</p>
              </div>
            </div>
            {stamps.length > 0 && <div className="flex shrink-0 items-center gap-1 max-sm:absolute max-sm:right-0 max-sm:top-0 max-sm:scale-75 max-sm:origin-top-right sm:ml-auto lg:ml-0">{stamps}</div>}
            <div className="hidden shrink-0 gap-2 sm:flex">
              <AdjustButton />
              <CookAction recipeId={r.id} slug={r.slug} plan={plan} />
            </div>
          </div>

          {first?.p.kcal != null && v && (
            <MacroRow className="lg:hidden">
              <Macro value={first.p.kcal} unit="kcal" tone={verdictTone(v.kcal)} sub={`${verdictWord(v.kcal)} · ${first.e.name}`} />
              <Macro value={first.p.protein ?? 0} unit="g" tone={verdictTone(v.protein)} sub="protéines" />
              {cost?.partLead && <Macro value={cost.partLead.practical.toFixed(2).replace(".", ",")} unit="€" sub="la part" />}
            </MacroRow>
          )}
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            <AdjustButton block />
            <CookAction recipeId={r.id} slug={r.slug} plan={plan} block />
          </div>
          <AdjustNotice />
          <RecipeVariants family={family} currentId={r.id} />

          {(r.description || tags.length > 0 || r.status === "to_try" || r.tags.includes("indisponible")) && (
            <div className="grid gap-2">
              {r.description && <p className="max-w-[70ch] text-[15px] text-ink-2">{r.description}</p>}
              <div className="flex flex-wrap gap-1.5">
                {r.tags.includes("indisponible") && <Pill tone="ko">indisponible</Pill>}
                {r.status === "to_try" && (
                  <Pill tone="idle" icon="sparkdraft">
                    à essayer
                  </Pill>
                )}
                {tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
          )}
          {r.tags.includes("à relire") && (
            <Alert tone="warn" title="À relire">
              {r.source}
            </Alert>
          )}
        </header>

        <FicheSections sections={sections}>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="grid min-w-0 gap-5">
              <FicheSection id="ingredients">
                <AdjustSlot part="ingredients">
                  <IngredientsDiff rows={rows} color={color} />
                </AdjustSlot>
                <DrawMissing slug={r.slug} items={missingArt(db, ingredients.map((i) => ({ item: i.item, food: i.foodId })))} aiReady={Boolean(process.env.ANTHROPIC_API_KEY) || aiMockEnabled()} />
              </FicheSection>
              <FicheSection id="etapes" className="grid gap-5">
                <AdjustSlot part="steps">
                  <Card as="section" pad="md">
                    <CardTitle>Étapes</CardTitle>
                    <ol>
                      {steps.map(({ step: s, equipmentName }) => (
                        <StepItem
                          key={s.id}
                          n={s.order}
                          color={color}
                          step={{
                            kind: s.kind,
                            text: s.text,
                            durationMin: s.durationMin,
                            hobLevel: s.hobLevel,
                            ovenTemp: s.ovenTemp,
                            equipment: equipmentName ? { label: equipmentName, icon: equipmentIcon(s.equipmentKind, s.equipmentId) } : null,
                            bowls: s.bowlRefs,
                            cue: s.cue,
                            phases: s.phases,
                          }}
                        />
                      ))}
                    </ol>
                  </Card>
                </AdjustSlot>
                {r.tips && (
                  <Alert tone="info" title="Conseils">
                    <span className="leading-relaxed">{r.tips}</span>
                  </Alert>
                )}
              </FicheSection>
            </div>

            <div className="grid min-w-0 gap-5">
              <FicheSection id="nutrition" className="grid gap-5">
                {perUnit && (
                  <AdjustSlot part="nutrition">
                    <NutritionPanel
                      perUnit={perUnit}
                      coverage={r.nutritionCoverage}
                      servingsUnits={r.servingsUnits}
                      eaters={eaters}
                      ingredients={ingredients.map((i) => ({ item: i.item, foodId: i.foodId, grams: i.grams, units: i.units, yield: i.yield }))}
                    />
                  </AdjustSlot>
                )}
                {cost && <RecipeCostPanel cost={cost} plan={plan} />}
              </FicheSection>
              <FicheSection id="notes">
                <Card as="section" pad="md" className="grid gap-3">
                  <CardTitle aside={notes.length > 0 ? <span className="num text-[14px] text-faint">{notes.length}</span> : null}>Notes</CardTitle>
                  <NotesSection
                    recipeId={r.id}
                    slug={r.slug}
                    people={people}
                    notes={notes.map(({ note: n, personName }) => ({ id: n.id, category: n.category, text: n.text, personName, createdAt: n.createdAt }))}
                  />
                </Card>
              </FicheSection>
            </div>
          </div>
          <FicheSection id="produits">
            <ProductsPanel recipeId={r.id} slug={r.slug} />
          </FicheSection>
        </FicheSections>
      </article>
    </AdjustProvider>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CookAction } from "@/components/cart/CookedButton";
import { FicheSection, FicheSections } from "@/components/FicheSections";
import { NotesSection } from "@/components/NoteForm";
import { NutritionPanel } from "@/components/Nutrition";
import { ProductsPanel } from "@/components/ProductsPanel";
import { costSource, hasPrice, RecipeCostPanel } from "@/components/RecipeCost";
import { equipmentIcon, fmtMin, StepItem } from "@/components/RecipeParts";
import { AdjustButton, AdjustNotice, AdjustProvider, AdjustSlot } from "@/components/atelier/Adjust";
import { RecipeVariants, VariantOf } from "@/components/RecipeVariants";
import { DrawMissing } from "@/components/illus/DrawMissing";
import { missingArt } from "@/lib/illus/ai";
import { BlockTitle, FicheBlock, Vichy } from "@/components/fiche/Block";
import { BigDuration, Figures, type Figure } from "@/components/fiche/Figures";
import { IngredientTable } from "@/components/fiche/Ingredients";
import { deName } from "@/components/fiche/words";
import { Alert, Icon, TONE_TEXT, verdictTone, verdictWord } from "@/components/ui";
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
import { potModel } from "@/lib/boxes/store";
import { PotSplit } from "@/components/boxes/PotSplit";
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
  // Calculette : la marmite pesée → les grammes de chaque boîte (src/lib/boxes).
  const pot = potModel(db, r.slug);

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
  // Une recette importée garde son lien en source.
  const sourceUrl = r.source && /^https?:\/\/\S+$/.test(r.source) ? r.source : null;
  const season = inSeason(ingredients.filter((i) => !i.optional).map((i) => ({ item: i.item, food: i.foodId })), parisMonth());
  const priced = hasPrice(cost);
  const myCost = priced ? (cost!.parts.find((p) => p.personId === first?.e.id) ?? cost!.parts[0]) : null;
  const of = first ? deName(first.e.name) : "";
  const mealsWord = meals > 0 ? `${meals} repas${eaters.length > 1 ? ` pour ${eaters.length}` : ""}` : null;

  // Bande de tête : trois chiffres seulement (temps actif, kcal de la part, prix de la part).
  const figures: Figure[] = [
    { key: "temps", value: activeMin > 0 ? <BigDuration min={activeMin} /> : "—", label: "Temps actif" },
    first?.p.kcal != null
      ? {
          key: "kcal",
          value: first.p.kcal,
          unit: "kcal",
          label: `La part ${of}`,
          sub: v ? (
            <span className={`inline-flex items-center gap-1 font-semibold ${TONE_TEXT[verdictTone(v.kcal)]}`}>
              <Icon name={v.kcal === "ok" ? "check" : "alert"} size="s" />
              {verdictWord(v.kcal)}
            </span>
          ) : null,
        }
      : { key: "kcal", value: "—", label: "Nutrition à compléter" },
    myCost
      ? { key: "prix", value: myCost.cost.practical.toFixed(2).replace(".", ","), unit: "€", label: "Prix de la part", sub: costSource(cost!) }
      : { key: "repas", value: meals > 0 ? meals : r.servingsUnits, unit: meals > 0 ? "repas" : "unités", label: eaters.length > 1 ? `Pour ${eaters.length} personnes` : "Une fournée" },
  ];
  const facts = [
    `Fournée de ${r.servingsUnits}\u00a0unités`,
    myCost ? mealsWord : null,
    parts.length > 1 ? parts.map((x) => `${x.e.name} ${x.p.units.toLocaleString("fr-FR")}`).join(", ") + " par repas" : null,
    r.fridgeDays != null ? `${r.fridgeDays}\u00a0jour${r.fridgeDays > 1 ? "s" : ""} au frigo` : null,
    r.freezerOk ? "se congèle" : null,
    season.length ? `de saison\u00a0: ${season.join(", ")}` : null,
    r.status === "to_try" && !cookedCounts(db).get(r.id) ? "jamais cuisinée" : null,
  ].filter(Boolean);
  const sections = [
    { id: "ingredients", label: "Ingrédients" },
    { id: "etapes", label: "Étapes", count: steps.length },
    { id: "chiffres", label: "Chiffres" },
    { id: "notes", label: "Notes", count: notes.length || undefined },
    { id: "produits", label: "Produits" },
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
      <article className="grid grid-cols-1">
        <AutoRefresh />
        <header className="grid gap-6">
          <Vichy color={color} className="h-6" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link href="/recettes" className="label -ml-2 inline-flex min-h-tap items-center gap-1 rounded-[8px] px-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Icon name="chev" size="s" className="rotate-180" />
              Recettes
            </Link>
            <div className="hidden shrink-0 gap-2 sm:flex">
              <AdjustButton />
              <CookAction recipeId={r.id} slug={r.slug} plan={plan} />
            </div>
          </div>
          <div className="grid gap-4">
            <VariantOf family={family} currentId={r.id} />
            <h1 className="max-w-[20ch] text-h1">{r.name}</h1>
            {r.description && <p className="max-w-[60ch] text-lead text-ink-2">{r.description}</p>}
          </div>
          <div className="grid gap-4">
            <Figures items={figures} />
            <p className="text-small text-ink-2">{facts.join(" · ")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:hidden">
            <AdjustButton block />
            <CookAction recipeId={r.id} slug={r.slug} plan={plan} block />
          </div>
          <AdjustNotice />
          {r.tags.includes("indisponible") && (
            <Alert tone="ko" title="Indisponible">
              Un ingrédient n’a ni produit au catalogue, ni remplaçant.
            </Alert>
          )}
          {r.tags.includes("à relire") && (
            <Alert tone="warn" title="À relire">
              {r.tags.includes("importée") ? "Recette importée : quantités douteuses, à relire avant de cuisiner." : r.source}
            </Alert>
          )}
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit min-w-0 max-w-full items-center gap-2 text-small font-semibold text-accent underline-offset-4 hover:underline">
              <Icon name="link" size="s" />
              <span className="truncate">Source : {sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
            </a>
          )}
        </header>

        <div className="mt-12 lg:mt-18">
          <FicheSections sections={sections}>
            <div className="grid items-start gap-x-6 gap-y-12 max-lg:pt-6 lg:grid-cols-12">
              <FicheSection id="ingredients" className="lg:col-span-5">
                <AdjustSlot part="ingredients">
                  <BlockTitle aside={`pour ${r.servingsUnits}\u00a0unités`}>Ingrédients</BlockTitle>
                  <IngredientTable ingredients={input.ingredients} color={color} />
                </AdjustSlot>
                <DrawMissing slug={r.slug} items={missingArt(db, ingredients.map((i) => ({ item: i.item, food: i.foodId })))} aiReady={Boolean(process.env.ANTHROPIC_API_KEY) || aiMockEnabled()} />
              </FicheSection>
              <FicheSection id="etapes" className="lg:col-span-7">
                <AdjustSlot part="steps">
                  <BlockTitle aside={activeMin > 0 ? `${fmtMin(activeMin)} les mains occupées` : null}>Étapes</BlockTitle>
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
                </AdjustSlot>
                {r.tips && (
                  <aside className="mt-6 grid gap-2 border-l-2 border-[color:var(--rc)] pl-4 sm:ml-24" style={{ "--rc": color } as React.CSSProperties}>
                    <span className="label text-ink-2">Le conseil</span>
                    <p className="text-body">{r.tips}</p>
                  </aside>
                )}
              </FicheSection>
            </div>

            <FicheSection id="chiffres" className="grid gap-12 lg:mt-18 lg:gap-18">
              {perUnit && (
                <FicheBlock title="Nutrition" aside={first ? `La part de chacun suit sa cible.` : null} label="Nutrition">
                  <AdjustSlot part="nutrition">
                    <NutritionPanel
                      bare
                      perUnit={perUnit}
                      coverage={r.nutritionCoverage}
                      servingsUnits={r.servingsUnits}
                      eaters={eaters}
                      ingredients={ingredients.map((i) => ({ item: i.item, foodId: i.foodId, grams: i.grams, units: i.units, yield: i.yield }))}
                    />
                  </AdjustSlot>
                </FicheBlock>
              )}
              {cost && (
                <FicheBlock title="Coût par part" aside={priced ? "En paquets entiers, au prix du drive." : null} label="Coût">
                  <RecipeCostPanel cost={cost} plan={plan} />
                </FicheBlock>
              )}
              {pot && (
                <FicheBlock title="En boîtes" aside="La marmite pesée, partagée selon la part de chacun." label="En boîtes">
                  <PotSplit model={pot} color={color} head={false} />
                </FicheBlock>
              )}
              <RecipeVariants family={family} currentId={r.id} />
            </FicheSection>

            <FicheSection id="notes" className="lg:mt-18">
              <FicheBlock title="Notes" aside={notes.length > 0 ? `${notes.length}\u00a0note${notes.length > 1 ? "s" : ""}` : "Pour la prochaine fois."} label="Notes">
                <NotesSection
                  recipeId={r.id}
                  slug={r.slug}
                  people={people}
                  notes={notes.map(({ note: n, personName }) => ({ id: n.id, category: n.category, text: n.text, personName, createdAt: n.createdAt }))}
                />
              </FicheBlock>
            </FicheSection>
            <FicheSection id="produits" className="lg:mt-18">
              <ProductsPanel recipeId={r.id} slug={r.slug} />
            </FicheSection>
          </FicheSections>
        </div>
      </article>
    </AdjustProvider>
  );
}

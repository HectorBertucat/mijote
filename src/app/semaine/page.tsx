import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, ChipLink, Chips, Icon, StampSemainePrete } from "@/components/ui";
import { DishBox } from "@/components/ui/dish";
import { dishRecipes } from "@/components/semaine/dishes";
import { db } from "@/lib/db/client";
import { addDays, COOK_DAY, MEAL_LABEL, stepFactor, unitsOf, type Meal } from "@/lib/week/propose";
import { clampDays, defaultPeriod, isDay, neighbour, periodDays, periodHeading, periodLabel, weekdayOf } from "@/lib/week/period";
import { periodPlans, weekView } from "@/lib/week/store";
import { composerHref } from "@/lib/week/selection";
import { joinFr } from "@/lib/week/tastes";
import { estimateRecipe, estimateSession } from "@/lib/session/estimate";
import { densityOf, fitBadge, fitRank, fitsAll, fitSummary, proteinDense, recipeFits, weekFit, type Served } from "@/lib/week/fit";
import { buildPlan } from "@/lib/session/store";
import { FactorStepper, type Control } from "@/components/semaine/FactorStepper";
import { Leftovers, LeftoversSkeleton } from "@/components/semaine/Leftovers";
import { TastesNote } from "@/components/semaine/Tastes";
import { WeekListStatus } from "@/components/semaine/WeekListStatus";
import { PendingButton } from "@/components/semaine/PendingButton";
import { PartMacros } from "@/components/semaine/PartMacros";
import { WeekGrid, type GridCell } from "@/components/semaine/WeekGrid";
import { MenuBoard, type BoardDay } from "@/components/semaine/MenuBoard";
import { PeriodPicker } from "@/components/semaine/PeriodPicker";
import { PickButton } from "@/components/semaine/Pick";
import { FitMark, FitNote, FitWarnings } from "@/components/semaine/Fit";
import { Dock, Figures, Fold, HowTo, Notice } from "@/components/semaine/Parts";
import { fmtG, fmtMin, plural } from "@/components/semaine/format";
import { recipeColor } from "@/lib/ui";
import { WeekNutrition } from "@/components/WeekNutrition";
import { dayRefOf, weekNutrition } from "@/lib/week/nutrition";
import { SubmitButton } from "@/components/SubmitButton";
import { PendingMark } from "@/components/PendingMark";
import { addAction, clearAction, extraAction, factorAction, proposeAction, removeAction, weekListAction } from "./actions";

export const dynamic = "force-dynamic";

const MEALS: Meal[] = ["lunch", "dinner"];
const MAX = 4;
/** « dimanche 1er novembre » */
const longDate = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  const day = d.getUTCDate();
  const f = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("fr-FR", { ...o, timeZone: "UTC" });
  return `${f({ weekday: "long" })} ${day === 1 ? "1er" : day} ${f({ month: "long" })}`;
};

export default async function Semaine({ searchParams }: { searchParams: Promise<{ w?: string; n?: string; done?: string; f?: string }> }) {
  const { w: wParam, n: nParam, done, f } = await searchParams;
  // La période : `w` = premier jour ; `n` = nombre de jours d’une période pas encore créée (navigation).
  const plans = periodPlans(db);
  const def = defaultPeriod(plans, new Date());
  const w = isDay(wParam) ? wParam : def.start;
  const view = weekView(db, w, isDay(wParam) ? (nParam ? clampDays(Number(nParam)) : undefined) : def.days);
  const N = view.days;
  const pdays = periodDays(w, N);
  const dayName = (d: number) => `${pdays[d].short}. ${pdays[d].num}`;
  const prev = neighbour(plans, w, N, -1);
  const next = neighbour(plans, w, N, 1);
  const { grid, selected, assignment: a, library, selection, tastes, eaters } = view;
  const bySlug = new Map([...library, ...selected].map((r) => [r.slug, r]));
  // La boîte de chaque plat, dessinée à partir de ses ingrédients.
  const boxes = dishRecipes(db, library);
  const box = (slug: string, size: "sm" | "md", className = "") => {
    const d = boxes.get(slug);
    return d ? <DishBox recipe={d} size={size} className={className} /> : null;
  };
  const rankOf = (id: string) => {
    const i = eaters.findIndex((e) => e.id === id);
    return i < 0 ? eaters.length : i;
  };
  const est = selected.length ? estimateSession(selected) : null;
  const slugs = selected.map((r) => r.slug);
  const scales = Object.fromEntries(selection.filter((x) => x.factor !== 1).map((x) => [x.slug, x.factor]));
  const extras = Object.assign({}, ...selection.map((x) => x.extras)) as Record<string, number>;
  // Durée prévue par le planificateur, aux unités choisies (comme le Composer).
  const plan = selected.length ? buildPlan(db, { slugs, scales, mode: "solo" }) : null;
  const people = [...new Map(grid.map((s) => [s.personId, { id: s.personId, name: s.personName }])).values()].sort((x, y) => rankOf(x.id) - rankOf(y.id));
  const cell = (day: number, meal: Meal, personId: string) => grid.find((s) => s.day === day && s.meal === meal && s.personId === personId);
  const frozen = new Set(a.recipes.flatMap((r) => r.meals.filter((m) => m.frozen).flatMap((m) => m.personIds.map((p) => `${m.day}:${m.meal}:${p}`))));
  const uncovered = new Set(a.uncovered.map((s) => `${s.day}:${s.meal}:${s.personId}`));
  const flash = flashText(done, bySlug);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const recipeNames = Object.fromEntries(library.map((r) => [r.slug, r.name]));
  // Repère de chacun (src/lib/eaters) : la cible de Santé quand la dépense est mesurée ; le repère
  // estimé par formule dès que le profil existe.
  const eaterOf = new Map(eaters.map((e) => [e.id, e]));
  // Hors batch jour par jour quand il vient des habitudes (le shaker de semaine ne compte pas le dimanche).
  const outside = new Map(eaters.filter((e) => e.outside).map((e) => [e.id, e.outsideByDay ?? e.outside!]));
  const nutrition = selected.length
    ? weekNutrition(
        grid,
        [...bySlug.values()], // grammes ajoutés : macros recalculées des recettes retenues
        people.map((p) => p.id),
        outside,
        N,
        (d) => weekdayOf(addDays(w, d))
      ).map((wk) => {
        const e = eaterOf.get(wk.personId);
        return { id: wk.personId, name: people.find((p) => p.id === wk.personId)?.name ?? wk.personId, week: wk, ref: e ? dayRefOf(e) : null };
      })
    : null;
  const toSetup = eaters.filter((e) => e.missing.length > 0 && e.source !== "fixe");

  // Cases de la grille (une par jour et repas), pour le composant client.
  const cells: GridCell[] = pdays.flatMap(({ i: day }) =>
    MEALS.map((meal) => {
      const slots = people.map((p) => cell(day, meal, p.id)).filter((s): s is NonNullable<typeof s> => !!s);
      const dishes = [...new Set(slots.map((s) => s.slug).filter((x): x is string => !!x))].map((slug) => ({ slug, name: bySlug.get(slug)?.name ?? slug, color: recipeColor(slug) }));
      return {
        day,
        meal,
        slots: slots.map((s) => ({ id: s.id, personId: s.personId, name: s.personName, initial: s.personName.charAt(0), place: s.place })),
        dishes,
        missing: slots.some((s) => uncovered.has(`${day}:${meal}:${s.personId}`)),
        frozen: slots.some((s) => frozen.has(`${day}:${meal}:${s.personId}`)),
      };
    })
  );
  // Menu de la semaine, et cachet « Semaine prête » : recettes choisies, tous les repas couverts, courses commandées.
  const board: BoardDay[] = pdays.map(({ i: day, short, num }) => {
    const at = (meal: Meal) => cells.find((c) => c.day === day && c.meal === meal)?.dishes.map((d) => ({ name: d.name, color: d.color })) ?? [];
    return { label: `${short}. ${num}`, lunch: at("lunch"), dinner: at("dinner") };
  });
  const ready = selected.length > 0 && a.uncovered.length === 0 && !!view.list?.ordered && !view.list.changed;
  const awayNote = people
    .map((p) => {
      const away = pdays.map(({ i: d }) => MEALS.every((m) => cell(d, m, p.id)?.place === "away")).map((x, d) => (x ? d : -1)).filter((d) => d >= 0);
      if (!away.length) return null;
      if (away.length === N) return `${p.name} : absent toute la période`;
      return `${p.name} : absence ${away.length === 1 ? `le ${dayName(away[0])}` : `${away.length} jours`}`;
    })
    .filter((x): x is string => !!x);
  const officeMeals = cells.reduce((s, c) => s + c.slots.filter((x) => x.place === "office").length, 0);

  // Objectifs de chacun (src/lib/week/fit.ts) : une pastille par plat, un tri, et l’écart de la sélection.
  const goals = eaters.some((e) => e.ref);
  const shelfLib = library.filter((r) => r.status !== "archived" && r.servingsUnits > 0);
  const fitsOf = new Map(shelfLib.map((r) => [r.slug, recipeFits(eaters, r, tastes.excluded.get(r.slug))]));
  const dense = proteinDense(shelfLib, eaters);
  const served: Served = new Map();
  for (const rp of a.recipes)
    for (const m of rp.meals)
      for (const pid of m.personIds) {
        const by = served.get(pid) ?? new Map<string, number>();
        by.set(rp.slug, (by.get(rp.slug) ?? 0) + 1);
        served.set(pid, by);
      }
  const fit = goals && selected.length ? weekFit(eaters, selected, { served, library: shelfLib, excluded: tastes.excluded }) : null;
  const farOff = selected.flatMap((r) => {
    const b = fitBadge(recipeFits(eaters, r, tastes.excluded.get(r.slug)));
    return b?.tone === "warn" ? [`${r.name}, ${b.text.charAt(0).toLowerCase()}${b.text.slice(1)}`] : [];
  });

  // Bibliothèque (choisir ses plats) : filtres simples, sans unités ni nombre de repas.
  const filters = FILTERS.filter((x) => goals || x.id !== "objectifs");
  const filter = filters.find((x) => x.id === f) ?? filters[0];
  const byGoals = filter.id === "objectifs";
  const chosen = new Set(slugs);
  const shelf = shelfLib
    .map((r) => ({ r, est: estimateRecipe(r) }))
    .filter(({ r, est }) => (byGoals ? fitsAll(fitsOf.get(r.slug) ?? []) : filter.match(r, est.activeMin)))
    .sort(
      (x, y) =>
        Number(chosen.has(y.r.slug)) - Number(chosen.has(x.r.slug)) ||
        (byGoals ? fitRank(fitsOf.get(x.r.slug) ?? []) - fitRank(fitsOf.get(y.r.slug) ?? []) || (densityOf(y.r) ?? 0) - (densityOf(x.r) ?? 0) : 0) ||
        (x.r.status === "liked" ? 0 : 1) - (y.r.status === "liked" ? 0 : 1) ||
        x.r.name.localeCompare(y.r.name, "fr")
    );
  // Repas servis par recette (une personne à un repas = un repas), pour parler en repas et pas en unités.
  const servedOf = (slug: string) => a.recipes.find((p) => p.slug === slug)?.meals.reduce((s, m) => s + m.personIds.length, 0) ?? 0;
  const frozenOf = (slug: string) => a.recipes.find((p) => p.slug === slug)?.meals.filter((m) => m.frozen).reduce((s, m) => s + m.personIds.length, 0) ?? 0;
  const toEat = cells.reduce((s, c) => s + c.slots.filter((x) => x.place !== "away").length, 0);
  const covered = toEat - a.uncovered.length;
  const frozenMeals = slugs.reduce((s, x) => s + frozenOf(x), 0);
  // Un écart au repère seulement quand il compte, sur la moyenne de la semaine de chacun (fit.ts).
  const fitWarnings = fit?.warnings ?? [];
  const minutes = plan ? plan.totalMin : est ? est.totalMin : null;
  const title = periodHeading(w, N);
  const cookDate = addDays(w, COOK_DAY);
  const cookDay = longDate(cookDate).split(" ")[0];
  const missing = missingText(a.uncovered, people.length, names, dayName);
  const full = selected.length >= MAX;
  // Sans plat choisi, rien à avertir : tout « manque » par définition.
  const hasNotices = selected.length > 0 && (a.uncovered.length > 0 || fitWarnings.length > 0 || (est?.conflicts.length ?? 0) > 0 || toSetup.length > 0);
  const keep = (extra?: Record<string, string>) => (
    <>
      <input type="hidden" name="w" value={w} />
      {f && <input type="hidden" name="f" value={f} />}
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      {/* La période, en très grand, et de quoi en changer. */}
      <header className="grid gap-6 lg:grid-cols-12 lg:items-end">
        <div className="min-w-0 lg:col-span-8">
          <div className="flex flex-wrap items-center gap-x-6">
            <h1 className="text-display">{title}</h1>
            {ready && <StampSemainePrete seed={w} size={118} className="-my-4" />}
          </div>
          <p className="mt-4 max-w-[46ch] text-lead text-ink">
            Coche 1 à 3&nbsp;plats, je calcule les quantités et je répartis les {toEat}&nbsp;repas{people.length > 1 ? ` de ${joinFr(people.map((p) => p.name))}` : ""}.
          </p>
          <p className="mt-2 text-small text-ink-2">
            Cuisine le {longDate(cookDate)}
            {officeMeals > 0 && ` · ${plural(officeMeals, "repas emporté", "repas emportés")}`}
            {awayNote.length > 0 && ` · ${awayNote.join(", ")}`}
          </p>
        </div>
        <nav className="flex items-center gap-2 lg:col-span-4 lg:justify-end" aria-label="Changer de période">
          <Link href={`/semaine?w=${prev.start}&n=${prev.days}`} className={buttonClass({ iconOnly: true })} aria-label={`Période précédente : ${periodLabel(prev.start, prev.days)}`} title="Période précédente">
            <PendingMark idle={<Icon name="chev" className="rotate-180" />} />
          </Link>
          <PeriodPicker key={`${w}:${N}`} start={w} days={N} />
          <Link href={`/semaine?w=${next.start}&n=${next.days}`} className={buttonClass({ iconOnly: true })} aria-label={`Période suivante : ${periodLabel(next.start, next.days)}`} title="Période suivante">
            <PendingMark idle={<Icon name="chev" />} />
          </Link>
        </nav>
      </header>

      {flash && (
        <p key={done} role="status" className="animate-pop mt-8 flex motion-reduce:animate-none items-center gap-2 text-small text-ink">
          <Icon name="check" size="s" className="shrink-0 text-accent" />
          {flash}
        </p>
      )}

      {/* 4/8 : la semaine choisie à gauche, la bibliothèque à droite. */}
      <div className="mt-12 grid gap-12 lg:mt-18 lg:grid-cols-12 lg:gap-6">
        <section className={`min-w-0 content-start gap-12 lg:col-span-4 ${selected.length ? "grid" : "hidden lg:grid"}`} aria-labelledby="choix-titre">
          {selected.length > 0 && (
            <Figures
              stack
              items={[
                {
                  value: (
                    <>
                      {covered}
                      <span className="text-ink-3">/{toEat}</span>
                    </>
                  ),
                  label: "repas couverts",
                },
                { value: minutes != null ? fmtMin(minutes) : "—", label: `en cuisine ${cookDay}` },
                { value: frozenMeals, label: "repas au congélo" },
              ]}
            />
          )}

          <div className="grid gap-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="choix-titre" className="text-h2">
                Tes plats
              </h2>
              {selected.length > 0 && (
                <form action={clearAction}>
                  {keep()}
                  <PendingButton variant="quiet" loadingLabel="J’efface…">
                    Tout effacer
                  </PendingButton>
                </form>
              )}
            </div>
            {selected.length === 0 ? (
              <p className="max-w-[40ch] text-body text-ink-2">
                Rien de choisi pour l’instant. Coche des plats dans la liste&nbsp;; pas d’idée, «&#8239;Propose-moi la semaine&#8239;» choisit pour toi.
              </p>
            ) : (
              <ul className="border-b border-line">
                {selected.map((r) => {
                  const served = servedOf(r.slug);
                  const frozenN = frozenOf(r.slug);
                  return (
                    <li key={r.slug} className="flex min-w-0 items-center gap-4 border-t border-line py-4">
                      {box(r.slug, "sm")}
                      <div className="min-w-0 flex-1">
                        <Link href={`/recettes/${r.slug}`} className="block font-bold leading-[1.25] text-ink underline-offset-4 hover:underline">
                          {r.name}
                        </Link>
                        <p className={`text-small ${served ? "text-ink-2" : "text-warn-ink"}`}>{served ? `${plural(served, "repas", "repas")}${frozenN ? `, dont ${frozenN} au congélo` : ""}` : "ne sert à aucun repas"}</p>
                      </div>
                      <form action={removeAction}>
                        {keep({ slug: r.slug })}
                        <PendingButton variant="quiet" icon="x" iconOnly label={`Retirer ${r.name}`} title="Retirer" />
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            {view.list && <WeekListStatus list={view.list} />}
          </div>

          {hasNotices && (
            <section aria-labelledby="alertes-titre">
              <h2 id="alertes-titre" className="sr-only">
                À regarder
              </h2>
              <ul className="border-b border-line">
                {a.uncovered.length > 0 && (
                  <Notice
                    action={
                      !full && (
                        <form action={proposeAction}>
                          {keep()}
                          <PendingButton loadingLabel="Je complète…">Compléter pour moi</PendingButton>
                        </form>
                      )
                    }
                  >
                    <b>Il manque {plural(a.uncovered.length, "repas", "repas")}</b>&nbsp;: {missing}. {full ? "Quatre plats ne suffisent pas : prévois-les à part, ou note les absences." : null}
                  </Notice>
                )}
                {est?.conflicts.map((c, i) => (
                  <Notice key={`c${i}`} icon={/four/i.test(c.message) ? "oven" : "pot"}>
                    {c.message} <span className="num whitespace-nowrap text-ink-2">+{fmtMin(c.extraMin)}</span>
                  </Notice>
                ))}
                <FitWarnings
                  warnings={fitWarnings}
                  add={
                    full
                      ? undefined
                      : (slug, name) => (
                          <form action={addAction}>
                            {keep({ slug })}
                            <PendingButton loadingLabel="J’ajoute…" label={`Ajouter ${name}`}>
                              Ajouter
                            </PendingButton>
                          </form>
                        )
                  }
                />
                {toSetup.map((e) => (
                  <Notice
                    key={e.id}
                    icon="info"
                    action={
                      <Link href={`/sante/demarrer?p=${e.id}`} className={buttonClass({ size: "sm" })}>
                        Compléter
                      </Link>
                    }
                  >
                    Part de {e.name} à la taille habituelle&nbsp;: il manque {joinFr(e.missing)}.
                  </Notice>
                ))}
              </ul>
            </section>
          )}
          {fit && <FitNote fit={fit} summary={fitSummary(fit)} loin={farOff} />}
          <TastesNote rules={tastes.rules} dislikes={tastes.dislikes} names={names} recipeNames={recipeNames} selected={slugs} />
        </section>

        <section className="grid min-w-0 content-start gap-6 lg:col-span-8" aria-labelledby="biblio-titre">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="biblio-titre" className="text-h2">
              Qu’est-ce qu’on cuisine&nbsp;?
            </h2>
            <span className="text-small text-ink-2">{full ? "4 plats au plus : retire-en un pour changer" : `${plural(shelf.length, "plat")} · un tap pour cocher`}</span>
          </div>
          <Chips scroll>
            {filters.map((x) => (
              <ChipLink key={x.id} href={`/semaine?w=${w}${x.id === "tout" ? "" : `&f=${encodeURIComponent(x.id)}`}#biblio-titre`} active={x.id === filter.id} scroll={false}>
                {x.label}
              </ChipLink>
            ))}
          </Chips>
          <ul className="reveal grid gap-3 sm:grid-cols-2">
            {shelf.map(({ r, est: e }) => {
              const on = chosen.has(r.slug);
              const facts = [`${fmtMin(e.activeMin)}\u00a0actif`, r.tags.includes("one pot") ? "one\u00a0pot" : null, r.freezerOk ? "se\u00a0congèle" : null, r.status === "liked" ? null : "à\u00a0essayer"].filter(Boolean).join(" · ");
              const badge = fitBadge(fitsOf.get(r.slug) ?? [], dense.has(r.slug));
              const label = `${on ? "Retirer" : "Choisir"} ${r.name}${badge ? ` (${badge.text.charAt(0).toLowerCase()}${badge.text.slice(1)})` : ""}`;
              return (
                <li key={r.slug} className="min-w-0">
                  <form action={on ? removeAction : addAction} className="h-full">
                    {keep({ slug: r.slug })}
                    <PickButton
                      on={on}
                      disabled={!on && full}
                      name={r.name}
                      visual={box(r.slug, "md", "sm:!h-32 sm:!w-full sm:!rounded-none")}
                      facts={
                        <>
                          {facts}
                          <FitMark badge={badge} />
                        </>
                      }
                      label={label}
                    />
                  </form>
                </li>
              );
            })}
          </ul>
          {shelf.length === 0 && <p className="text-body text-ink-2">Aucun plat dans ce filtre.</p>}
        </section>
      </div>

      {/* Le détail, replié : absences, menu, quantités, nutrition, paquets entamés. */}
      <div className="mt-12 border-b border-line lg:mt-18">
        <Fold id="absences" title="Absences" aside={[awayNote.length ? awayNote.join(" · ") : officeMeals ? "Personne d’absent" : "Tout le monde mange à tous les repas", officeMeals ? plural(officeMeals, "repas emporté", "repas emportés") : null].filter(Boolean).join(" · ")}>
          <div className="grid gap-4">
            <p className="max-w-[60ch] text-small text-ink-2">
              Un tap sur une initiale&nbsp;: à la maison, au bureau (repas emporté), absent. Les repas et les quantités se recalent.
            </p>
            <WeekGrid cells={cells} days={pdays} proposed={selected.length > 0} />
          </div>
        </Fold>

        {selected.length > 0 && (
          <Fold id="menu" title="Menu de la semaine" aside={`${plural(cells.filter((c) => c.dishes.length).length, "repas", "repas")} à table · à partager en image`}>
            <MenuBoard title={periodLabel(w, N)} days={board} ready={ready} />
          </Fold>
        )}

        {selected.length > 0 && (
          <Fold id="quantites" title="Quantités à cuire" aside={a.recipes.map((rp) => factorNote(bySlug.get(rp.slug)!)).join(" · ")}>
            <ul className="border-b border-line">
              {a.recipes.map((rp) => {
                const r = bySlug.get(rp.slug)!;
                const factor = r.factor ?? 1;
                const ctl = (fx: number): Control | null => (fx === factor ? null : { action: factorAction, fields: { w, slug: rp.slug, factor: String(fx) }, to: fx });
                const added = view.extraLines.filter((x) => x.slug === rp.slug);
                return (
                  <li key={rp.slug} className="grid gap-4 border-t border-line py-6 lg:grid-cols-12 lg:items-center lg:gap-6">
                    <div className="flex min-w-0 items-center gap-4 lg:col-span-4">
                      {box(rp.slug, "sm")}
                      <div className="min-w-0">
                        <b className="block leading-[1.25]">{r.name}</b>
                        <p className="num text-small text-ink-2">
                          {rp.unitsUsed}&nbsp;u mangées · {rp.unitsLeft > 0 ? `${rp.unitsLeft} u en trop${r.freezerOk ? ", au congélo" : ""}` : "rien ne reste"} · frigo {r.fridgeDays ?? 3}&nbsp;jours
                        </p>
                      </div>
                    </div>
                    <PartMacros kcalUnit={r.kcalUnit} proteinUnit={r.proteinUnit} eaters={eaters} className="lg:col-span-5" />
                    <FactorStepper name={r.name} factor={factor} units={unitsOf(r)} dec={ctl(stepFactor(factor, -1))} inc={ctl(stepFactor(factor, 1))} className="justify-self-start lg:col-span-3 lg:justify-self-end" />
                    {added.map((x) => (
                      <form key={x.ingredientId} action={extraAction} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small lg:col-span-12">
                        <Icon name="leaf" size="s" className="text-ink-2" />
                        <span className="min-w-0 flex-1">
                          +{fmtG(x.grams)} {x.item.split(/[,(]/)[0].toLowerCase()} pour finir le paquet
                        </span>
                        <input type="hidden" name="w" value={w} />
                        <input type="hidden" name="slug" value={rp.slug} />
                        <input type="hidden" name="ingredientId" value={x.ingredientId} />
                        <input type="hidden" name="grams" value="0" />
                        <PendingButton variant="quiet">Retirer</PendingButton>
                      </form>
                    ))}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <HowTo>
                <p>Les quantités se calent toutes seules sur les repas, jusqu’au double de la fiche&nbsp;; − et + pour forcer.</p>
                <p>La part de chacun suit sa cible&nbsp;: (cible du jour − ce qu’il mange hors batch) ÷ 2, au demi près.</p>
                <p>Au-delà de la durée au frigo, le congélateur prend le relais si le plat le supporte.</p>
              </HowTo>
              <Link href={composerHref({ slugs, scales, extras })} className="inline-flex min-h-tap items-center gap-2 text-small font-bold text-ink-2 hover:text-ink">
                Ouvrir dans le Composer <PendingMark idle={<Icon name="chev" size="s" />} />
              </Link>
            </div>
          </Fold>
        )}

        {nutrition && (
          <Fold id="nutrition" title="Nutrition" aside="Apports moyens par jour, sur les repas du batch">
            <WeekNutrition people={nutrition} letters={pdays.map((d) => d.letter)} />
          </Fold>
        )}

        {selected.length > 0 && (
          <Fold id="restes" title="Paquets entamés" aside="Ce qui restera des paquets achetés, et quoi en faire">
            <Suspense key={JSON.stringify(selection)} fallback={<LeftoversSkeleton head={false} />}>
              <Leftovers sel={selection} mode={{ kind: "week", w }} head={false} />
            </Suspense>
          </Fold>
        )}
      </div>

      {/* La seule chose qui flotte : où on en est, et l’action suivante. */}
      <Dock
        title={selected.length ? `${plural(selected.length, "plat")} · ${covered} repas sur ${toEat}` : `Aucun plat · ${toEat} repas à couvrir`}
        sub={dockSub({ n: selected.length, missing: a.uncovered.length, minutes, cookDay, list: view.list })}
      >
        {selected.length === 0 ? (
          <form action={proposeAction}>
            {keep()}
            <SubmitButton pendingText="Je choisis…" icon="sparkdraft">
              Propose-moi la semaine
            </SubmitButton>
          </form>
        ) : ready ? (
          <Link href={composerHref({ slugs, scales, extras })} className={buttonClass({ variant: "accent" })}>
            Cuisiner {cookDay} <PendingMark idle={<Icon name="chev" size="s" />} />
          </Link>
        ) : view.list && !view.list.changed ? (
          <Link href={`/courses/${view.list.id}`} className={buttonClass({ variant: "primary" })}>
            <Icon name="basket" /> Voir la liste <PendingMark />
          </Link>
        ) : (
          <form action={weekListAction}>
            {keep()}
            <SubmitButton pendingText="Je fais la liste…" icon="basket">
              {view.list ? "Refaire la liste" : "Faire la liste"}
            </SubmitButton>
          </form>
        )}
      </Dock>
    </div>
  );
}

/** « Chasseur à la fiche », « Pasta ×1,5 » */
const factorNote = (r: { name: string; factor?: number }) => `${r.name.split(/\s+/)[0]} ${(r.factor ?? 1) === 1 ? "à la fiche" : `×${String(r.factor).replace(".", ",")}`}`;

/** La deuxième ligne de la barre : ce qui reste à faire, en chiffres. */
function dockSub({ n, missing, minutes, cookDay, list }: { n: number; missing: number; minutes: number | null; cookDay: string; list: { ordered: boolean; changed: boolean; building: boolean } | null }) {
  if (n === 0) return "Coche des plats, ou laisse-moi choisir";
  const time = minutes != null ? `${fmtMin(minutes)} en cuisine ${cookDay}` : null;
  const state = missing ? `${missing} à prévoir à part` : "tout est couvert";
  const shop = !list ? null : list.changed ? "la semaine a changé depuis la liste" : list.building ? "liste en préparation" : list.ordered ? "courses commandées" : "liste en brouillon";
  return [state, shop ?? time].filter(Boolean).join(" · ");
}

/** « dim. 8 midi et soir, lun. 9 soir (Sam) » : les repas sans plat, groupés par jour. */
function missingText(slots: { day: number; meal: Meal; personId: string }[], everyone: number, names: Record<string, string>, dayName: (d: number) => string): string {
  const byDay = new Map<number, Map<Meal, string[]>>();
  for (const s of slots) {
    const m = byDay.get(s.day) ?? new Map<Meal, string[]>();
    m.set(s.meal, [...(m.get(s.meal) ?? []), s.personId]);
    byDay.set(s.day, m);
  }
  return [...byDay]
    .sort(([x], [y]) => x - y)
    .map(([d, m]) => {
      const meals = MEALS.filter((meal) => m.has(meal)).map((meal) => {
        const who = m.get(meal)!;
        return `${MEAL_LABEL[meal]}${who.length < everyone ? ` (${who.map((id) => names[id] ?? id).join(", ")})` : ""}`;
      });
      return `${dayName(d)} ${meals.join(" et ")}`;
    })
    .join(", ");
}

type Filter = { id: string; label: string; match: (r: { tags: string[]; freezerOk: boolean; status?: string }, activeMin: number) => boolean };
const FILTERS: Filter[] = [
  { id: "tout", label: "Tout", match: () => true },
  // Filtré et trié par la page (fit.ts) : seulement quand quelqu’un a un repère.
  { id: "objectifs", label: "Pour nos objectifs", match: () => true },
  { id: "one pot", label: "One pot", match: (r) => r.tags.includes("one pot") },
  { id: "rapide", label: "Rapide", match: (r, m) => r.tags.includes("rapide") || m <= 40 },
  { id: "four", label: "Four", match: (r) => r.tags.includes("four") },
  { id: "congele", label: "Se congèle", match: (r) => r.freezerOk },
  { id: "aimees", label: "Aimés", match: (r) => r.status === "liked" },
  { id: "essayer", label: "À essayer", match: (r) => r.status !== "liked" },
];

function flashText(done: string | undefined, bySlug: Map<string, { name: string }>): string | null {
  if (!done) return null;
  const name = (s: string) => bySlug.get(s)?.name ?? s;
  const [kind, a = "", b = ""] = done.split(":");
  if (kind === "propose") {
    const s = a.split(",").filter(Boolean);
    return s.length ? `Semaine proposée : ${s.map(name).join(", ")}.` : "Personne ne mange à la maison ou au bureau : rien à proposer.";
  }
  if (kind === "swap") return b ? `${name(b)} remplace ${name(a)}.` : `Pas d’autre plat pour remplacer ${name(a)}.`;
  if (kind === "clear") return "Plats retirés : la semaine est vide.";
  if (kind === "period") return `Période réglée : ${a} jour${Number(a) > 1 ? "s" : ""}. Les quantités se sont recalées.`;
  if (kind === "add") return `Plat ajouté\u00a0: ${name(a)}.`;
  if (kind === "remove") return `Plat retiré\u00a0: ${name(a)}.`;
  if (kind === "extra") return `${fmtG(Number(b))} ajoutés à ${name(a)} : le paquet est fini.`;
  if (kind === "unextra") return `Grammes ajoutés retirés de ${name(a)}.`;
  return null;
}

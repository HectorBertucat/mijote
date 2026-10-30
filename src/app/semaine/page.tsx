import Link from "next/link";
import { Suspense } from "react";
import { Alert, buttonClass, Card, ChipLink, Chips, Icon, Macro, MacroRow, RecipeTile, StampSemainePrete } from "@/components/ui";
import { db } from "@/lib/db/client";
import { addDays, COOK_DAY, MEAL_LABEL, stepFactor, unitsOf, type Meal } from "@/lib/week/propose";
import { clampDays, defaultPeriod, isClassicWeek, isDay, neighbour, periodDays, periodHeading, periodLabel, weekdayOf } from "@/lib/week/period";
import { periodPlans, weekView } from "@/lib/week/store";
import { composerHref } from "@/lib/week/selection";
import { joinFr } from "@/lib/week/tastes";
import { estimateRecipe, estimateSession } from "@/lib/session/estimate";
import { portionOf } from "@/lib/eaters/core";
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
import { fmtG } from "@/components/semaine/format";
import { recipeColor } from "@/lib/ui";
import { WeekNutrition } from "@/components/WeekNutrition";
import { dayRefOf, weekNutrition } from "@/lib/week/nutrition";
import { SubmitButton } from "@/components/SubmitButton";
import { PendingMark } from "@/components/PendingMark";
import { addAction, clearAction, extraAction, factorAction, proposeAction, removeAction, weekListAction } from "./actions";

export const dynamic = "force-dynamic";

const MEALS: Meal[] = ["lunch", "dinner"];
const fmtMin = (m: number) => {
  const r = Math.round(m / 5) * 5;
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};
const longDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function Semaine({ searchParams }: { searchParams: Promise<{ w?: string; n?: string; done?: string; f?: string }> }) {
  const { w: wParam, n: nParam, done, f } = await searchParams;
  // La période : `w` = premier jour ; `n` = nombre de jours d'une période pas encore créée (navigation).
  const plans = periodPlans(db);
  const def = defaultPeriod(plans, new Date());
  const w = isDay(wParam) ? wParam : def.start;
  const view = weekView(db, w, isDay(wParam) ? (nParam ? clampDays(Number(nParam)) : undefined) : def.days);
  const N = view.days;
  const pdays = periodDays(w, N);
  const dayName = (d: number) => `${pdays[d].short} ${pdays[d].num}`;
  const prev = neighbour(plans, w, N, -1);
  const next = neighbour(plans, w, N, 1);
  const { grid, selected, assignment: a, library, selection, tastes, eaters } = view;
  const bySlug = new Map([...library, ...selected].map((r) => [r.slug, r]));
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
  const cooked = selected.reduce((s, r) => s + unitsOf(r), 0);
  const people = [...new Map(grid.map((s) => [s.personId, { id: s.personId, name: s.personName }])).values()].sort((x, y) => rankOf(x.id) - rankOf(y.id));
  const cell = (day: number, meal: Meal, personId: string) => grid.find((s) => s.day === day && s.meal === meal && s.personId === personId);
  const frozen = new Set(a.recipes.flatMap((r) => r.meals.filter((m) => m.frozen).flatMap((m) => m.personIds.map((p) => `${m.day}:${m.meal}:${p}`))));
  const uncovered = new Set(a.uncovered.map((s) => `${s.day}:${s.meal}:${s.personId}`));
  const flash = flashText(done, bySlug);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const initial = (id: string) => people.find((x) => x.id === id)?.name.charAt(0) ?? "?";
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
  const eatenUnits = a.recipes.reduce((s, r) => s + r.unitsUsed, 0) + a.uncovered.reduce((s, x) => s + x.portionUnits, 0);

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
  // Ardoise du menu, et cachet « Semaine prête » : recettes choisies, tous les repas couverts, courses commandées.
  const board: BoardDay[] = pdays.map(({ i: day, short, num }) => {
    const at = (meal: Meal) => cells.find((c) => c.day === day && c.meal === meal)?.dishes.map((d) => ({ name: d.name, color: d.color })) ?? [];
    return { label: N > 7 ? `${short}. ${num}` : `${short}.`, lunch: at("lunch"), dinner: at("dinner") };
  });
  const ready = selected.length > 0 && a.uncovered.length === 0 && !!view.list?.ordered && !view.list.changed;
  const toCover = cells.filter((c) => c.slots.some((s) => s.place !== "away")).length;
  const awayNote = people
    .map((p) => {
      const away = pdays.map(({ i: d }) => MEALS.every((m) => cell(d, m, p.id)?.place === "away")).map((x, d) => (x ? d : -1)).filter((d) => d >= 0);
      if (!away.length || away.length === N) return null;
      return `${p.name} : absence ${away.length === 1 ? `le ${dayName(away[0])}` : `${away.length} jours`}`;
    })
    .filter(Boolean);

  // Bibliothèque (choisir ses recettes) : filtres simples, sans unités ni nombre de repas.
  const filter = FILTERS.find((x) => x.id === f) ?? FILTERS[0];
  const chosen = new Set(slugs);
  const shelf = library
    .filter((r) => r.status !== "archived" && r.servingsUnits > 0)
    .map((r) => ({ r, est: estimateRecipe(r) }))
    .filter(({ r, est }) => filter.match(r, est.activeMin))
    .sort((x, y) => Number(chosen.has(y.r.slug)) - Number(chosen.has(x.r.slug)) || (x.r.status === "liked" ? 0 : 1) - (y.r.status === "liked" ? 0 : 1) || x.r.name.localeCompare(y.r.name, "fr"));
  // Repas servis par recette (une personne à un repas = un repas), pour parler en repas et pas en unités.
  const servedOf = (slug: string) => a.recipes.find((p) => p.slug === slug)?.meals.reduce((s, m) => s + m.personIds.length, 0) ?? 0;
  const frozenOf = (slug: string) => a.recipes.find((p) => p.slug === slug)?.meals.filter((m) => m.frozen).reduce((s, m) => s + m.personIds.length, 0) ?? 0;
  const toEat = cells.reduce((s, c) => s + c.slots.filter((x) => x.place !== "away").length, 0);
  const covered = toEat - a.uncovered.length;
  // Une part hors repère seulement quand elle compte : protéines trop basses, ou part bloquée (plat trop léger ou trop riche).
  const offTarget = selected.flatMap((r) =>
    eaters
      .filter((e) => e.ref)
      .map((e) => ({ e, p: portionOf(e, r) }))
      .filter(({ p }) => p.verdict && (p.verdict.protein === "low" || p.capped))
      .map(({ e, p }) => `${r.name} : ${p.verdict!.protein === "low" ? `un peu léger en protéines pour ${e.name}` : `part de ${e.name} difficile à caler`}`)
  );
  const minutes = plan ? plan.totalMin : est ? est.totalMin : null;
  const title = periodHeading(w, N);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">{title}</h1>
            {ready && <StampSemainePrete seed={w} size={118} className="-my-3" />}
          </div>
          <p className="mt-1.5 text-ink-2">
            <span className="num">{toEat}</span> repas{isClassicWeek(w, N) ? "" : <> · <span className="num">{N}</span> jour{N > 1 ? "s" : ""}</>} · session le {longDate(addDays(w, COOK_DAY))}
            {awayNote.length > 0 && ` · ${awayNote.join(", ")}`}
          </p>
        </div>
        <nav className="flex items-center gap-1" aria-label="Changer de période">
          <PeriodPicker key={`${w}:${N}`} start={w} days={N} />
          <Link href={`/semaine?w=${prev.start}&n=${prev.days}`} className={buttonClass({ iconOnly: true })} aria-label="Période précédente">
            <PendingMark idle={<Icon name="chev" className="rotate-180" />} />
          </Link>
          <Link href={`/semaine?w=${next.start}&n=${next.days}`} className={buttonClass({ iconOnly: true })} aria-label="Période suivante">
            <PendingMark idle={<Icon name="chev" />} />
          </Link>
        </nav>
      </div>

      {flash && (
        <Alert key={done} tone="ok" role="status" className="animate-pop">
          {flash}
        </Alert>
      )}

      <Card as="section" pad="md" className="grid gap-3" aria-labelledby="choix-titre" id="recettes">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="choix-titre" className="text-[18px] font-bold">
            Tes recettes
          </h2>
          {selected.length > 0 && (
            <span className={`num text-[14px] font-semibold ${a.uncovered.length ? "text-warn-ink" : "text-ok-ink"}`}>
              {covered}/{toEat} repas couverts
            </span>
          )}
        </div>
        {selected.length === 0 ? (
          <p className="text-[15px] text-ink-2">Choisis 1 à 3 recettes dans la liste plus bas : je calcule les quantités et je répartis les repas de chacun. Ou laisse-moi tout proposer.</p>
        ) : (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className={`h-full rounded-full ${a.uncovered.length ? "bg-warn" : "bg-ok"}`} style={{ width: `${toEat ? Math.round((covered / toEat) * 100) : 0}%` }} />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {selected.map((r) => {
                const served = servedOf(r.slug);
                const frozenN = frozenOf(r.slug);
                return (
                  <li key={r.slug} className="flex min-w-0 items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-2.5">
                    <RecipeTile color={recipeColor(r.slug)} name={r.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/recettes/${r.slug}`} className="block truncate font-semibold hover:text-accent">
                        {r.name}
                      </Link>
                      <p className={`text-[13px] ${served ? "text-ink-2" : "font-semibold text-warn-ink"}`}>
                        {served ? `${served} repas${frozenN ? ` dont ${frozenN} au congélo` : ""}` : "ne sert à aucun repas"}
                      </p>
                    </div>
                    <form action={removeAction}>
                      <input type="hidden" name="w" value={w} />
                      <input type="hidden" name="slug" value={r.slug} />
                      {f && <input type="hidden" name="f" value={f} />}
                      <PendingButton variant="quiet" icon="x" iconOnly label={`Retirer ${r.name}`} title="Retirer" />
                    </form>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(selected.length === 0 || (a.uncovered.length > 0 && selected.length < 4)) && (
            <form action={proposeAction}>
              <input type="hidden" name="w" value={w} />
              <SubmitButton pendingText="Je complète…" icon="sparkdraft" variant={selected.length ? "soft" : "solid"}>
                {selected.length ? "Compléter pour moi" : "Propose-moi la semaine"}
              </SubmitButton>
            </form>
          )}
          {selected.length > 0 && (
            <form action={clearAction}>
              <input type="hidden" name="w" value={w} />
              <PendingButton variant="quiet" size="md" loadingLabel="J'efface…">
                Tout effacer
              </PendingButton>
            </form>
          )}
        </div>
      </Card>

      {selected.length > 0 && (
        <section className="grid gap-3" aria-label="Résumé">
          <MacroRow>
            <Macro value={`${covered}/${toEat}`} sub="repas couverts" tone={a.uncovered.length ? "warn" : "ok"} />
            <Macro value={minutes != null ? fmtMin(minutes) : "—"} sub="en cuisine" icon="clock" />
            <Macro value={selected.length} sub={selected.length > 1 ? "recettes" : "recette"} />
          </MacroRow>
          {a.uncovered.length > 0 && (
            <Alert tone="warn" title={a.uncovered.length === 1 ? "Il manque 1 repas" : `Il manque ${a.uncovered.length} repas`}>
              {selected.length >= 4
                ? "Quatre recettes, même en double quantité, ne couvrent pas tout : prévois ces repas à part, ou retire des absences."
                : "Ajoute une recette, ou « Compléter pour moi »."}{" "}
              <span className="text-ink-2">({a.uncovered.map((s) => `${dayName(s.day)} ${MEAL_LABEL[s.meal]} ${initial(s.personId)}`).join(", ")})</span>
            </Alert>
          )}
          {offTarget.length > 0 && (
            <Alert tone="warn" title="Quantités pas tout à fait calées">
              {offTarget.join(" · ")}.
            </Alert>
          )}
          {est?.conflicts.map((c, i) => (
            <Alert key={i} tone="warn" icon={/four/i.test(c.message) ? "oven" : "pot"}>
              {c.message} <span className="num">(+{fmtMin(c.extraMin)})</span>
            </Alert>
          ))}
          {toSetup.map((e) => (
            <Alert key={e.id} tone="warn" title={`Part de ${e.name} : à la taille habituelle`}>
              Il manque {joinFr(e.missing)} pour caler sa part sur sa cible.{" "}
              <Link href={`/sante/demarrer?p=${e.id}`} className="font-semibold text-accent hover:underline">
                Compléter le profil de {e.name}
              </Link>
            </Alert>
          ))}
          <TastesNote rules={tastes.rules} dislikes={tastes.dislikes} names={names} recipeNames={recipeNames} selected={slugs} />
          <Card pad="md" className="grid gap-3" aria-labelledby="liste-titre">
            <h2 id="liste-titre" className="text-[18px] font-bold">
              Courses
            </h2>
            {view.list && <WeekListStatus list={view.list} />}
            <div className="flex flex-wrap items-center gap-2">
              <form action={weekListAction}>
                <input type="hidden" name="w" value={w} />
                <SubmitButton pendingText="Je prépare la liste…" icon="basket" variant={view.list && !view.list.changed ? "soft" : "solid"}>
                  {view.list ? "Refaire la liste de courses" : "Faire la liste de courses"}
                </SubmitButton>
              </form>
            </div>
          </Card>
        </section>
      )}

      <section className="grid gap-3" aria-labelledby="biblio-titre">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="biblio-titre" className="text-[18px] font-bold">
            Recettes
          </h2>
          <span className="text-[13px] text-ink-2">{selected.length >= 4 ? "4 recettes au plus" : "un tap pour ajouter"}</span>
        </div>
        <Chips scroll>
          {FILTERS.map((x) => (
            <ChipLink key={x.id} href={`/semaine?w=${w}${x.id === "tout" ? "" : `&f=${encodeURIComponent(x.id)}`}#biblio-titre`} active={x.id === filter.id} scroll={false}>
              {x.label}
            </ChipLink>
          ))}
        </Chips>
        <ul className="grid gap-2 sm:grid-cols-2">
          {shelf.map(({ r, est: e }) => {
            const on = chosen.has(r.slug);
            const tags = [r.tags.includes("one pot") ? "one pot" : null, `${fmtMin(e.activeMin)} actif`, r.freezerOk ? "congèle" : null, r.status === "liked" ? "aimée" : "à essayer"].filter(Boolean);
            return (
              <li key={r.slug}>
                <form action={on ? removeAction : addAction} className={`flex min-w-0 items-center gap-3 rounded-[12px] border px-3 py-2.5 ${on ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}>
                  <input type="hidden" name="w" value={w} />
                  <input type="hidden" name="slug" value={r.slug} />
                  {f && <input type="hidden" name="f" value={f} />}
                  <RecipeTile color={recipeColor(r.slug)} name={r.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/recettes/${r.slug}`} className="block truncate font-semibold hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="truncate text-[13px] text-ink-2">{tags.join(" · ")}</p>
                  </div>
                  {(on || selected.length < 4) && (
                    <PendingButton variant={on ? "primary" : "secondary"} icon={on ? "check" : "plus"} iconOnly label={on ? `Retirer ${r.name}` : `Ajouter ${r.name}`} title={on ? "Retirer" : "Ajouter"} />
                  )}
                </form>
              </li>
            );
          })}
        </ul>
        {shelf.length === 0 && <p className="text-[14px] text-ink-2">Aucune recette dans ce filtre.</p>}
      </section>

      <details className="group rounded-[14px] border border-line bg-surface px-4 py-3">
        <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-2 font-semibold">
          <span>Absences et détail de la semaine</span>
          <Icon name="chev" className="transition-transform group-open:rotate-90" />
        </summary>
        <div className="mt-3 grid gap-5">
          <section className="grid gap-2" aria-label="Présence de la semaine">
            <p className="text-[14px] text-ink-2">Par défaut, tout le monde mange à tous les repas. Un tap sur une pastille pour dire qui est absent : les quantités et les repas se recalent.</p>
            <p className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2 sm:flex">
              <span className="inline-flex items-center gap-1">
                <Icon name="home" size="s" /> maison
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="brief" size="s" /> bureau (repas emporté)
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="dash" size="s" /> absent
              </span>
            </p>
            <WeekGrid cells={cells} days={pdays} proposed={selected.length > 0} />
          </section>

          {selected.length > 0 && <MenuBoard title={periodLabel(w, N)} days={board} ready={ready} />}

          {selected.length > 0 && (
            <section className="grid gap-3" aria-label="Quantités">
              <h3 className="font-bold">Quantités à cuire</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {a.recipes.map((rp) => {
                  const r = bySlug.get(rp.slug)!;
                  const factor = r.factor ?? 1;
                  const ctl = (fx: number): Control | null => (fx === factor ? null : { action: factorAction, fields: { w, slug: rp.slug, factor: String(fx) }, to: fx });
                  const added = view.extraLines.filter((x) => x.slug === rp.slug);
                  return (
                    <li key={rp.slug} className="grid gap-2 rounded-[12px] border border-line p-3">
                      <b className="truncate">{r.name}</b>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <PartMacros kcalUnit={r.kcalUnit} proteinUnit={r.proteinUnit} eaters={eaters} />
                        <FactorStepper name={r.name} factor={factor} units={unitsOf(r)} dec={ctl(stepFactor(factor, -1))} inc={ctl(stepFactor(factor, 1))} />
                      </div>
                      <p className="num text-[13px] text-ink-2">
                        {rp.unitsUsed} u mangées · {rp.unitsLeft > 0 ? `reste ${rp.unitsLeft} u${r.freezerOk ? " (congélo)" : ""}` : "rien ne reste"} · frigo J+{r.fridgeDays ?? 3}
                      </p>
                      {added.map((x) => (
                        <form key={x.ingredientId} action={extraAction}>
                          <Alert tone="ok" icon="leaf" className="!py-2 text-[14px]" action={<PendingButton variant="quiet" className="!text-ok-ink">Retirer</PendingButton>}>
                            +{fmtG(x.grams)} {x.item.split(/[,(]/)[0].toLowerCase()} pour finir le paquet
                          </Alert>
                          <input type="hidden" name="w" value={w} />
                          <input type="hidden" name="slug" value={rp.slug} />
                          <input type="hidden" name="ingredientId" value={x.ingredientId} />
                          <input type="hidden" name="grams" value="0" />
                        </form>
                      ))}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[13px] text-ink-2">
                Les quantités se calent toutes seules sur les repas (jusqu&apos;au double de la fiche) ; − / + pour forcer. La part de chacun suit sa cible : (cible du jour − hors batch) ÷ 2, au demi près. Au-delà du frigo, congélateur (<Icon name="snow" size={13} className="inline align-[-2px]" label="congélateur" />) si la recette le supporte.
              </p>
            </section>
          )}

          {nutrition && <WeekNutrition people={nutrition} stack letters={pdays.map((d) => d.letter)} />}

          {selected.length > 0 && (
            <Suspense key={JSON.stringify(selection)} fallback={<LeftoversSkeleton />}>
              <Leftovers sel={selection} mode={{ kind: "week", w }} />
            </Suspense>
          )}
          {selected.length > 0 && (
            <Link href={composerHref({ slugs, scales, extras })} className="inline-flex min-h-tap items-center gap-1 text-[14px] font-semibold text-accent hover:underline">
              Ouvrir dans le Composer <PendingMark idle={<Icon name="chev" size="s" />} />
            </Link>
          )}
        </div>
      </details>
    </div>
  );
}

type Filter = { id: string; label: string; match: (r: { tags: string[]; freezerOk: boolean; status?: string }, activeMin: number) => boolean };
const FILTERS: Filter[] = [
  { id: "tout", label: "Tout", match: () => true },
  { id: "one pot", label: "One pot", match: (r) => r.tags.includes("one pot") },
  { id: "rapide", label: "Rapide", match: (r, m) => r.tags.includes("rapide") || m <= 40 },
  { id: "four", label: "Four", match: (r) => r.tags.includes("four") },
  { id: "congele", label: "Congèle", match: (r) => r.freezerOk },
  { id: "aimees", label: "Aimées", match: (r) => r.status === "liked" },
  { id: "essayer", label: "À essayer", match: (r) => r.status !== "liked" },
];

function flashText(done: string | undefined, bySlug: Map<string, { name: string }>): string | null {
  if (!done) return null;
  const name = (s: string) => bySlug.get(s)?.name ?? s;
  const [kind, a = "", b = ""] = done.split(":");
  if (kind === "propose") {
    const s = a.split(",").filter(Boolean);
    return s.length ? `Semaine proposée : ${s.map(name).join(", ")}.` : "Personne ne mange à la maison ou au bureau : rien à proposer.";
  }
  if (kind === "swap") return b ? `${name(b)} remplace ${name(a)}.` : `Pas d'autre recette pour remplacer ${name(a)}.`;
  if (kind === "clear") return "Proposition effacée.";
  if (kind === "period") return `Période réglée : ${a} jour${Number(a) > 1 ? "s" : ""}. Les quantités se sont recalées.`;
  if (kind === "add") return `${name(a)} ajoutée à la semaine.`;
  if (kind === "remove") return `${name(a)} retirée de la semaine.`;
  if (kind === "extra") return `${fmtG(Number(b))} ajoutés à ${name(a)} : le paquet est fini.`;
  if (kind === "unextra") return `Grammes ajoutés retirés de ${name(a)}.`;
  return null;
}

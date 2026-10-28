import Link from "next/link";
import { Suspense } from "react";
import { Alert, buttonClass, Card, EmptyState, Icon, Macro, MacroRow, RecipeTile, StampSemainePrete, Tape } from "@/components/ui";
import { db } from "@/lib/db/client";
import { addDays, COOK_DAY, DAYS, daysAfterSession, defaultWeek, isWeekStart, MEAL_LABEL, stepFactor, unitsOf, type Meal } from "@/lib/week/propose";
import { weekView } from "@/lib/week/store";
import { composerHref } from "@/lib/week/selection";
import { joinFr } from "@/lib/week/tastes";
import { estimateSession } from "@/lib/session/estimate";
import { buildPlan } from "@/lib/session/store";
import { FactorStepper, type Control } from "@/components/semaine/FactorStepper";
import { Leftovers, LeftoversSkeleton } from "@/components/semaine/Leftovers";
import { TastesNote } from "@/components/semaine/Tastes";
import { WeekListStatus } from "@/components/semaine/WeekListStatus";
import { PendingButton } from "@/components/semaine/PendingButton";
import { PartMacros } from "@/components/semaine/PartMacros";
import { WeekGrid, type GridCell } from "@/components/semaine/WeekGrid";
import { MenuBoard, type BoardDay } from "@/components/semaine/MenuBoard";
import { fmtG } from "@/components/semaine/format";
import { recipeColor } from "@/lib/ui";
import { WeekNutrition } from "@/components/WeekNutrition";
import { dayRefOf, weekNutrition } from "@/lib/week/nutrition";
import { SubmitButton } from "@/components/SubmitButton";
import { PendingMark } from "@/components/PendingMark";
import { clearAction, extraAction, factorAction, proposeAction, removeAction, swapAction, weekListAction } from "./actions";

export const dynamic = "force-dynamic";

const MEALS: Meal[] = ["lunch", "dinner"];
const fmtMin = (m: number) => {
  const r = Math.round(m / 5) * 5;
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};
const dayNum = (w: string, d: number) => Number(addDays(w, d).split("-")[2]);
const longDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const titleDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

export default async function Semaine({ searchParams }: { searchParams: Promise<{ w?: string; done?: string }> }) {
  const { w: wParam, done } = await searchParams;
  const w = isWeekStart(wParam) ? wParam : defaultWeek(new Date());
  const view = weekView(db, w);
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
  const outside = new Map(eaters.filter((e) => e.outside).map((e) => [e.id, e.outside!]));
  const nutrition = selected.length
    ? weekNutrition(
        grid,
        [...bySlug.values()], // grammes ajoutés : macros recalculées des recettes retenues
        people.map((p) => p.id),
        outside
      ).map((wk) => {
        const e = eaterOf.get(wk.personId);
        return { id: wk.personId, name: people.find((p) => p.id === wk.personId)?.name ?? wk.personId, week: wk, ref: e ? dayRefOf(e) : null };
      })
    : null;
  const toSetup = eaters.filter((e) => e.missing.length > 0 && e.source !== "fixe");
  const eatenUnits = a.recipes.reduce((s, r) => s + r.unitsUsed, 0) + a.uncovered.reduce((s, x) => s + x.portionUnits, 0);

  // Cases de la grille (une par jour et repas), pour le composant client.
  const cells: GridCell[] = DAYS.flatMap((_, day) =>
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
  const board: BoardDay[] = DAYS.map((_, day) => {
    const at = (meal: Meal) => cells.find((c) => c.day === day && c.meal === meal)?.dishes.map((d) => ({ name: d.name, color: d.color })) ?? [];
    return { label: `${DAYS[day].slice(0, 3)}.`, lunch: at("lunch"), dinner: at("dinner") };
  });
  const ready = selected.length > 0 && a.uncovered.length === 0 && !!view.list?.ordered && !view.list.changed;
  const toCover = cells.filter((c) => c.slots.some((s) => s.place !== "away")).length;
  const awayNote = people
    .map((p) => {
      const away = DAYS.map((_, d) => MEALS.every((m) => cell(d, m, p.id)?.place === "away")).map((x, d) => (x ? d : -1)).filter((d) => d >= 0);
      if (!away.length || away.length === 7) return null;
      return `${p.name} : absence ${away.length === 1 ? `le ${DAYS[away[0]]}` : `${away.length} jours`}`;
    })
    .filter(Boolean);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Semaine du {titleDate(w)}</h1>
            {ready && <StampSemainePrete seed={w} size={118} className="-my-3" />}
          </div>
          <p className="mt-1.5 text-ink-2">
            <span className="num">{toCover}</span> repas à couvrir · session le {longDate(addDays(w, COOK_DAY))}
            {awayNote.length > 0 && ` · ${awayNote.join(", ")}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex items-center gap-1" aria-label="Changer de semaine">
            <Link href={`/semaine?w=${addDays(w, -7)}`} className={buttonClass({ iconOnly: true })} aria-label="Semaine précédente">
              <PendingMark idle={<Icon name="chev" className="rotate-180" />} />
            </Link>
            <Link href={`/semaine?w=${addDays(w, 7)}`} className={buttonClass({ iconOnly: true })} aria-label="Semaine suivante">
              <PendingMark idle={<Icon name="chev" />} />
            </Link>
          </nav>
          {selected.length > 0 && (
            <form action={clearAction}>
              <input type="hidden" name="w" value={w} />
              <PendingButton variant="quiet" size="md" loadingLabel="J'efface…">
                Effacer
              </PendingButton>
            </form>
          )}
          <form action={proposeAction}>
            <input type="hidden" name="w" value={w} />
            <SubmitButton pendingText="Je compose la semaine…" icon="sparkdraft">
              {selected.length ? "Repropose la semaine" : "Propose la semaine"}
            </SubmitButton>
          </form>
        </div>
      </div>

      {flash && (
        <Alert key={done} tone="ok" role="status" className="animate-pop">
          {flash}
        </Alert>
      )}

      <section className="grid gap-2" aria-label="Présence de la semaine">
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
          <span className="text-faint">· un tap sur une pastille pour changer</span>
        </p>
        <WeekGrid cells={cells} dates={DAYS.map((_, d) => dayNum(w, d))} proposed={selected.length > 0} />
      </section>

      {selected.length > 0 && <MenuBoard title={`semaine du ${titleDate(w)}`} days={board} ready={ready} />}

      {selected.length > 0 && (
        <Card pad="md" className="grid gap-3">
          <MacroRow>
            <Macro value={eatenUnits.toLocaleString("fr-FR")} unit="u" sub="à manger" />
            <Macro value={cooked} unit="u" sub={`cuites · ${selected.length} recette${selected.length > 1 ? "s" : ""}`} tone={cooked >= eatenUnits ? "ok" : "warn"} />
            <Macro value={plan ? fmtMin(plan.totalMin) : est ? fmtMin(est.totalMin) : "—"} sub="de session, seul" icon="clock" />
          </MacroRow>
          <p className="text-[13px] text-ink-2">
            La part de chacun suit sa cible : (cible du jour − ce qu&apos;il mange hors batch) ÷ 2, divisée par les kcal d&apos;une unité de la recette, au demi près (entre 60 et 160 % de sa part habituelle). Session le dimanche d&apos;avant : frigo jusqu&apos;à J+fridge_days, au-delà congélateur (<Icon name="snow" size={13} className="inline align-[-2px]" label="congélateur" />) si la recette le supporte.
          </p>
        </Card>
      )}

      {toSetup.map((e) => (
        <Alert key={e.id} tone="warn" title={`Part de ${e.name} : ${e.ref ? "à affiner" : "à la taille habituelle"}`}>
          Il manque {joinFr(e.missing)} pour calculer sa part depuis sa cible.{" "}
          <Link href={`/sante/demarrer?p=${e.id}`} className="font-semibold text-accent hover:underline">
            Compléter le profil de {e.name}
          </Link>
        </Alert>
      ))}

      {selected.length > 0 && a.uncovered.length > 0 && (
        <Alert tone="warn" title={a.uncovered.length === 1 ? "1 part n'est pas couverte" : `${a.uncovered.length} parts ne sont pas couvertes`}>
          {a.uncovered.map((s) => `${DAYS[s.day]} ${MEAL_LABEL[s.meal]} ${initial(s.personId)}`).join(", ")}. À prévoir à part (restes, plat minute), ou ajoute des unités à une recette.
        </Alert>
      )}
      {est?.conflicts.map((c, i) => (
        <Alert key={i} tone="warn" icon={/four/i.test(c.message) ? "oven" : "pot"}>
          {c.message} <span className="num">(+{fmtMin(c.extraMin)})</span>
        </Alert>
      ))}
      <TastesNote rules={tastes.rules} dislikes={tastes.dislikes} names={names} recipeNames={recipeNames} selected={slugs} />

      {selected.length === 0 ? (
        <Card flat>
          <EmptyState scene="fridge" title="Pas encore de recettes cette semaine">
            Règle qui mange où, puis « Propose la semaine » : je choisis 2 à 4 recettes de la bibliothèque qui couvrent les repas, se gardent assez longtemps, varient la protéine et évitent les conflits d&apos;équipement.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <section id="recettes" className="grid scroll-mt-20 gap-2.5" aria-labelledby="retenues-titre">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="retenues-titre" className="text-[18px] font-bold">
                Recettes retenues
              </h2>
              <Link href={composerHref({ slugs, scales, extras })} className="inline-flex min-h-tap items-center gap-1 text-[14px] font-semibold text-accent hover:underline">
                Ouvrir dans le Composer <PendingMark idle={<Icon name="chev" size="s" />} />
              </Link>
            </div>
            <ul className="grid gap-3 sm:max-lg:grid-cols-2">
              {a.recipes.map((rp) => {
                const r = bySlug.get(rp.slug)!;
                const factor = r.factor ?? 1;
                const ctl = (f: number): Control | null => (f === factor ? null : { action: factorAction, fields: { w, slug: rp.slug, factor: String(f) }, to: f });
                const notFor = [...(tastes.dislikes.get(rp.slug) ?? new Map<string, string[]>())];
                const added = view.extraLines.filter((x) => x.slug === rp.slug);
                const meals = [...rp.meals].sort((x, y) => x.day - y.day || (x.meal === y.meal ? 0 : x.meal === "lunch" ? -1 : 1));
                const span = meals.length ? `${meals.length} repas · ${DAYS[meals[0].day]} ${MEAL_LABEL[meals[0].meal]}${meals.length > 1 ? ` → ${DAYS[meals[meals.length - 1].day]} ${MEAL_LABEL[meals[meals.length - 1].meal]}` : ""}` : "ne sert à aucun repas";
                return (
                  <li key={rp.slug} className="min-w-0">
                    <Card as="article" pad="sm" className="grid animate-pop gap-3">
                      <div className="flex items-start gap-3">
                        <RecipeTile color={recipeColor(rp.slug)} name={r.name} />
                        <div className="min-w-0 flex-1">
                          <Link href={`/recettes/${rp.slug}`} className="block font-display text-[17px] font-bold leading-[1.2] hover:text-accent">
                            {r.name}
                          </Link>
                          <p className={`mt-0.5 text-[13px] ${meals.length ? "text-ink-2" : "font-semibold text-warn-ink"}`}>{span}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <form action={swapAction}>
                            <input type="hidden" name="w" value={w} />
                            <input type="hidden" name="slug" value={rp.slug} />
                            <input type="hidden" name="current" value={slugs.join(",")} />
                            <PendingButton icon="swap" title={`Échanger ${r.name}`} loadingLabel="…">
                              Échanger
                            </PendingButton>
                          </form>
                          <form action={removeAction}>
                            <input type="hidden" name="w" value={w} />
                            <input type="hidden" name="slug" value={rp.slug} />
                            <PendingButton variant="quiet" icon="x" iconOnly label={`Retirer ${r.name} de la semaine`} title="Retirer de la semaine" />
                          </form>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <PartMacros kcalUnit={r.kcalUnit} proteinUnit={r.proteinUnit} eaters={eaters} />
                        <FactorStepper name={r.name} factor={factor} units={unitsOf(r)} dec={ctl(stepFactor(factor, -1))} inc={ctl(stepFactor(factor, 1))} />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-2">
                        <span className="num">{rp.unitsUsed} u mangées</span>
                        <span className="num">{rp.unitsLeft > 0 ? `reste ${rp.unitsLeft} u${r.freezerOk ? " (congélo)" : ""}` : "rien ne reste"}</span>
                        <span className="inline-flex items-center gap-[5px]">
                          <Icon name="fridge" size="s" />
                          frigo J+{r.fridgeDays ?? 3}
                        </span>
                        {r.freezerOk && (
                          <span className="inline-flex items-center gap-[5px]">
                            <Icon name="snow" size="s" />
                            congèle
                          </span>
                        )}
                        <span className="num">fiche {r.servingsUnits} u</span>
                      </div>
                      {added.map((x) => (
                        <form key={x.ingredientId} action={extraAction}>
                          <Alert tone="ok" icon="leaf" className="!py-2 text-[14px]" action={<PendingButton variant="quiet" className="!text-ok-ink">Retirer</PendingButton>}>
                            +{fmtG(x.grams)} {x.item.split(/[,(]/)[0].toLowerCase()} pour finir le paquet (part recalculée)
                          </Alert>
                          <input type="hidden" name="w" value={w} />
                          <input type="hidden" name="slug" value={rp.slug} />
                          <input type="hidden" name="ingredientId" value={x.ingredientId} />
                          <input type="hidden" name="grams" value="0" />
                        </form>
                      ))}
                      {notFor.length > 0 && (
                        <p className="flex items-start gap-1.5 text-[13px] text-warn-ink">
                          <Icon name="alert" size="s" className="mt-px shrink-0" />
                          {notFor.map(([who, what]) => `Jamais pour ${names[who] ?? who} (${joinFr(what)})`).join(" · ")}
                        </p>
                      )}
                      {meals.length > 0 && (
                        <ul className="flex flex-wrap gap-2 pt-0.5">
                          {meals.map((m) => (
                            <li key={`${m.day}${m.meal}${m.personIds.join()}`}>
                              <Tape tint={m.frozen ? "var(--c-accent)" : recipeColor(rp.slug)} seed={`${rp.slug}${m.day}${m.meal}`} className="!text-[17px]">
                                <span className="inline-flex items-center gap-1">
                                  {m.frozen && <Icon name="snow" size={13} label="congelé" />}
                                  {DAYS[m.day]} {MEAL_LABEL[m.meal]} · {m.personIds.map(initial).join("+")}
                                  <span className="sr-only"> (J+{daysAfterSession(m.day)})</span>
                                </span>
                              </Tape>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>

          {nutrition && <WeekNutrition people={nutrition} stack />}
        </div>
      )}

      {selected.length > 0 && (
        <Suspense key={JSON.stringify(selection)} fallback={<LeftoversSkeleton />}>
          <Leftovers sel={selection} mode={{ kind: "week", w }} />
        </Suspense>
      )}

      {selected.length > 0 && (
        <Card as="section" pad="md" className="grid gap-3" aria-labelledby="liste-titre">
          <h2 id="liste-titre" className="text-[18px] font-bold">
            Courses de la semaine
          </h2>
          {view.list && <WeekListStatus list={view.list} />}
          <div className="flex flex-wrap items-center gap-2">
            <form action={weekListAction}>
              <input type="hidden" name="w" value={w} />
              <SubmitButton pendingText="Je prépare la liste…" icon="basket" variant={view.list && !view.list.changed ? "soft" : "solid"}>
                {view.list ? "Refaire la liste de courses" : "Faire la liste de courses"}
              </SubmitButton>
            </form>
            <Link href={composerHref({ slugs, scales, extras })} className={buttonClass({ variant: "quiet" })}>
              <Icon name="pot" />
              Ouvrir dans le Composer <PendingMark />
            </Link>
          </div>
          <p className="text-[13px] text-ink-2">
            La liste suit les unités choisies (<span className="num">{cooked} u</span>) et les grammes ajoutés pour finir les paquets.
          </p>
        </Card>
      )}
    </div>
  );
}

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
  if (kind === "add") return `${name(a)} ajoutée à la semaine.`;
  if (kind === "remove") return `${name(a)} retirée de la semaine.`;
  if (kind === "extra") return `${fmtG(Number(b))} ajoutés à ${name(a)} : le paquet est fini.`;
  if (kind === "unextra") return `Grammes ajoutés retirés de ${name(a)}.`;
  return null;
}

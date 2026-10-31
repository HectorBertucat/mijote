import Link from "next/link";
import { Suspense } from "react";
import { buttonClass, Icon, Lanes, Scene } from "@/components/ui";
import { DishBox } from "@/components/ui/dish";
import { dishRecipes } from "@/components/semaine/dishes";
import type { ReactNode } from "react";
import { db } from "@/lib/db/client";
import { stepFactor, unitsOf } from "@/lib/week/propose";
import { composerHref, formatSelection, parseSelection, type Selection } from "@/lib/week/selection";
import { library as weekLibrary, loadIngredients, loadTastes } from "@/lib/week/store";
import { joinFr } from "@/lib/week/tastes";
import { scaledNutrition } from "@/lib/week/leftovers";
import { FactorStepper } from "@/components/semaine/FactorStepper";
import { Leftovers, LeftoversSkeleton } from "@/components/semaine/Leftovers";
import { PartMacros } from "@/components/semaine/PartMacros";
import { PendingButton } from "@/components/semaine/PendingButton";
import { PickLink } from "@/components/semaine/Pick";
import { Figures, Notice } from "@/components/semaine/Parts";
import { loadEaters } from "@/lib/eaters/store";
import { fmtG, fmtMin, plural } from "@/components/semaine/format";
import { planLanes } from "@/components/composer/planLanes";
import { listPeople, listRecipesWithSteps } from "@/lib/recipes/queries";
import { estimateSession, suggestPairings } from "@/lib/session/estimate";
import { createList } from "../courses/actions";
import { startSession } from "../session/actions";
import { ModePicker } from "@/components/session/ModePicker";
import { buildPlan } from "@/lib/session/store";
import type { SessionMode, SessionPlan } from "@/lib/session/planner";
import { PendingMark } from "@/components/PendingMark";

export const dynamic = "force-dynamic";

export default async function Composer({ searchParams }: { searchParams: Promise<{ r?: string; x?: string }> }) {
  const { r, x } = await searchParams;
  const all = listRecipesWithSteps(db);
  const eaters = loadEaters(db);
  const sel0 = parseSelection(r, x);
  const picked = sel0.slugs.filter((s) => all.some((y) => y.slug === s));
  // Grammes ajoutés : seulement ceux des recettes choisies.
  const ings = loadIngredients(db, picked.map((s) => all.find((y) => y.slug === s)!.id));
  const ingOwner = new Map([...ings].flatMap(([rid, list]) => list.map((i) => [i.id, rid] as const)));
  const sel: Selection = { slugs: picked, scales: sel0.scales, extras: Object.fromEntries(Object.entries(sel0.extras).filter(([id]) => ingOwner.has(id))) };
  const selected = picked
    .map((s) => all.find((y) => y.slug === s)!)
    .map((y) => {
      const factor = sel.scales[y.slug] ?? 1;
      const mine = Object.fromEntries(Object.entries(sel.extras).filter(([id]) => ingOwner.get(id) === y.id));
      if (!Object.keys(mine).length) return { ...y, factor, extras: mine };
      const n = scaledNutrition(ings.get(y.id) ?? [], y.servingsUnits, factor, mine);
      return { ...y, factor, extras: mine, kcalUnit: n.perUnit.kcal, proteinUnit: n.perUnit.protein };
    });
  const est = selected.length ? estimateSession(selected) : null;
  const pairings = suggestPairings(selected, all, 4);
  const bySlug = new Map(all.map((y) => [y.slug, y]));
  // La boîte de chaque plat, dessinée à partir de ses ingrédients (et de ses étapes).
  const boxes = dishRecipes(db, all);
  const box = (slug: string) => {
    const d = boxes.get(slug);
    return d ? <DishBox recipe={d} size="sm" /> : null;
  };
  const tastes = loadTastes(db, weekLibrary(db));
  const names: Record<string, string> = Object.fromEntries(listPeople(db).map((p) => [p.id, p.name]));

  const toggle = (slug: string) => composerHref(picked.includes(slug) ? { ...sel, slugs: picked.filter((s) => s !== slug) } : { ...sel, slugs: [...picked, slug] });
  const withFactor = (slug: string, f: number) => composerHref({ ...sel, scales: { ...sel.scales, [slug]: f } });
  const extraLines = Object.entries(sel.extras).map(([id, g]) => {
    const rid = ingOwner.get(id)!;
    return { id, g, recipe: all.find((y) => y.id === rid)!, item: (ings.get(rid) ?? []).find((i) => i.id === id)?.item ?? "?" };
  });
  // Durée prévue par le planificateur pour chaque mode, aux unités choisies (déterministe, quelques ms).
  const plans: Partial<Record<SessionMode, SessionPlan>> = {};
  if (selected.length) for (const m of ["solo", "duo", "veille"] as const) plans[m] = buildPlan(db, { slugs: picked, scales: sel.scales, extras: sel.extras, mode: m });
  const lanes = plans.solo ? planLanes(plans.solo) : null;
  const form = formatSelection(sel);
  const conflicts = est && !plans.solo?.decisions?.length ? est.conflicts : [];
  const notices = (plans.solo?.decisions?.length ?? 0) + (plans.solo?.errors.length ?? 0) + conflicts.length;

  const liked = all.filter((x) => x.status === "liked");
  const toTry = all.filter((x) => x.status !== "liked");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)]">
      <header className="max-w-[60rem]">
        <h1 className="text-display">Composer une session</h1>
        <p className="mt-4 max-w-[46ch] text-lead text-ink">Choisis 2 à 4&nbsp;plats, sans semaine ni repas&nbsp;: je dis combien de temps ça prend, ce qui coince au four et ce qui va avec.</p>
        <p className="mt-2 text-small text-ink-2">{selected.length ? `${plural(selected.length, "plat choisi", "plats choisis")} sur ${all.length}` : `${plural(all.length, "plat")} dans la bibliothèque`}</p>
      </header>

      <div className="mt-12 grid gap-12 lg:mt-18 lg:grid-cols-12 lg:gap-6">
        {/* Sélection : toute la bibliothèque, cochée ou non. */}
        <section className="order-last grid min-w-0 content-start gap-6 lg:order-first lg:col-span-4" aria-labelledby="plats-titre">
          <h2 id="plats-titre" className="text-h2">
            Les plats
          </h2>
          <Group title="Aimés" items={liked} picked={picked} toggle={toggle} box={box} />
          <Group title="À essayer" items={toTry} picked={picked} toggle={toggle} box={box} />
        </section>

        <div className="grid min-w-0 content-start gap-12 lg:col-span-8 lg:gap-18">
          {selected.length === 0 ? (
            <section className="grid max-w-[40ch] justify-items-start gap-4">
              <Scene name="pot" />
              <h2 className="text-h2">Aucun plat choisi</h2>
              <p className="text-body text-ink-2">Commence par un plat dont tu as envie&nbsp;: je dirai la durée, les conflits d’équipement et ce qui va avec.</p>
            </section>
          ) : (
            <>
              <section className="grid gap-8" aria-label="Résumé de la session">
                {est && (
                  <Figures
                    items={[
                      { value: fmtMin(plans.solo?.totalMin ?? est.totalMin), label: "de session, seul" },
                      { value: fmtMin(plans.solo?.activeMin ?? est.activeMin), label: "à faire vraiment" },
                      { value: est.fridgeDays != null ? `J+${est.fridgeDays}` : "?", label: "au frigo" },
                    ]}
                  />
                )}
                {lanes && lanes.lanes.length > 0 && (
                  <div className="hidden gap-3 sm:grid">
                    <Lanes lanes={lanes.lanes} total={lanes.total} />
                    <p className="text-small text-ink-3">Seul&nbsp;: la prep sur la planche, puis la cuisson. Survole une barre pour l’étape&nbsp;; cernée de rouge, un conflit.</p>
                  </div>
                )}
                {notices > 0 && (
                  <ul className="border-b border-line">
                    {plans.solo?.decisions?.map((d) => (
                      <Notice key={d} icon="sparkdraft" tone="info">
                        {d}
                      </Notice>
                    ))}
                    {plans.solo?.errors.map((e, i) => (
                      <Notice key={`e${i}`} icon={e.kind === "oven_temp" ? "oven" : "pot"} tone="ko">
                        {e.message}
                      </Notice>
                    ))}
                    {conflicts.map((c, i) => (
                      <Notice key={`c${i}`} icon={/four/i.test(c.message) ? "oven" : "pot"}>
                        {c.message} <span className="num whitespace-nowrap text-ink-2">+{fmtMin(c.extraMin)} sur la session</span>
                      </Notice>
                    ))}
                  </ul>
                )}
              </section>

              <section className="grid gap-6" aria-labelledby="session-titre">
                <h2 id="session-titre" className="text-h2">
                  Lancer la session
                </h2>
                <form action={startSession} className="grid gap-6">
                  <input type="hidden" name="r" value={form.r} />
                  <input type="hidden" name="x" value={form.x} />
                  <ModePicker plans={plans} />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <PendingButton variant="accent" size="md" loadingLabel="Je planifie la session…">
                      Lancer la session
                    </PendingButton>
                    {/* Pour montrer l'appli : même session (téléphone, à deux…), rien n'est compté. */}
                    <button type="submit" name="test" value="1" className="min-h-tap text-small text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                      ou une session test, rien n’est compté
                    </button>
                  </div>
                </form>
                <form action={createList} className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
                  <input type="hidden" name="r" value={form.r} />
                  <input type="hidden" name="x" value={form.x} />
                  <p className="min-w-0 flex-1 basis-[16rem] text-small text-ink-2">Pas encore les ingrédients&nbsp;? La liste reprend ces plats, aux unités choisies.</p>
                  <PendingButton icon="basket" size="md" loadingLabel="Je fais la liste…">
                    Faire la liste de courses
                  </PendingButton>
                </form>
              </section>

              <section className="grid gap-6" aria-labelledby="choisies-titre">
                <h2 id="choisies-titre" className="text-h2">
                  Unités à cuire
                </h2>
                <ul className="border-b border-line">
                  {selected.map((y) => {
                    const f = y.factor;
                    const notFor = [...(tastes.dislikes.get(y.slug) ?? new Map<string, string[]>())];
                    const dec = stepFactor(f, -1);
                    const inc = stepFactor(f, 1);
                    return (
                      <li key={y.slug} className="grid gap-4 border-t border-line py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                        <div className="flex min-w-0 items-start gap-4">
                          {box(y.slug)}
                          <div className="grid min-w-0 flex-1 gap-2">
                            <Link href={`/recettes/${y.slug}`} className="font-bold leading-[1.25] underline-offset-4 hover:underline">
                              {y.name}
                            </Link>
                            <PartMacros kcalUnit={y.kcalUnit} proteinUnit={y.proteinUnit} eaters={eaters} size="sm" />
                            {notFor.length > 0 && (
                              <p className="flex items-start gap-2 text-small text-warn-ink">
                                <Icon name="alert" size="s" className="mt-[3px] shrink-0" />
                                {notFor.map(([who, what]) => `${names[who] ?? who} n’aime pas : ${joinFr(what)}`).join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 pl-18 sm:pl-0">
                          <span className="text-small text-ink-2">fiche {y.servingsUnits}&nbsp;u</span>
                          <FactorStepper name={y.name} factor={f} units={unitsOf(y)} dec={dec === f ? null : { href: withFactor(y.slug, dec), to: dec }} inc={inc === f ? null : { href: withFactor(y.slug, inc), to: inc }} />
                          <Link href={toggle(y.slug)} scroll={false} className={buttonClass({ variant: "quiet", iconOnly: true })} aria-label={`Retirer ${y.name}`} title="Retirer">
                            <PendingMark idle={<Icon name="x" />} />
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                  {extraLines.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-4 text-small">
                      <Icon name="leaf" size="s" className="text-ink-2" />
                      <span className="min-w-0 flex-1">
                        {e.recipe.name}&nbsp;: +{fmtG(e.g)} {e.item.split(/[,(]/)[0].toLowerCase()} pour finir le paquet (part recalculée)
                      </span>
                      <Link href={composerHref({ ...sel, extras: Object.fromEntries(Object.entries(sel.extras).filter(([id]) => id !== e.id)) })} scroll={false} className={buttonClass({ variant: "quiet", size: "sm" })}>
                        Retirer
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>

              <Suspense key={composerHref(sel)} fallback={<LeftoversSkeleton />}>
                <Leftovers sel={selected.map((y) => ({ slug: y.slug, factor: y.factor, extras: y.extras }))} mode={{ kind: "composer", selection: sel }} />
              </Suspense>
            </>
          )}

          {pairings.length > 0 && (
            <section className="grid gap-6" aria-labelledby="avec-titre">
              <h2 id="avec-titre" className="text-h2">
                Va bien avec
              </h2>
              <ul className="border-b border-line">
                {pairings.map((p) => {
                  const y = bySlug.get(p.slug)!;
                  return (
                    <li key={p.slug} className="flex min-w-0 items-center gap-4 border-t border-line py-4">
                      {box(p.slug)}
                      <div className="grid min-w-0 flex-1 gap-1">
                        <span className="font-bold leading-[1.25]">{y.name}</span>
                        <span className="text-small text-ink-2">
                          {p.addedMin > 0 ? `+${fmtMin(p.addedMin)}` : "sans allonger la session"} · {p.reasons.slice(0, 2).join(" · ")}
                        </span>
                      </div>
                      <Link href={toggle(p.slug)} scroll={false} className={buttonClass({ size: "sm" })}>
                        <PendingMark idle={<Icon name="plus" size="s" />} />
                        Ajouter
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

type Item = { slug: string; name: string; tags: string[]; kcalUnit: number | null; proteinUnit: number | null };

function Group({ title, items, picked, toggle, box }: { title: string; items: Item[]; picked: string[]; toggle: (slug: string) => string; box: (slug: string) => ReactNode }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-3">
      <h3 className="label text-ink-3">{title}</h3>
      <ul className="grid gap-2 sm:max-lg:grid-cols-2">
        {items.map((y) => {
          const on = picked.includes(y.slug);
          const tags = y.tags.filter((t) => t !== "à relire" && t !== "indisponible").slice(0, 3);
          return (
            <li key={y.slug} className="min-w-0">
              <PickLink on={on} href={toggle(y.slug)} size="md" name={y.name} visual={box(y.slug)} facts={tags.join(" · ") || "—"} label={on ? `Retirer ${y.name}` : `Choisir ${y.name}`} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

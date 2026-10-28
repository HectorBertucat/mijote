import Link from "next/link";
import { Suspense } from "react";
import { Alert, buttonClass, Card, cardClass, EmptyState, Icon, Lanes, Macro, MacroRow, RecipeTile } from "@/components/ui";
import { db } from "@/lib/db/client";
import { stepFactor, unitsOf } from "@/lib/week/propose";
import { composerHref, formatSelection, parseSelection, type Selection } from "@/lib/week/selection";
import { library as weekLibrary, loadIngredients, loadTastes } from "@/lib/week/store";
import { joinFr } from "@/lib/week/tastes";
import { scaledNutrition } from "@/lib/week/leftovers";
import { FactorStepper } from "@/components/semaine/FactorStepper";
import { Leftovers, LeftoversSkeleton } from "@/components/semaine/Leftovers";
import { PartMacros } from "@/components/semaine/PartMacros";
import { loadEaters } from "@/lib/eaters/store";
import { fmtG } from "@/components/semaine/format";
import { planLanes } from "@/components/composer/planLanes";
import { listPeople, listRecipesWithSteps } from "@/lib/recipes/queries";
import { estimateSession, suggestPairings } from "@/lib/session/estimate";
import { recipeColor } from "@/lib/ui";
import { createList } from "../courses/actions";
import { startSession } from "../session/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ModePicker } from "@/components/session/ModePicker";
import { buildPlan } from "@/lib/session/store";
import type { SessionMode, SessionPlan } from "@/lib/session/planner";
import { PendingMark } from "@/components/PendingMark";

export const dynamic = "force-dynamic";

const fmt = (m: number) => {
  const r = Math.round(m / 5) * 5;
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};

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
  const tastes = loadTastes(db, weekLibrary(db));
  const names: Record<string, string> = Object.fromEntries(listPeople(db).map((p) => [p.id, p.name]));

  const toggle = (slug: string) => composerHref(picked.includes(slug) ? { ...sel, slugs: picked.filter((s) => s !== slug) } : { ...sel, slugs: [...picked, slug] });
  const withFactor = (slug: string, f: number) => composerHref({ ...sel, scales: { ...sel.scales, [slug]: f } });
  const units = selected.reduce((s, y) => s + unitsOf(y), 0);
  const extraLines = Object.entries(sel.extras).map(([id, g]) => {
    const rid = ingOwner.get(id)!;
    return { id, g, recipe: all.find((y) => y.id === rid)!, item: (ings.get(rid) ?? []).find((i) => i.id === id)?.item ?? "?" };
  });
  // Durée prévue par le planificateur pour chaque mode, aux unités choisies (déterministe, quelques ms).
  const plans: Partial<Record<SessionMode, SessionPlan>> = {};
  if (selected.length) for (const m of ["solo", "duo", "veille"] as const) plans[m] = buildPlan(db, { slugs: picked, scales: sel.scales, extras: sel.extras, mode: m });
  const lanes = plans.solo ? planLanes(plans.solo) : null;

  const liked = all.filter((x) => x.status === "liked");
  const toTry = all.filter((x) => x.status !== "liked");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Composer une session</h1>
          <p className="mt-1.5 text-ink-2">
            {selected.length === 0 ? "Choisis 2 à 4 recettes pour ta session." : `${selected.length} recette${selected.length > 1 ? "s" : ""} choisie${selected.length > 1 ? "s" : ""} sur ${all.length} · 2 à 4 par session`}
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Sélection : toute la bibliothèque, cochée ou non. */}
        <section className="order-last grid gap-2 lg:order-first" aria-label="Recettes">
          <Group title="Recettes aimées" items={liked} picked={picked} toggle={toggle} />
          <Group title="À essayer" items={toTry} picked={picked} toggle={toggle} />
        </section>

        <div className="grid min-w-0 gap-4">
          {selected.length === 0 ? (
            <Card flat>
              <EmptyState scene="pot" title="Aucune recette choisie">
                Commence par un plat dont tu as envie : je te dirai la durée, les conflits d&apos;équipement et ce qui va avec.
              </EmptyState>
            </Card>
          ) : (
            <>
              <Card pad="md" className="grid gap-4">
                {est && (
                  <MacroRow>
                    <Macro value={fmt(plans.solo?.totalMin ?? est.totalMin)} sub="durée, seul" icon="clock" />
                    <Macro value={fmt(plans.solo?.activeMin ?? est.activeMin)} sub="temps actif" />
                    <Macro value={Math.floor(units / 9)} sub={`repas à deux · ${units} u`} />
                    <Macro value={est.fridgeDays != null ? `J+${est.fridgeDays}` : "?"} sub="au frigo" icon="fridge" />
                  </MacroRow>
                )}
                {lanes && lanes.lanes.length > 0 && (
                  <div className="hidden gap-2 sm:grid">
                    <Lanes lanes={lanes.lanes} total={lanes.total} />
                    <p className="text-[12px] text-faint">Plan seul : la prep sur la planche, puis la cuisson. Survole une barre pour l&apos;étape ; cernée de rouge = conflit.</p>
                  </div>
                )}
              </Card>

              {plans.solo?.decisions?.map((d) => (
                <Alert key={d} tone="info" icon="sparkdraft">
                  {d}
                </Alert>
              ))}
              {plans.solo?.errors.map((e, i) => (
                <Alert key={`e${i}`} tone="ko" icon={e.kind === "oven_temp" ? "oven" : "pot"}>
                  {e.message}
                </Alert>
              ))}
              {est && est.conflicts.length > 0 && !plans.solo?.decisions?.length && (
                <div className="grid gap-2">
                  {est.conflicts.map((c, i) => (
                    <Alert key={i} tone="warn" icon={/four/i.test(c.message) ? "oven" : "pot"} title={c.message}>
                      <span className="num">+{fmt(c.extraMin)}</span> sur la session.
                    </Alert>
                  ))}
                </div>
              )}

              <section className="grid gap-2.5" aria-labelledby="choisies-titre">
                <h2 id="choisies-titre" className="text-[18px] font-bold">
                  Unités à cuire
                </h2>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {selected.map((y) => {
                    const f = y.factor;
                    const notFor = [...(tastes.dislikes.get(y.slug) ?? new Map<string, string[]>())];
                    const dec = stepFactor(f, -1);
                    const inc = stepFactor(f, 1);
                    return (
                      <Card key={y.slug} pad="sm" className="grid gap-3">
                        <div className="flex items-start gap-3">
                          <RecipeTile color={recipeColor(y.slug)} name={y.name} />
                          <div className="min-w-0 flex-1">
                            <Link href={`/recettes/${y.slug}`} className="block font-display text-[16px] font-bold leading-[1.2] hover:text-accent">
                              {y.name}
                            </Link>
                            <PartMacros kcalUnit={y.kcalUnit} proteinUnit={y.proteinUnit} eaters={eaters} size="sm" className="mt-1" />
                          </div>
                          <Link href={toggle(y.slug)} scroll={false} className={buttonClass({ variant: "quiet", size: "sm", iconOnly: true })} aria-label={`Retirer ${y.name}`} title="Retirer">
                            <PendingMark idle={<Icon name="x" size="s" />} />
                          </Link>
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <span className="text-[13px] text-ink-2">fiche {y.servingsUnits} u</span>
                          <FactorStepper name={y.name} factor={f} units={unitsOf(y)} dec={dec === f ? null : { href: withFactor(y.slug, dec), to: dec }} inc={inc === f ? null : { href: withFactor(y.slug, inc), to: inc }} />
                        </div>
                        {notFor.length > 0 && (
                          <p className="flex items-start gap-1.5 text-[13px] text-warn-ink">
                            <Icon name="alert" size="s" className="mt-px shrink-0" />
                            {notFor.map(([who, what]) => `${names[who] ?? who} n'aime pas : ${joinFr(what)}`).join(" · ")}
                          </p>
                        )}
                      </Card>
                    );
                  })}
                </div>
                {extraLines.map((e) => (
                  <Alert
                    key={e.id}
                    tone="ok"
                    icon="leaf"
                    className="!py-2 text-[14px]"
                    action={
                      <Link href={composerHref({ ...sel, extras: Object.fromEntries(Object.entries(sel.extras).filter(([id]) => id !== e.id)) })} scroll={false} className={buttonClass({ variant: "quiet", size: "sm", className: "!text-ok-ink" })}>
                        Retirer
                      </Link>
                    }
                  >
                    {e.recipe.name} : +{fmtG(e.g)} {e.item.split(/[,(]/)[0].toLowerCase()} pour finir le paquet (part recalculée)
                  </Alert>
                ))}
              </section>

              <Card pad="md" className="grid gap-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <form action={createList}>
                    <input type="hidden" name="r" value={formatSelection(sel).r} />
                    <input type="hidden" name="x" value={formatSelection(sel).x} />
                    <SubmitButton pendingText="Je prépare la liste…" icon="basket">Faire la liste de courses</SubmitButton>
                  </form>
                </div>
            <form action={startSession} className="space-y-2 border-t border-line pt-3">
              <input type="hidden" name="r" value={formatSelection(sel).r} />
              <input type="hidden" name="x" value={formatSelection(sel).x} />
              <ModePicker plans={plans} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <SubmitButton pendingText="Je planifie la session…" variant="soft">Lancer la session</SubmitButton>
                {/* Pour montrer l'appli : même session (téléphone, à deux…), rien n'est compté. */}
                <button type="submit" name="test" value="1" className="min-h-tap text-[14px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
                  ou une session test
                </button>
              </div>
            </form>
              </Card>

              <Suspense key={composerHref(sel)} fallback={<LeftoversSkeleton />}>
                <Leftovers sel={selected.map((y) => ({ slug: y.slug, factor: y.factor, extras: y.extras }))} mode={{ kind: "composer", selection: sel }} />
              </Suspense>
            </>
          )}

          {pairings.length > 0 && (
            <section className="grid gap-2.5" aria-labelledby="avec-titre">
              <h2 id="avec-titre" className="text-[18px] font-bold">
                Va bien avec
              </h2>
              <div className="grid overflow-hidden rounded-[14px] border border-line bg-surface [&>*:last-child]:border-b-0">
                {pairings.map((p) => {
                  const y = bySlug.get(p.slug)!;
                  return (
                    <div key={p.slug} className="flex min-w-0 items-center gap-3 border-b border-line px-3.5 py-3">
                      <RecipeTile color={recipeColor(p.slug)} name={y.name} size="sm" />
                      <div className="grid min-w-0 flex-1">
                        <span className="font-semibold leading-tight">{y.name}</span>
                        <span className="text-[13px] text-ink-2">
                          {p.addedMin > 0 ? `+${fmt(p.addedMin)}` : "sans allonger"} · {y.servingsUnits} u · {p.reasons.slice(0, 2).join(" · ")}
                        </span>
                        <PartMacros kcalUnit={y.kcalUnit} proteinUnit={y.proteinUnit} eaters={eaters} size="sm" className="mt-0.5" />
                      </div>
                      <Link href={toggle(p.slug)} scroll={false} className={buttonClass({ size: "sm" })}>
                        <PendingMark idle={<Icon name="plus" size="s" />} />
                        Ajouter
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

type Item = { slug: string; name: string; tags: string[]; kcalUnit: number | null; proteinUnit: number | null };

function Group({ title, items, picked, toggle }: { title: string; items: Item[]; picked: string[]; toggle: (slug: string) => string }) {
  if (!items.length) return null;
  return (
    <>
      <h2 className="mt-1 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-faint first:mt-0">{title}</h2>
      <ul className="grid gap-2 sm:max-lg:grid-cols-2">
        {items.map((y) => {
          const on = picked.includes(y.slug);
          const tags = y.tags.filter((t) => t !== "à relire" && t !== "indisponible").slice(0, 3);
          return (
            <li key={y.slug} className="min-w-0">
              <Link
                href={toggle(y.slug)}
                scroll={false}
                aria-pressed={on}
                aria-label={on ? `Retirer ${y.name}` : `Choisir ${y.name}`}
                className={cardClass({ lift: !on, className: `k-check flex min-h-tap items-center gap-3 p-3 !shadow-none ${on ? "!border-2 !border-accent !p-[11px]" : ""}` })}
              >
                <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-hidden className="peer absolute size-px opacity-0" />
                <span className="k-box grid size-[26px] shrink-0 place-items-center rounded-[7px] transition-[background-color,border-color] duration-[var(--dur-quick)]">
                  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="var(--c-on-accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <RecipeTile color={recipeColor(y.slug)} name={y.name} size="sm" />
                <span className="grid min-w-0 flex-1">
                  <b className="text-[15px] leading-tight">{y.name}</b>
                  <span className="truncate text-[13px] text-ink-2">{tags.join(" · ") || "—"}</span>
                </span>
                <PendingMark />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

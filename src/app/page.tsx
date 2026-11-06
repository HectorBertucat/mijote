// Accueil : la semaine en un regard (plats, repas couverts, jour et temps de session), l’action du
// moment (une seule, en cocotte ; « Ignorer » les repas sans plat), « Que manger ? » (la réserve de
// chacun, plat par plat, et le bilan du batch), la course du jour et les courses.
// Mise en page 7/5 au bureau, une colonne au téléphone (docs/design/systeme.md).
import Link from "next/link";
import { buttonClass, Icon, RecipeTile, StampSemainePrete } from "@/components/ui";
import { PendingMark } from "@/components/PendingMark";
import { StepSubmit } from "@/components/accueil/StepSubmit";
import { ignoreMissingAction, proposeAction, weekListAction } from "@/app/semaine/actions";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { dayWord, headline, NBSP, stepLabel, type HomeStep } from "@/lib/home/next";
import { homeView, type HomeView } from "@/lib/home/store";
import type { Meal } from "@/lib/week/propose";
import { periodHeading } from "@/lib/week/period";
import { recipeColor } from "@/lib/ui";
import { FirstSteps } from "@/components/accueil/FirstSteps";
import { WhatToEat } from "@/components/accueil/WhatToEat";
import { Tour } from "@/components/tour/Tour";
import { tourView } from "@/lib/tour/store";
import { catalogEnabled } from "@/lib/chronocatalog";
import { getPerson, listPeople } from "@/lib/health/store";
import { statusFor } from "@/lib/health/status-store";
import { WhereIAmSummary } from "@/components/sante/WhereIAm";
import { firstOfMonth } from "@/lib/typo";

export const dynamic = "force-dynamic";

const MEALS: Meal[] = ["lunch", "dinner"];
const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : (names[0] ?? ""));
const dateLong = (ymd: string) => firstOfMonth(new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }));

/** La phrase sous le titre : où en est la semaine, avec des chiffres. */
function sentence(h: HomeView): string {
  const s = h.step;
  switch (s.kind) {
    case "resume":
      return `Session en cours${NBSP}: ${h.active?.title ?? "la cuisine t’attend"}.`;
    case "choose":
      return `Choisis deux ou trois plats${NBSP}: je calcule les quantités, la part de chacun et la liste de courses.`;
    case "cover":
      return `Il manque ${s.missing}${NBSP}repas${NBSP}: ajoute un plat ou augmente les quantités.`;
    case "eat":
      return h.portionsLeft
        ? `La cuisine est faite${NBSP}: ${h.portionsLeft}${NBSP}portion${h.portionsLeft > 1 ? "s" : ""} en réserve${h.batch?.toWeigh ? `, en partie estimées${NBSP}: ${h.batch.toWeigh > 1 ? `${h.batch.toWeigh}${NBSP}plats ne sont pas encore pesés` : "un plat n’est pas encore pesé"}` : ""}. Chacun mange les siennes quand il veut.`
        : "La cuisine est faite, et tout est mangé.";
    case "list":
      return s.changed ? `La semaine a changé depuis la liste${NBSP}: refais-la avant de commander.` : "Tous les repas sont couverts. Reste la liste de courses.";
    case "wait":
      return `La liste se prépare${NBSP}: les produits arrivent un par un.`;
    case "shop":
      return `La liste est prête${NBSP}: ${h.list?.items ?? 0}${NBSP}articles${h.list?.inCart ? `, dont ${h.list.inCart} au panier` : ""}.`;
    case "cook":
      return `Les courses sont commandées. Il ne reste qu’à cuisiner.`;
  }
}

/** L’action du moment : un seul bouton cocotte. */
function StepAction({ step, h }: { step: HomeStep; h: HomeView }) {
  const label = stepLabel(step, h.cookDay, h.today);
  const cls = buttonClass({ variant: "accent", size: "kitchen" });
  const go = (href: string) => (
    <Link href={href} className={cls} data-step={step.kind}>
      {label}
      <PendingMark idle={<Icon name="chev" />} />
    </Link>
  );
  switch (step.kind) {
    case "resume":
      return go(`/session/${step.sessionId}`);
    case "choose":
    case "cover":
      return go(`/semaine?w=${h.start}#recettes`);
    case "eat":
      return go("/plats");
    case "list":
      return (
        <form action={weekListAction} data-step={step.kind}>
          <input type="hidden" name="w" value={h.start} />
          <StepSubmit pendingText="Je prépare la liste…">{label}</StepSubmit>
        </form>
      );
    case "wait":
    case "shop":
    case "cook":
      return go(`/courses/${step.listId}`);
  }
}

const QUIET_LINK = "inline-flex min-h-tap items-center gap-1 rounded-[8px] font-semibold text-ink-2 underline decoration-line-strong decoration-1 underline-offset-[6px] hover:text-ink hover:decoration-ink";

export default async function Accueil({ searchParams }: { searchParams: Promise<{ visite?: string }> }) {
  const profileId = await activeProfileId();
  const h = homeView(db, profileId);
  // Prise en main : la visite guidée (proposée une fois, ou relancée par ?visite=1) et les premiers pas.
  const tour = tourView(db, profileId);
  const replay = (await searchParams).visite != null;
  const lines = headline({ dishes: h.dishes.length, meals: h.toEat, minutes: h.minutes, cookDay: h.cookDay, today: h.today, cooked: h.cooked });
  const ready = h.step.kind === "cook";
  // « Où j'en suis » du profil de l'appareil, en deux lignes, dès qu'il a une cible.
  const me = profileId ? getPerson(db, profileId) : null;
  const status = me ? statusFor(db, me) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-y-12 lg:grid-cols-12 lg:gap-x-6 lg:gap-y-18">
      {/* La semaine : le titre en chiffres, l’action du moment, les plats. */}
      <section aria-labelledby="semaine-titre" className="relative min-w-0 lg:col-span-7">
        <p className="label text-ink-2">
          <Link href={`/semaine?w=${h.start}`} className="rounded-[4px] hover:text-ink">
            {periodHeading(h.start, h.days)}
          </Link>
          <span aria-hidden> · </span>
          {h.cooked ? "cuisinée" : `session ${dayWord(h.cookDay, h.today)}`}
        </p>
        <h1 id="semaine-titre" className="mt-4 text-display">
          {lines.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </h1>
        {ready && <StampSemainePrete seed={h.start} size={128} className="absolute top-8 right-0 sm:top-12" />}
        <p className="mt-6 max-w-[38ch] text-lead text-ink-2">{sentence(h)}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <StepAction step={h.step} h={h} />
          {h.step.kind === "choose" ? (
            <form action={proposeAction}>
              <input type="hidden" name="w" value={h.start} />
              <StepSubmit variant="secondary" size="md" pendingText="Je cherche…">
                Proposer trois plats
              </StepSubmit>
            </form>
          ) : h.step.kind === "cover" ? (
            // Un repas sans plat est parfois un choix : on l’ignore pour cette période (Semaine le rétablit).
            <IgnoreMissing h={h} n={h.step.missing} />
          ) : h.step.kind === "eat" && h.batch ? (
            <Link href={`/plats/batch/${h.batch.id}`} className={QUIET_LINK} data-link="bilan">
              {h.batch.title}
              {h.batch.toWeigh > 0 && <span className="font-normal">{NBSP}· {h.batch.toWeigh}{NBSP}à peser</span>}
            </Link>
          ) : (
            <Link href={`/semaine?w=${h.start}`} className={QUIET_LINK}>
              Voir la semaine
            </Link>
          )}
        </div>
        {h.missingIgnored && (
          <p className="mt-4 flex flex-wrap items-center gap-x-3 text-small text-ink-2" data-note="manque-ignore">
            <span>
              {h.toEat - h.covered}
              {NBSP}repas sans plat, ignoré{h.toEat - h.covered > 1 ? "s" : ""} pour cette période.
            </span>
            <IgnoreMissing h={h} n={null} />
          </p>
        )}

        {h.dishes.length > 0 && (
          <div className="mt-18">
            <h2 className="sr-only">Les plats</h2>
            <ul className="reveal border-t border-line-strong">
              {h.dishes.map((d) => (
                <li key={d.slug} className="border-b border-line">
                  <Link href={`/recettes/${d.slug}`} className="group -mx-3 flex min-w-0 items-center gap-4 rounded-[8px] px-3 py-4 hover:bg-surface-2">
                    <RecipeTile color={recipeColor(d.slug)} name={d.name} />
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="font-display text-h3 font-bold tracking-[-0.015em] text-pretty">{d.name}</span>
                      <span className="text-small text-ink-2">
                        {[h.multiple && d.eaters.length ? and(d.eaters) : null, d.frozen ? `${d.frozen} au congélo` : null].filter(Boolean).join(" · ") || " "}
                      </span>
                    </span>
                    <span className="grid shrink-0 justify-items-end gap-1">
                      <span className="num-tight text-h2">{d.meals}</span>
                      <span className="label text-faint">repas</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Le reste du foyer : que manger (la réserve de chacun), la course, les courses. */}
      <div className="grid min-w-0 content-start gap-12 lg:col-span-5 lg:border-l lg:border-line lg:pl-8">
        {tour.showSteps && <FirstSteps view={tour.steps} />}
        {h.lead && <WhatToEat reserve={h.reserve} planned={h.planned} people={h.people} me={h.lead.id} today={h.today} eaten={h.eatenToday} batch={h.batch} />}
        {status?.target && <HealthToday s={status} />}
        {h.run && <RunToday run={h.run} />}
        <Shopping h={h} />
      </div>

      {h.dishes.length > 0 && <Week h={h} />}
      <Tour start={tour.offer || replay} catalog={catalogEnabled()} profiles={listPeople(db).length} />
    </div>
  );
}

/** « Ignorer » les repas sans plat (n : combien), ou rétablir l’avertissement (n null). */
function IgnoreMissing({ h, n }: { h: HomeView; n: number | null }) {
  return (
    <form action={ignoreMissingAction}>
      <input type="hidden" name="w" value={h.start} />
      <input type="hidden" name="n" value={n ?? ""} />
      <input type="hidden" name="from" value="accueil" />
      <button type="submit" className={n == null ? `${QUIET_LINK} text-small` : QUIET_LINK} data-action={n == null ? "retablir-manque" : "ignorer-manque"}>
        {n == null ? "Rétablir l’avertissement" : "Ignorer"}
      </button>
    </form>
  );
}

/** La cible du profil de l'appareil et ce qui manque pour qu'elle s'ajuste (src/lib/health/status.ts). */
function HealthToday({ s }: { s: NonNullable<ReturnType<typeof statusFor>> }) {
  return (
    <section aria-labelledby="sante-titre">
      <h2 id="sante-titre" className="text-h2">
        Ma cible
      </h2>
      <div className="mt-6 border-t border-line-strong pt-4">
        <WhereIAmSummary s={s} />
      </div>
    </section>
  );
}

/** La séance de course du jour, une ligne vers la page Course. */
function RunToday({ run }: { run: NonNullable<HomeView["run"]> }) {
  return (
    <section aria-labelledby="course-titre">
      <h2 id="course-titre" className="text-h2">
        Course
      </h2>
      <div className="mt-6 border-t border-line-strong">
        <Link href="/sante/course" className="group -mx-3 flex items-center gap-4 rounded-[8px] border-b border-line px-3 py-4 hover:bg-surface-2">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="font-semibold text-pretty">{run.title}</span>
            <span className="text-small text-ink-2">{run.done ? "Faite aujourd’hui" : `Aujourd’hui, ${run.minutes}${NBSP}min en tout`}</span>
          </span>
          <Icon name="chev" className="text-ink-3" />
        </Link>
      </div>
    </section>
  );
}

/** Les courses de la période : l’état en un mot, puis le détail. */
function Shopping({ h }: { h: HomeView }) {
  const l = h.list;
  const state = !l ? "Pas encore de liste" : l.building ? "En préparation" : l.ordered ? "Commandées" : "À faire";
  const detail = !l
    ? h.dishes.length
      ? "La liste se fait depuis les plats choisis, rayon par rayon."
      : "Elle viendra des plats de la semaine."
    : l.ordered && l.orderedAt
      ? `le ${dateLong(l.orderedAt.slice(0, 10))}, ${l.items}${NBSP}articles`
      : `${l.items}${NBSP}articles${l.inCart ? `, ${l.inCart} au panier` : ""}`;
  return (
    <section aria-labelledby="courses-titre">
      <h2 id="courses-titre" className="border-b border-line-strong pb-4 text-h2">
        Les courses
      </h2>
      {l ? (
        <Link href={`/courses/${l.id}`} className="-mx-3 flex min-w-0 items-center gap-4 rounded-[8px] px-3 py-4 hover:bg-surface-2">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="font-display text-h3 font-bold tracking-[-0.015em]">{state}</span>
            <span className="text-small text-ink-2">
              {detail}
              {l.changed && ` · la semaine a changé depuis`}
            </span>
          </span>
          <span className="shrink-0 text-faint">
            <PendingMark idle={<Icon name="chev" />} />
          </span>
        </Link>
      ) : (
        <div className="grid gap-1 py-4">
          <span className="font-display text-h3 font-bold tracking-[-0.015em]">{state}</span>
          <span className="text-small text-ink-2">{detail}</span>
        </div>
      )}
      <Link href="/courses" className={`${QUIET_LINK} text-small`}>
        Toutes les listes
      </Link>
    </section>
  );
}

/** La période jour par jour : le plat de chaque repas, les repas qui manquent. */
function Week({ h }: { h: HomeView }) {
  return (
    <section aria-labelledby="jours-titre" className="min-w-0 lg:col-span-12">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line-strong pb-4">
        <h2 id="jours-titre" className="text-h2">
          Jour par jour <span className="text-faint">(indicatif)</span>
        </h2>
        <p className="num text-ink-2">
          <b className="font-semibold text-ink">{h.covered}</b> sur {h.toEat}
          {NBSP}repas couverts
        </p>
      </div>
      <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
        <div className="grid min-w-max sm:min-w-0" style={{ gridTemplateColumns: `48px repeat(${h.days}, minmax(56px, 1fr))` }}>
          <span aria-hidden />
          {h.week.map(({ day }) => {
            const now = day.date === h.today;
            return (
              <span key={day.i} className={`label border-l border-line px-2 pt-4 pb-3 ${now ? "text-ink" : "text-faint"}`}>
                {day.short} <span className="num">{day.num}</span>
                {now && <span className="mt-1 block h-0.5 w-6 bg-ink" aria-label="aujourd’hui" />}
              </span>
            );
          })}
          {MEALS.map((meal) => (
            <WeekRow key={meal} meal={meal} h={h} />
          ))}
        </div>
      </div>
    </section>
  );
}

function WeekRow({ meal, h }: { meal: Meal; h: HomeView }) {
  return (
    <>
      <span className="label self-center border-t border-line py-3 text-faint">{meal === "lunch" ? "Midi" : "Soir"}</span>
      {h.week.map(({ day, cells }) => {
        const c = cells[meal];
        return (
          <span key={day.i} className="flex min-h-12 flex-wrap content-center items-center gap-1 border-t border-l border-line px-2 py-3">
            {c.away ? (
              <span className="text-small text-faint" title="Personne à la maison">
                —
              </span>
            ) : (
              <>
                {c.dishes.map((d) => (
                  <RecipeTile key={d.slug} color={recipeColor(d.slug)} name={d.name} size="sm" />
                ))}
                {c.missing && <span role="img" aria-label="repas sans plat" title="Repas sans plat" className="size-7 rounded-[4px] border border-dashed border-faint" />}
              </>
            )}
          </span>
        );
      })}
    </>
  );
}

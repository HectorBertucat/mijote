// Accueil : la semaine en un regard (plats, repas couverts, jour et temps de session), l’action du
// moment (une seule, en cocotte), le frigo, les courses et les repas du jour du profil actif.
// Mise en page 7/5 au bureau, une colonne au téléphone (docs/design/systeme.md).
import Link from "next/link";
import { buttonClass, Icon, RecipeTile, StampSemainePrete } from "@/components/ui";
import { PendingMark } from "@/components/PendingMark";
import { StepSubmit } from "@/components/accueil/StepSubmit";
import { proposeAction, weekListAction } from "@/app/semaine/actions";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { dayWord, headline, minutesText, NBSP, stepLabel, type HomeStep } from "@/lib/home/next";
import { homeView, type HomeBoxGroup, type HomeView } from "@/lib/home/store";
import { addDays, type Meal } from "@/lib/week/propose";
import { periodHeading } from "@/lib/week/period";
import { recipeColor } from "@/lib/ui";
import { FirstSteps } from "@/components/accueil/FirstSteps";
import { Tour } from "@/components/tour/Tour";
import { tourView } from "@/lib/tour/store";
import { catalogEnabled } from "@/lib/chronocatalog";
import { listPeople } from "@/lib/health/store";
import { firstOfMonth } from "@/lib/typo";

export const dynamic = "force-dynamic";

const MEALS: Meal[] = ["lunch", "dinner"];
const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
const and = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : (names[0] ?? ""));
const boxes = (n: number) => `${n}${NBSP}boîte${n > 1 ? "s" : ""}`;
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
      return h.fridgeCount
        ? `La cuisine est faite${NBSP}: ${boxes(h.fridgeCount)} au frigo${h.freezerCount ? `, ${h.freezerCount} au congélo` : ""}.`
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
      return go("/frigo");
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
          ) : (
            <Link href={`/semaine?w=${h.start}`} className={QUIET_LINK}>
              Voir la semaine
            </Link>
          )}
        </div>

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

      {/* Le reste du foyer : aujourd’hui, le frigo, les courses. */}
      <div className="grid min-w-0 content-start gap-12 lg:col-span-5 lg:border-l lg:border-line lg:pl-8">
        {tour.showSteps && <FirstSteps view={tour.steps} />}
        {h.todayMeals.length > 0 && h.lead && <Today h={h} />}
        {h.run && <RunToday run={h.run} />}
        <Fridge h={h} />
        <Shopping h={h} />
      </div>

      {h.dishes.length > 0 && <Week h={h} />}
      <Tour start={tour.offer || replay} catalog={catalogEnabled()} profiles={listPeople(db).length} />
    </div>
  );
}

/** Les repas du jour du profil actif : midi et soir, en tableau de livre de cuisine. */
function Today({ h }: { h: HomeView }) {
  return (
    <section aria-labelledby="jour-titre">
      <h2 id="jour-titre" className="text-h2">
        Aujourd’hui{h.multiple ? <span className="text-faint">, {h.lead!.name}</span> : null}
      </h2>
      <dl className="mt-6 border-t border-line-strong">
        {h.todayMeals.map((m) => (
          <div key={m.meal} className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-line py-4">
            <dt className="label text-faint">{m.label}</dt>
            <dd className="flex min-w-0 items-center gap-3">
              <RecipeTile color={recipeColor(m.slug)} name={m.name} size="sm" />
              <Link href={`/recettes/${m.slug}`} className="font-semibold text-pretty hover:underline hover:decoration-line-strong hover:underline-offset-4">
                {m.name}
              </Link>
            </dd>
            <dd className="text-right">
              {m.kcal != null && (
                <span className="num block font-semibold">
                  {fr(m.kcal)}
                  {NBSP}kcal
                </span>
              )}
              {m.protein != null && (
                <span className="num block text-small text-ink-2">
                  {fr(m.protein)}
                  {NBSP}g de protéines
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {h.advice && <p className="mt-4 text-small text-ink-2">{h.advice}</p>}
    </section>
  );
}

/** Une boîte : jusqu’à quand, en un mot. */
function limitWord(g: HomeBoxGroup, today: string) {
  if (g.freshness === "past") return "à jeter";
  if (g.limit === today) return "aujourd’hui";
  if (g.limit === addDays(today, 1)) return "demain";
  const w = dayWord(g.limit, today);
  return /\d/.test(w) ? `jusqu’au ${w.replace(/^\p{L}+ /u, "")}` : `jusqu’à ${w}`;
}

/** Le frigo : combien de boîtes, celles à manger en premier ; le congélo complète s’il reste de la place. */
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

function Fridge({ h }: { h: HomeView }) {
  const shown = h.fridge.slice(0, 4);
  const frozen = h.freezer.slice(0, 4 - shown.length);
  const urgent = shown.findIndex((g) => g.freshness !== "ok");
  const more = h.fridge.length + h.freezer.length - shown.length - frozen.length;
  return (
    <section aria-labelledby="frigo-titre">
      <div className="flex items-end justify-between gap-4 border-b border-line-strong pb-4">
        <h2 id="frigo-titre" className="text-h2">
          <Link href="/frigo" className="rounded-[4px] hover:underline hover:decoration-2 hover:underline-offset-[6px]">
            Le frigo
          </Link>
        </h2>
        {h.fridgeCount > 0 && (
          <p className="flex items-baseline gap-2">
            <span className="num-tight text-num-xl">{h.fridgeCount}</span>
            <span className="label text-faint">boîte{h.fridgeCount > 1 ? "s" : ""}</span>
          </p>
        )}
      </div>
      {!shown.length && (
        <p className="mt-4 text-ink-2">
          {h.freezerCount
            ? `Rien au frigo. ${boxes(h.freezerCount)} au congélo${NBSP}: sors la veille celle du lendemain.`
            : `Vide. Les boîtes arrivent à la fin d’une session${NBSP}: on pèse la marmite, je dis combien mettre dans chaque boîte.`}
        </p>
      )}
      {shown.length + frozen.length > 0 && (
        <ul className="reveal">
          {shown.map((g, i) => (
            <BoxRow key={g.key} g={g} h={h} trail={limitWord(g, h.today)} hot={i === urgent} />
          ))}
          {frozen.map((g) => (
            <BoxRow
              key={g.key}
              g={g}
              h={h}
              trail={
                <span className="inline-flex items-center gap-1">
                  <Icon name="snow" size="s" className="text-faint" />
                  congélo
                </span>
              }
            />
          ))}
        </ul>
      )}
      {(more > 0 || (shown.length > 0 && h.freezerCount > 0 && !frozen.length)) && (
        <p className="mt-4 text-small text-ink-2">
          {more > 0 ? `et ${more}${NBSP}autre${more > 1 ? "s" : ""} plat${more > 1 ? "s" : ""} en boîte` : `${boxes(h.freezerCount)} au congélo`}
        </p>
      )}
    </section>
  );
}

function BoxRow({ g, h, trail, hot = false }: { g: HomeBoxGroup; h: HomeView; trail: React.ReactNode; hot?: boolean }) {
  return (
    <li className="border-b border-line">
      <Link href="/frigo" className="-mx-3 flex min-w-0 items-center gap-3 rounded-[8px] px-3 py-4 hover:bg-surface-2">
        <RecipeTile color={g.slug ? recipeColor(g.slug) : "var(--c-ink-3)"} name={g.name} size="sm" />
        <span className="grid min-w-0 flex-1">
          <span className="font-semibold text-pretty">
            {g.name}
            {g.count > 1 && <span className="num font-normal text-ink-2"> ×{NBSP}{g.count}</span>}
          </span>
          {h.multiple && g.people.length > 0 && <span className="text-small text-ink-2">pour {and(g.people)}</span>}
        </span>
        <span className={`shrink-0 text-right text-small ${hot ? "font-bold text-hot-ink" : "text-ink-2"}`}>{trail}</span>
      </Link>
    </li>
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
          Jour par jour
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

// Ce que l'accueil lit : la période affichée par défaut (comme /semaine), ses plats et ses repas,
// la liste de courses, la session, le batch du moment et la réserve de chacun (« Que manger ? »).
// Lecture seule, sauf ce que weekView et listDishes font déjà (créer la période, recaler les parts,
// mettre en réserve les plats d'une session finie sans pesée).
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, shoppingItems, shoppingLists } from "@/lib/db/schema";
import { currentBatch, listDishes, recentBatches, recentServings, type DishView, type ServingView } from "@/lib/reserve/store";
import { batchInPeriod } from "@/lib/reserve/batch";
import { todayParis } from "@/lib/health/store";
import { activeSession, buildPlan } from "@/lib/session/store";
import { estimateSession } from "@/lib/session/estimate";
import { defaultPeriod, periodDays, type PeriodDay } from "@/lib/week/period";
import type { Meal } from "@/lib/week/propose";
import { missingIgnoredOf, periodPlans, weekView } from "@/lib/week/store";
import { todayRun } from "@/lib/running/page";
import { cookDayOf, coverIgnored, nextStep, type HomeState, type HomeStep } from "./next";

export interface HomeDish {
  slug: string;
  name: string;
  /** Repas servis (une personne à un repas = un repas). */
  meals: number;
  frozen: number;
  /** Prénoms de ceux qui en mangent. */
  eaters: string[];
}

export interface HomeCell {
  dishes: { slug: string; name: string }[];
  missing: boolean;
  away: boolean;
}

export function homeView(db: Db, profileId: string | null, now = new Date()) {
  const today = todayParis(now);
  const plans = periodPlans(db);
  const def = defaultPeriod(plans, now);
  const view = weekView(db, def.start, def.days);
  const { grid, selected, assignment: a, eaters, library } = view;
  const days = periodDays(view.start, view.days);
  const nameOf = new Map(library.map((r) => [r.slug, r.name]));
  const personName = new Map(grid.map((s) => [s.personId, s.personName]));

  // Repas à servir (hors absences) et repas sans plat.
  const toEat = grid.filter((s) => s.place !== "away").length;
  const uncovered = new Set(a.uncovered.map((s) => `${s.day}:${s.meal}:${s.personId}`));
  const dishes: HomeDish[] = selected.map((r) => {
    const p = a.recipes.find((x) => x.slug === r.slug);
    const ids = new Set(p?.meals.flatMap((m) => m.personIds) ?? []);
    return {
      slug: r.slug,
      name: r.name,
      meals: p?.meals.reduce((s, m) => s + m.personIds.length, 0) ?? 0,
      frozen: p?.meals.filter((m) => m.frozen).reduce((s, m) => s + m.personIds.length, 0) ?? 0,
      eaters: eaters.filter((e) => ids.has(e.id)).map((e) => e.name),
    };
  });

  // La période jour par jour : les plats de chaque repas, un repas sans plat, tout le monde absent.
  const week: { day: PeriodDay; cells: Record<Meal, HomeCell> }[] = days.map((day) => {
    const cell = (meal: Meal): HomeCell => {
      const slots = grid.filter((s) => s.day === day.i && s.meal === meal);
      const present = slots.filter((s) => s.place !== "away");
      const slugs = [...new Set(present.map((s) => s.slug).filter((x): x is string => !!x))];
      return {
        dishes: slugs.map((slug) => ({ slug, name: nameOf.get(slug) ?? slug })),
        missing: present.some((s) => uncovered.has(`${day.i}:${meal}:${s.personId}`)),
        away: slots.length > 0 && present.length === 0,
      };
    };
    return { day, cells: { lunch: cell("lunch"), dinner: cell("dinner") } };
  });

  // Temps en cuisine : le planificateur aux unités choisies (comme /semaine), sinon l'estimation.
  const slugs = selected.map((r) => r.slug);
  const scales = Object.fromEntries(view.selection.filter((x) => x.factor !== 1).map((x) => [x.slug, x.factor]));
  let minutes: number | null = null;
  if (selected.length) {
    try {
      minutes = buildPlan(db, { slugs, scales, mode: "solo" }).totalMin;
    } catch {
      minutes = estimateSession(selected).totalMin;
    }
  }

  // Liste de courses de la période : articles et ce qui est déjà au panier.
  const list = view.list;
  const items = list
    ? db.select({ inCart: shoppingItems.inCartAt, pantry: shoppingItems.pantry }).from(shoppingItems).where(eq(shoppingItems.listId, list.id)).all().filter((i) => !i.pantry)
    : [];

  // Session : en cours (n'importe laquelle), ou finie pour cette période.
  const active = activeSession(db);
  const listIds = db.select({ id: shoppingLists.id }).from(shoppingLists).where(and(eq(shoppingLists.weekPlanId, view.planId), isNull(shoppingLists.archivedAt))).all().map((l) => l.id);
  const cooked = !!db
    .select({ id: cookSessions.id })
    .from(cookSessions)
    .where(and(eq(cookSessions.status, "done"), eq(cookSessions.test, false), listIds.length ? or(eq(cookSessions.weekPlanId, view.planId), inArray(cookSessions.shoppingListId, listIds)) : eq(cookSessions.weekPlanId, view.planId)))
    .get();

  // Un batch cuit pour la période compte aussi (une session lancée depuis Composer n'est liée à rien).
  const b = currentBatch(db, now);
  const batches = cooked ? [] : recentBatches(db, now);
  const cookedHere = cooked || batches.some((x) => batchInPeriod(x.cookedOn, view.start, view.days));

  const cookDay = cookDayOf(view.start);
  const missingIgnored = missingIgnoredOf(db, view.planId);
  const state: HomeState = { active, dishes: selected.length, missing: a.uncovered.length, missingIgnored, cooked: cookedHere, list, cookDay, today };
  const step: HomeStep = nextStep(state);

  // Que manger : la réserve de chacun, plat par plat (le jour est libre), le profil actif d'abord ; puis
  // les plats de la période pas encore cuisinés. Ce que chacun a mangé aujourd'hui, pour l'annuler.
  const lead = eaters.find((e) => e.id === profileId) ?? eaters[0] ?? null;
  const all = lead ? listDishes(db, lead.id, now) : [];
  const reserve: DishView[] = all.filter((d) => d.status === "cooked");
  const planned: DishView[] = all.filter((d) => d.status === "planned");
  const portionsLeft = reserve.reduce((s, d) => s + d.people.reduce((x, p) => x + p.left, 0), 0);
  const eatenToday: ServingView[] = eaters.flatMap((e) => recentServings(db, e.id, now, 1));
  const batch = b ? { id: b.id, title: b.title, cookedOn: b.cookedOn, ...b.summary } : null;

  return {
    today,
    start: view.start,
    days: view.days,
    cookDay,
    toEat,
    covered: toEat - a.uncovered.length,
    dishes,
    week,
    minutes,
    list: list ? { ...list, items: items.length, inCart: items.filter((i) => i.inCart).length } : null,
    active,
    cooked: cookedHere,
    step,
    /** Repas sans plat ignorés pour cette période (l'accueil ne les signale plus). */
    missingIgnored: coverIgnored(a.uncovered.length, missingIgnored),
    lead: lead ? { id: lead.id, name: lead.name } : null,
    people: eaters.map((e) => ({ id: e.id, name: e.name })),
    multiple: personName.size > 1,
    /** La réserve (plats cuits, portions de chacun), les plats à cuisiner, les portions qui restent au foyer. */
    reserve,
    planned,
    portionsLeft,
    eatenToday,
    /** Le batch du moment (le plus récent encore en réserve) : son bilan, les plats à peser. */
    batch,
    /** La séance de course du jour du profil actif (module Course activé), sans recalcul du plan. */
    run: todayRun(db, profileId, today),
  };
}

export type HomeView = ReturnType<typeof homeView>;

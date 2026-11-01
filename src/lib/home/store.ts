// Ce que l'accueil lit : la période affichée par défaut (comme /semaine), ses plats et ses repas,
// la liste de courses, la session, le frigo et les repas du jour du profil actif. Lecture seule,
// sauf ce que weekView fait déjà (créer la période, recaler les parts).
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, shoppingItems, shoppingLists } from "@/lib/db/schema";
import { listStock, type StockBox } from "@/lib/boxes/store";
import { adviceFor } from "@/lib/eaters/store";
import { todayParis } from "@/lib/health/store";
import { activeSession, buildPlan } from "@/lib/session/store";
import { estimateSession } from "@/lib/session/estimate";
import { dayIndexIn, defaultPeriod, periodDays, type PeriodDay } from "@/lib/week/period";
import { MEAL_LABEL, type Meal } from "@/lib/week/propose";
import { loadWeek, periodPlans, weekView } from "@/lib/week/store";
import { todayRun } from "@/lib/running/page";
import { cookDayOf, nextStep, type HomeState, type HomeStep } from "./next";

const MEALS: Meal[] = ["lunch", "dinner"];

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

export interface HomeBoxGroup {
  key: string;
  name: string;
  slug: string | null;
  count: number;
  people: string[];
  limit: string;
  freshness: StockBox["freshness"];
  plannedFor: string | null;
}

export interface HomeMeal {
  meal: Meal;
  label: string;
  slug: string;
  name: string;
  kcal: number | null;
  protein: number | null;
}

/** Boîtes d'un lieu regroupées (même plat, même date limite) : la plus pressée d'abord. */
export function groupBoxes(boxes: StockBox[]): HomeBoxGroup[] {
  const groups = new Map<string, HomeBoxGroup>();
  for (const b of boxes) {
    const key = `${b.slug ?? b.name}:${b.limit}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (b.personName && !g.people.includes(b.personName)) g.people.push(b.personName);
      if (b.plannedFor && (!g.plannedFor || b.plannedFor < g.plannedFor)) g.plannedFor = b.plannedFor;
    } else
      groups.set(key, { key, name: b.name, slug: b.slug, count: 1, people: b.personName ? [b.personName] : [], limit: b.limit, freshness: b.freshness, plannedFor: b.plannedFor });
  }
  return [...groups.values()].sort((a, b) => a.limit.localeCompare(b.limit) || (a.plannedFor ?? "9").localeCompare(b.plannedFor ?? "9") || a.name.localeCompare(b.name, "fr"));
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

  const cookDay = cookDayOf(view.start);
  const state: HomeState = { active, dishes: selected.length, missing: a.uncovered.length, cooked, list, cookDay, today };
  const step: HomeStep = nextStep(state);

  // Frigo : les boîtes du frigo d'abord (la plus pressée en tête), le congélo en nombre.
  const stock = listStock(db, today);
  const fridge = groupBoxes(stock.filter((b) => b.place === "fridge"));
  const freezer = groupBoxes(stock.filter((b) => b.place === "freezer"));
  const fridgeCount = stock.filter((b) => b.place === "fridge").length;
  const freezerCount = stock.length - fridgeCount;

  // Aujourd'hui, pour le profil actif : ses repas de la période qui contient aujourd'hui.
  const lead = eaters.find((e) => e.id === profileId) ?? eaters[0] ?? null;
  let todayMeals: HomeMeal[] = [];
  if (lead) {
    const inDefault = dayIndexIn(view.start, view.days, today);
    const current = inDefault != null ? null : plans.filter((p) => p.touched && dayIndexIn(p.start, p.days, today) != null).sort((x, y) => y.start.localeCompare(x.start))[0];
    const index = inDefault ?? (current ? dayIndexIn(current.start, current.days, today) : null);
    const slots = inDefault != null ? grid : current ? loadWeek(db, current.start).slots : [];
    // Les plats retenus de la période affichée portent leurs grammes ajoutés (macros recalculées).
    const byId = new Map([...library, ...(inDefault != null ? selected : [])].map((r) => [r.id, r]));
    todayMeals = MEALS.flatMap((meal) => {
      const s = slots.find((x) => x.day === index && x.meal === meal && x.personId === lead.id && x.place !== "away" && x.recipeId);
      const r = s ? byId.get(s.recipeId!) : null;
      if (!s || !r) return [];
      const units = s.portionUnits;
      return [{ meal, label: MEAL_LABEL[meal], slug: r.slug, name: r.name, kcal: r.kcalUnit != null ? r.kcalUnit * units : null, protein: r.proteinUnit != null ? r.proteinUnit * units : null }];
    });
  }
  const advice = lead && todayMeals.length ? adviceFor(db, lead, now) : null;

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
    cooked,
    step,
    fridge,
    freezer,
    fridgeCount,
    freezerCount,
    lead: lead ? { id: lead.id, name: lead.name } : null,
    multiple: personName.size > 1,
    todayMeals,
    advice: advice?.kind === "gap" ? advice.text : null,
    /** La séance de course du jour du profil actif (module Course activé), sans recalcul du plan. */
    run: todayRun(db, profileId, today),
  };
}

export type HomeView = ReturnType<typeof homeView>;

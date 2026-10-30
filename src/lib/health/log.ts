// Journal des repas (Santé > Aujourd'hui) : le prévu de la Semaine, les habitudes, les extras.
// kcal et macros sont figés au moment du log (une fiche modifiée ensuite ne réécrit pas le passé).
import { randomUUID } from "crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { dayLogs, foodLog, foodTemplates, mealSlots, people, recipes, weekPlans } from "@/lib/db/schema";
import { addDays } from "@/lib/week/propose";
import { dayIndexIn, MAX_DAYS, weekdayOf } from "@/lib/week/period";
import { listHabits } from "@/lib/eaters/setup";

export type LogMeal = "breakfast" | "lunch" | "dinner" | "snack";
export const MEAL_LABEL: Record<LogMeal, string> = { breakfast: "Matin", lunch: "Midi", dinner: "Soir", snack: "À côté" };
export const MEALS: LogMeal[] = ["breakfast", "lunch", "dinner", "snack"];

export type LogEntry = typeof foodLog.$inferSelect;
export type Template = typeof foodTemplates.$inferSelect;

export interface PlannedMeal {
  meal: "lunch" | "dinner";
  place: "home" | "office";
  recipeId: string;
  slug: string;
  name: string;
  units: number;
  kcal: number | null;
  proteinG: number | null;
}

/** Repas prévus dans la Semaine pour cette personne ce jour-là (présente, avec une recette). */
export function plannedMeals(db: Db, personId: string, date: string): PlannedMeal[] {
  // La période qui contient ce jour (la plus récente si deux se chevauchent).
  const plan = db
    .select({ id: weekPlans.id, start: weekPlans.weekStart, days: weekPlans.days })
    .from(weekPlans)
    .where(and(lte(weekPlans.weekStart, date), gte(weekPlans.weekStart, addDays(date, -MAX_DAYS))))
    .orderBy(desc(weekPlans.weekStart))
    .all()
    .map((p) => ({ ...p, day: dayIndexIn(p.start, p.days, date) }))
    .find((p) => p.day != null);
  if (!plan) return [];
  const person = db.select({ units: people.portionUnits }).from(people).where(eq(people.id, personId)).get();
  const rows = db
    .select({ meal: mealSlots.meal, place: mealSlots.place, units: mealSlots.units, recipeId: recipes.id, slug: recipes.slug, name: recipes.name, kcalUnit: recipes.kcalUnit, proteinUnit: recipes.proteinUnit })
    .from(mealSlots)
    .innerJoin(recipes, eq(recipes.id, mealSlots.recipeId))
    .where(and(eq(mealSlots.weekPlanId, plan.id), eq(mealSlots.personId, personId), eq(mealSlots.day, plan.day!)))
    .all()
    .sort((a, b) => (a.meal === b.meal ? 0 : a.meal === "lunch" ? -1 : 1));
  // La part prévue par la Semaine (selon la cible et la recette), sinon la part de base.
  const base = person?.units ?? 4;
  return rows
    .filter((r): r is typeof r & { place: "home" | "office" } => r.place !== "away")
    .map((r) => {
      const units = r.units ?? base;
      return { meal: r.meal, place: r.place, recipeId: r.recipeId, slug: r.slug, name: r.name, units, kcal: r.kcalUnit != null ? r.kcalUnit * units : null, proteinG: r.proteinUnit != null ? r.proteinUnit * units : null };
    });
}

export const listEntries = (db: Db, personId: string, date: string) =>
  db.select().from(foodLog).where(and(eq(foodLog.personId, personId), eq(foodLog.date, date))).orderBy(asc(foodLog.createdAt)).all();

/** Les habitudes de la personne (src/lib/eaters/setup.ts) : elles font aussi son hors batch. */
export const listTemplates = listHabits;

/** Extras récents (saisis ou estimés), pour les remettre en un tap. Un par libellé, le plus récent. */
export function recentExtras(db: Db, personId: string, limit = 8) {
  const rows = db
    .select()
    .from(foodLog)
    .where(and(eq(foodLog.personId, personId), inArray(foodLog.kind, ["free"])))
    .orderBy(desc(foodLog.createdAt))
    .limit(60)
    .all();
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.label.toLowerCase()) ? false : (seen.add(r.label.toLowerCase()), true))).slice(0, limit);
}

export function recipeMacros(db: Db, recipeId: string) {
  return db.select({ name: recipes.name, kcalUnit: recipes.kcalUnit, proteinUnit: recipes.proteinUnit, carbsUnit: recipes.carbsUnit, fatUnit: recipes.fatUnit }).from(recipes).where(eq(recipes.id, recipeId)).get() ?? null;
}

export interface NewEntry {
  personId: string;
  date: string;
  meal: LogMeal;
  kind: "recipe" | "template" | "free";
  recipeId?: string | null;
  templateId?: string | null;
  units?: number | null;
  label: string;
  kcal: number;
  proteinG: number;
  fatG?: number | null;
  carbsG?: number | null;
  source?: "plan" | "manual" | "ai";
}

export function addEntry(db: Db, e: NewEntry): LogEntry {
  if (!(e.kcal >= 0 && e.kcal < 5000)) throw new Error("Calories hors de la plage attendue (0 à 5 000 kcal).");
  const row = {
    id: randomUUID(),
    personId: e.personId,
    date: e.date,
    meal: e.meal,
    kind: e.kind,
    recipeId: e.recipeId ?? null,
    templateId: e.templateId ?? null,
    units: e.units ?? null,
    label: e.label.trim().slice(0, 120) || "Sans nom",
    kcal: Math.round(e.kcal),
    proteinG: Math.round(e.proteinG * 10) / 10,
    fatG: e.fatG ?? null,
    carbsG: e.carbsG ?? null,
    source: e.source ?? "manual",
  };
  db.insert(foodLog).values(row).run();
  return db.select().from(foodLog).where(eq(foodLog.id, row.id)).get()!;
}

/** Part d'une recette : macros par unité × unités. */
export function addRecipeEntry(db: Db, personId: string, date: string, meal: LogMeal, recipeId: string, units: number, source: "plan" | "manual" = "manual") {
  const r = recipeMacros(db, recipeId);
  if (!r) throw new Error("Recette introuvable.");
  if (r.kcalUnit == null) throw new Error(`« ${r.name} » n'a pas encore ses calories : ajoute-la à la main.`);
  return addEntry(db, {
    personId,
    date,
    meal,
    kind: "recipe",
    recipeId,
    units,
    label: r.name,
    kcal: r.kcalUnit * units,
    proteinG: (r.proteinUnit ?? 0) * units,
    fatG: r.fatUnit != null ? r.fatUnit * units : null,
    carbsG: r.carbsUnit != null ? r.carbsUnit * units : null,
    source,
  });
}

/** Change le nombre d'unités d'une part de recette (les macros suivent, au prorata). */
export function setEntryUnits(db: Db, id: string, units: number) {
  const e = db.select().from(foodLog).where(eq(foodLog.id, id)).get();
  if (!e || e.units == null || e.units <= 0) throw new Error("Cette ligne ne se compte pas en unités.");
  if (!(units > 0 && units <= 20)) throw new Error("Entre une demi-unité et 20.");
  const k = units / e.units;
  db.update(foodLog)
    .set({ units, kcal: Math.round(e.kcal * k), proteinG: Math.round(e.proteinG * k * 10) / 10, fatG: e.fatG != null ? e.fatG * k : null, carbsG: e.carbsG != null ? e.carbsG * k : null })
    .where(eq(foodLog.id, id))
    .run();
}

export const deleteEntry = (db: Db, id: string) => db.delete(foodLog).where(eq(foodLog.id, id)).run();

export function isComplete(db: Db, personId: string, date: string) {
  return db.select({ c: dayLogs.complete }).from(dayLogs).where(and(eq(dayLogs.personId, personId), eq(dayLogs.date, date))).get()?.c ?? false;
}

export function setComplete(db: Db, personId: string, date: string, complete: boolean) {
  db.insert(dayLogs).values({ personId, date, complete }).onConflictDoUpdate({ target: [dayLogs.personId, dayLogs.date], set: { complete } }).run();
}

// ─── Vue du jour (pur) ───

export interface DayTotals {
  kcal: number;
  proteinG: number;
}

export const totals = (entries: Pick<LogEntry, "kcal" | "proteinG">[]): DayTotals => ({
  kcal: Math.round(entries.reduce((s, e) => s + e.kcal, 0)),
  proteinG: Math.round(entries.reduce((s, e) => s + e.proteinG, 0)),
});

/** Ce qui reste à cocher : repas prévus et habitudes du jour pas encore loggés. */
export function pending(planned: PlannedMeal[], templates: Template[], entries: LogEntry[], date: string) {
  const d = weekdayOf(date);
  const loggedRecipe = new Set(entries.filter((e) => e.kind === "recipe").map((e) => `${e.meal}:${e.recipeId}`));
  const loggedMeal = new Set(entries.filter((e) => e.meal !== "snack").map((e) => e.meal));
  const loggedTpl = new Set(entries.filter((e) => e.templateId).map((e) => e.templateId));
  return {
    // un repas prévu disparaît s'il est loggé, ou si autre chose a été loggé à ce repas (« autre chose à la place »)
    planned: planned.filter((p) => !loggedRecipe.has(`${p.meal}:${p.recipeId}`) && !loggedMeal.has(p.meal)),
    templates: templates.filter((t) => !loggedTpl.has(t.id)).map((t) => ({ ...t, suggested: t.weekdays.includes(d) })),
  };
}

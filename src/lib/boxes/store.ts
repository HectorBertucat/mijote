// Les boîtes vues par la base : le stock du frigo et du congélateur. Une boîte est une portion rangée de
// la réserve (src/lib/reserve) : la manger passe par la réserve. Le calcul est dans ./core (pur, testé).
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { foodLog, mealBoxes, people, recipes } from "@/lib/db/schema";
import { adoptLegacyBoxes, eatPortion } from "@/lib/reserve/store";
import { todayParis } from "@/lib/health/store";
import { freshness, limitOf, type Place } from "./core";

// ─── Le stock ───

export interface StockBox {
  id: string;
  name: string;
  slug: string | null;
  personId: string | null;
  personName: string | null;
  grams: number | null;
  sideGrams: number | null;
  sideLabel: string | null;
  kcal: number | null;
  proteinG: number | null;
  cookedOn: string;
  plannedFor: string | null;
  plannedMeal: "lunch" | "dinner" | null;
  place: Place;
  thawed: boolean;
  limit: string;
  freshness: "ok" | "soon" | "past";
}

/** Les boîtes en stock, la plus pressée d'abord. */
export function listStock(db: Db, today = todayParis()): StockBox[] {
  return db
    .select({ b: mealBoxes, slug: recipes.slug, personName: people.name })
    .from(mealBoxes)
    .leftJoin(recipes, eq(recipes.id, mealBoxes.recipeId))
    .leftJoin(people, eq(people.id, mealBoxes.personId))
    .where(eq(mealBoxes.status, "stock"))
    .all()
    .map(({ b, slug, personName }) => {
      const limit = limitOf(b);
      return {
        id: b.id,
        name: b.name,
        slug,
        personId: b.personId,
        personName,
        grams: b.grams,
        sideGrams: b.sideGrams,
        sideLabel: b.sideLabel,
        kcal: b.kcal,
        proteinG: b.proteinG,
        cookedOn: b.cookedOn,
        plannedFor: b.plannedFor,
        plannedMeal: b.plannedMeal,
        place: b.place,
        thawed: b.thawedOn != null,
        limit,
        freshness: freshness(limit, today),
      };
    })
    .sort((a, b) => a.limit.localeCompare(b.limit) || (a.plannedFor ?? "9").localeCompare(b.plannedFor ?? "9") || a.name.localeCompare(b.name));
}

const stockBox = (db: Db, id: string) => {
  const b = db.select().from(mealBoxes).where(eq(mealBoxes.id, id)).get();
  if (!b || b.status !== "stock") throw new Error("Cette boîte n'est plus au frigo.");
  return b;
};

/**
 * « Je mange cette boîte » : une portion de la réserve (src/lib/reserve), mangée depuis cette boîte :
 * une ligne au journal de Santé (macros de la boîte), et la boîte sort du stock.
 */
export function eatBox(db: Db, id: string, personId: string, now = new Date()) {
  adoptLegacyBoxes(db);
  const b = stockBox(db, id);
  if (!b.reserveId) throw new Error("Cette boîte n'est plus au frigo.");
  const s = eatPortion(db, b.reserveId, personId, { boxId: id }, now);
  return db.select().from(foodLog).where(eq(foodLog.id, s.entryId!)).get()!;
}

export function freezeBox(db: Db, id: string, today = todayParis()) {
  stockBox(db, id);
  db.update(mealBoxes).set({ place: "freezer", frozenOn: today, thawedOn: null }).where(eq(mealBoxes.id, id)).run();
}

/** Sortie du congélateur, au frigo : à manger le lendemain au plus tard. */
export function thawBox(db: Db, id: string, today = todayParis()) {
  stockBox(db, id);
  db.update(mealBoxes).set({ place: "fridge", thawedOn: today }).where(eq(mealBoxes.id, id)).run();
}

export function throwBox(db: Db, id: string, now = new Date()) {
  stockBox(db, id);
  db.update(mealBoxes).set({ status: "thrown", closedAt: now.toISOString() }).where(eq(mealBoxes.id, id)).run();
}

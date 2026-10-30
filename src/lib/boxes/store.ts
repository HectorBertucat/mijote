// Les boîtes vues par la base : la marmite d'une recette (macros du plat et de la garniture,
// repas prévus), le rangement en fin de session, et le stock du frigo et du congélateur.
// Le calcul est dans ./core (pur, testé).
import { randomUUID } from "crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, mealBoxes, mealSlots, people, recipeIngredients, recipes, weekPlans } from "@/lib/db/schema";
import { loadEaters } from "@/lib/eaters/store";
import { addEntry } from "@/lib/health/log";
import { todayParis } from "@/lib/health/store";
import { computeNutrition, type IngredientYield } from "@/lib/nutrition/compute";
import type { SessionPlan } from "@/lib/session/planner";
import { mondayOf } from "@/lib/week/propose";
import { daysBetween, DEFAULT_FRIDGE_DAYS, freshness, limitOf, mealAt, placeFor, splitPot, type Place, type PotModel, type PotPerson, type Weights } from "./core";

type IngRow = { item: string; foodId: string | null; grams: number | null; units: number | null; yield: IngredientYield | null; side: boolean; optional: boolean };

/** « Riz basmati » → « riz » ; plusieurs garnitures : « riz et semoule ». */
export const sideLabelOf = (items: string[]) => [...new Set(items.map((i) => i.split(/[\s,(]/)[0].toLowerCase()))].join(" et ");

/** Macros du plat et de la garniture à part, pour la marmite entière (× multiplicateur). */
export function potParts(ings: IngRow[], scale: number): Pick<PotModel, "dish" | "side"> {
  const part = (rows: IngRow[]) => computeNutrition(rows.map((i) => ({ item: i.item, food: i.foodId, grams: i.grams, units: i.units, yield: i.yield })), 1);
  const used = ings.filter((i) => !i.optional);
  const sides = used.filter((i) => i.side);
  const all = part(used);
  // Comme la fiche : sans 80 % des ingrédients connus, les macros ne servent pas au partage.
  const known = all.coverage >= 0.8;
  if (!sides.length) return { dish: known ? { kcal: all.total.kcal * scale, protein: all.total.protein * scale } : null, side: null };
  const d = part(used.filter((i) => !i.side));
  const s = part(sides);
  return {
    dish: known ? { kcal: d.total.kcal * scale, protein: d.total.protein * scale } : null,
    side: { label: sideLabelOf(sides.map((i) => i.item)), kcal: known ? s.total.kcal * scale : 0, protein: known ? s.total.protein * scale : 0 },
  };
}

const addDays = (date: string, n: number) => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Repas prévus par la Semaine avec cette recette, du jour de la cuisson aux deux semaines suivantes. */
export function plannedSlots(db: Db, recipeId: string, cookedOn: string): Map<string, PotPerson["planned"]> {
  const monday = mondayOf(new Date(`${cookedOn}T12:00:00Z`));
  const weeks = [monday, addDays(monday, 7)];
  const rows = db
    .select({ weekStart: weekPlans.weekStart, day: mealSlots.day, meal: mealSlots.meal, personId: mealSlots.personId })
    .from(mealSlots)
    .innerJoin(weekPlans, eq(weekPlans.id, mealSlots.weekPlanId))
    .where(and(eq(mealSlots.recipeId, recipeId), ne(mealSlots.place, "away"), inArray(weekPlans.weekStart, weeks)))
    .all();
  const out = new Map<string, PotPerson["planned"]>();
  for (const r of rows) {
    const date = addDays(r.weekStart, r.day);
    const d = daysBetween(cookedOn, date);
    if (d < 0 || d >= 14) continue;
    out.set(r.personId, [...(out.get(r.personId) ?? []), { date, meal: r.meal }]);
  }
  return out;
}

/** La marmite d'une recette : `week` = avec les repas prévus (fin de session), sinon un partage à parts égales du foyer. */
export function potModel(db: Db, slug: string, opts: { scale?: number; cookedOn?: string; week?: boolean } = {}): PotModel | null {
  const r = db.select().from(recipes).where(eq(recipes.slug, slug)).get();
  if (!r) return null;
  const scale = opts.scale ?? 1;
  const cookedOn = opts.cookedOn ?? todayParis();
  const ings = db
    .select({ item: recipeIngredients.item, foodId: recipeIngredients.foodId, grams: recipeIngredients.grams, units: recipeIngredients.units, yield: recipeIngredients.yield, side: recipeIngredients.side, optional: recipeIngredients.optional })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, r.id))
    .orderBy(asc(recipeIngredients.position))
    .all();
  const planned = opts.week ? plannedSlots(db, r.id, cookedOn) : new Map<string, PotPerson["planned"]>();
  return {
    recipeId: r.id,
    slug: r.slug,
    name: r.name,
    cookedUnits: r.servingsUnits * scale,
    ...potParts(ings, scale),
    fridgeDays: r.fridgeDays,
    freezerOk: r.freezerOk,
    cookedOn,
    people: loadEaters(db).map((e) => ({ id: e.id, name: e.name, baseUnits: e.baseUnits, ref: e.ref, planned: planned.get(e.id) ?? [] })),
  };
}

const cookedOnOf = (s: { endedAt: string | null; startedAt: string | null }) => todayParis(new Date(s.endedAt ?? s.startedAt ?? Date.now()));

export interface StoredPot {
  count: number;
  open: number;
  dishG: number | null;
  sideG: number | null;
}

/** Les marmites d'une session terminée, et ce qui est déjà rangé pour chacune. */
export function sessionPots(db: Db, sessionId: string): { pots: PotModel[]; stored: Record<string, StoredPot> } | null {
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).get();
  if (!s?.planJson) return null;
  const plan = s.planJson as SessionPlan;
  const cookedOn = cookedOnOf(s);
  const pots = plan.recipes.map((r) => potModel(db, r.slug, { scale: r.scale, cookedOn, week: true })).filter((p): p is PotModel => p != null);
  const stored: Record<string, StoredPot> = {};
  for (const b of db.select().from(mealBoxes).where(eq(mealBoxes.sessionId, sessionId)).all()) {
    if (!b.recipeId) continue;
    const x = (stored[b.recipeId] ??= { count: 0, open: 0, dishG: null, sideG: null });
    x.count++;
    if (b.status === "stock") x.open++;
    if (b.grams != null) x.dishG = (x.dishG ?? 0) + b.grams;
    if (b.sideGrams != null) x.sideG = (x.sideG ?? 0) + b.sideGrams;
  }
  return { pots, stored };
}

/**
 * Range les boîtes d'une recette de la session : le partage est refait ici (on ne garde pas celui
 * de l'écran). Ranger à nouveau remplace les boîtes encore en stock ; celles déjà mangées ou jetées
 * restent, et autant de boîtes de la même personne sont retirées du nouveau partage.
 */
export function storeBoxes(db: Db, sessionId: string, recipeId: string, weights: Weights): number {
  const s = db.select().from(cookSessions).where(eq(cookSessions.id, sessionId)).get();
  if (!s?.planJson) throw new Error("Session introuvable.");
  if (s.test) throw new Error("Une session test ne range rien au frigo.");
  const r = db.select().from(recipes).where(eq(recipes.id, recipeId)).get();
  const inPlan = r && (s.planJson as SessionPlan).recipes.find((x) => x.slug === r.slug);
  if (!r || !inPlan) throw new Error("Cette recette n'est pas dans la session.");
  const ok = (g: number | null | undefined) => g == null || (Number.isFinite(g) && g >= 0 && g <= 50_000);
  if (!ok(weights.dishG) || !ok(weights.sideG)) throw new Error("Poids entre 0 et 50 kg.");
  const cookedOn = cookedOnOf(s);
  const model = potModel(db, r.slug, { scale: inPlan.scale, cookedOn, week: true })!;
  const split = splitPot(model, weights);
  return db.transaction((tx) => {
    const existing = tx.select().from(mealBoxes).where(and(eq(mealBoxes.sessionId, sessionId), eq(mealBoxes.recipeId, recipeId))).all();
    tx.delete(mealBoxes).where(and(eq(mealBoxes.sessionId, sessionId), eq(mealBoxes.recipeId, recipeId), eq(mealBoxes.status, "stock"))).run();
    const boxes = [...split.boxes];
    for (const c of existing.filter((b) => b.status !== "stock")) {
      const i = boxes.findIndex((b) => b.personId === c.personId);
      if (i >= 0) boxes.splice(i, 1);
    }
    const fridgeDays = r.fridgeDays ?? DEFAULT_FRIDGE_DAYS;
    for (const b of boxes) {
      const place = placeFor(cookedOn, b.plannedFor?.date ?? null, r.fridgeDays, r.freezerOk);
      tx.insert(mealBoxes)
        .values({
          id: randomUUID(),
          sessionId,
          recipeId,
          name: r.name,
          personId: b.personId,
          grams: b.dishG,
          sideGrams: b.sideG,
          sideLabel: model.side?.label ?? null,
          kcal: b.kcal,
          proteinG: b.protein,
          cookedOn,
          plannedFor: b.plannedFor?.date ?? null,
          plannedMeal: b.plannedFor?.meal ?? null,
          place,
          fridgeDays,
          frozenOn: place === "freezer" ? cookedOn : null,
        })
        .run();
    }
    return boxes.length;
  });
}

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

const parisHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(d));

/** « Je mange cette boîte » : une ligne au journal de Santé (macros de la boîte), et la boîte sort du stock. */
export function eatBox(db: Db, id: string, personId: string, now = new Date()) {
  return db.transaction((tx) => {
    const b = stockBox(tx as unknown as Db, id);
    const grams = [b.grams != null ? `${Math.round(b.grams)} g` : null, b.sideGrams != null ? `${b.sideLabel ?? "garniture"} ${Math.round(b.sideGrams)} g` : null].filter(Boolean).join(" + ");
    const entry = addEntry(tx as unknown as Db, {
      personId,
      date: todayParis(now),
      meal: mealAt(parisHour(now)),
      kind: "recipe",
      recipeId: b.recipeId,
      label: grams ? `${b.name} (${grams})` : b.name,
      kcal: b.kcal ?? 0,
      proteinG: b.proteinG ?? 0,
      source: "manual",
    });
    tx.update(mealBoxes).set({ status: "eaten", closedAt: now.toISOString(), eatenBy: personId, foodLogId: entry.id }).where(eq(mealBoxes.id, id)).run();
    return entry;
  });
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

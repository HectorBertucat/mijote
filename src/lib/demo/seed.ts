// Écrit le foyer de la démo (./household.ts) dans une base où les recettes sont déjà importées, avec les
// fonctions de l'appli : la Semaine répartit les plats, la liste de courses se fait sans catalogue, la
// session est planifiée puis terminée, la marmite part en boîtes, les boîtes passées sont mangées (ce qui
// remplit le journal de Santé). Seules les dates sont reculées à la main, pour que tout ait eu lieu.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, foodTemplates, mealBoxes, people, preferences, recipeIngredients, recipes, shoppingLists, workouts } from "@/lib/db/schema";
import { eatBox, freezeBox, storeBoxes, thawBox } from "@/lib/boxes/store";
import { addEntry } from "@/lib/health/log";
import { addWeighIn, setWaist } from "@/lib/health/store";
import { applyKitchen } from "@/lib/kitchen/store";
import { createSession } from "@/lib/session/store";
import type { SessionPlan } from "@/lib/session/planner";
import { setSetting, SETTING } from "@/lib/settings";
import { buildShoppingList } from "@/lib/shopping/build";
import { validateOrder } from "@/lib/shopping/cart";
import { KB_TEMPLATE } from "@/lib/training/program";
import { RENFO_TEMPLATE } from "@/lib/training/renfo";
import { assignProgram } from "@/lib/training/programs";
import { addDays } from "@/lib/week/propose";
import { addRecipe, ensureWeek, loadSelection } from "@/lib/week/store";
import { demoHousehold, demoWorkouts, type DemoHousehold } from "./household";

/** Une heure de Paris approchée en UTC (à une heure près selon la saison : le repas reste le même). */
const at = (date: string, utc: string) => new Date(`${date}T${utc}:00.000Z`);

/** Choisit les plats d'une semaine (la Semaine cale les quantités et répartit), renvoie le plan. */
function planWeek(db: Db, start: string, slugs: string[]) {
  const planId = ensureWeek(db, start);
  for (const slug of slugs) addRecipe(db, start, slug);
  return { planId, sel: loadSelection(db, planId) };
}

/** Poids d'une marmite cuite, estimé des grammes crus (le plat réduit, le riz gonfle). */
function potWeights(db: Db, recipeId: string, scale: number) {
  const ings = db.select({ grams: recipeIngredients.grams, side: recipeIngredients.side, optional: recipeIngredients.optional }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId)).all();
  const sum = (side: boolean) => ings.filter((i) => !i.optional && i.side === side).reduce((s, i) => s + (i.grams ?? 0), 0) * scale;
  const side = sum(true);
  return { dishG: Math.round(sum(false) * 0.82), sideG: side > 0 ? Math.round(side * 2.4) : null };
}

/**
 * Une semaine déjà cuisinée : la liste faite et payée le samedi, la session du dimanche terminée, les
 * boîtes rangées ; celles des repas passés sont mangées, celles d'aujourd'hui et demain sont sorties du
 * congélo la veille, la marge part au congélo (`freezeMargin`).
 */
async function cookedWeek(db: Db, h: DemoHousehold, week: { start: string; cookedOn: string; listOn: string }, slugs: string[], opts: { archive: boolean; freezeMargin: number }) {
  const { today } = h.calendar;
  const { planId, sel } = planWeek(db, week.start, slugs);
  const scales = Object.fromEntries(sel.map((x) => [x.slug, x.factor]));
  const listId = await buildShoppingList(db, sel.map((x) => x.slug), { weekPlanId: planId, scales });
  // Validée comme dans l'appli (tout au panier), sinon la liste payée montrerait un ticket vide.
  validateOrder(db, listId, at(week.listOn, "10:30").toISOString());
  db.update(shoppingLists)
    .set({ status: "paid", createdAt: at(week.listOn, "09:00").toISOString(), orderedAt: at(week.listOn, "10:30").toISOString(), archivedAt: opts.archive ? at(week.cookedOn, "18:00").toISOString() : null })
    .where(eq(shoppingLists.id, listId))
    .run();

  const sessionId = createSession(db, { slugs: sel.map((x) => x.slug), mode: "duo", shoppingListId: listId });
  db.update(cookSessions)
    .set({ status: "done", weekPlanId: planId, startedAt: at(week.cookedOn, "08:30").toISOString(), endedAt: at(week.cookedOn, "11:40").toISOString() })
    .where(eq(cookSessions.id, sessionId))
    .run();
  const plan = db.select({ planJson: cookSessions.planJson }).from(cookSessions).where(eq(cookSessions.id, sessionId)).get()!.planJson as SessionPlan;
  const ids = new Map(db.select({ id: recipes.id, slug: recipes.slug }).from(recipes).where(inArray(recipes.slug, slugs)).all().map((r) => [r.slug, r.id]));
  for (const r of plan.recipes) {
    const recipeId = ids.get(r.slug);
    if (recipeId) storeBoxes(db, sessionId, recipeId, potWeights(db, recipeId, r.scale ?? 1));
  }

  const firstPerson = h.people[0].id;
  let frozen = 0;
  for (const b of db.select().from(mealBoxes).where(and(eq(mealBoxes.sessionId, sessionId), eq(mealBoxes.status, "stock"))).all()) {
    if (b.plannedFor && b.plannedFor < today) eatBox(db, b.id, b.personId ?? firstPerson, at(b.plannedFor, b.plannedMeal === "dinner" ? "18:45" : "11:15"));
    else if (b.plannedFor && b.place === "freezer" && b.plannedFor <= addDays(today, 1)) thawBox(db, b.id, addDays(b.plannedFor, -1));
    else if (!b.plannedFor && b.place === "fridge" && frozen < opts.freezeMargin) {
      freezeBox(db, b.id, addDays(week.cookedOn, 1));
      frozen++;
    } else if (!b.plannedFor && b.place === "fridge" && opts.archive) eatBox(db, b.id, b.personId ?? firstPerson, at(addDays(week.cookedOn, 6), "11:15"));
  }
  return { planId, listId, sessionId };
}

/** Le foyer de la démo, daté par rapport à `today` (YYYY-MM-DD, heure de Paris). Base neuve, recettes importées. */
export async function seedDemo(db: Db, today: string) {
  const h = demoHousehold(today);
  const { calendar } = h;

  setSetting(db, SETTING.homeName, h.homeName);
  setSetting(db, SETTING.storeLabel, h.storeLabel);
  applyKitchen(db, h.kitchen);
  for (const p of h.people) db.insert(people).values(p).onConflictDoNothing().run();
  for (const p of h.preferences) db.insert(preferences).values(p).onConflictDoNothing().run();
  for (const x of h.habits) db.insert(foodTemplates).values({ ...x, position: 0 }).onConflictDoNothing().run();
  for (const w of h.weighIns) addWeighIn(db, w.personId, w.kg, at(w.date, "06:10"));
  for (const w of h.waist) setWaist(db, w.personId, w.date, w.cm);
  for (const p of h.programs) {
    const template = p.template === "kb" ? KB_TEMPLATE : RENFO_TEMPLATE;
    const program = assignProgram(db, p.personId, template, "modele", null, p.id);
    for (const w of demoWorkouts(program, p.personId, calendar.historyFrom, today, p.weekdays, p.personId.length * 7)) db.insert(workouts).values({ ...w, note: null }).run();
  }

  // Le matin, chacun prend son habitude (dans le journal depuis la semaine précédente, aujourd'hui compris).
  for (let d = calendar.previous.start; d <= today; d = addDays(d, 1)) {
    const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    for (const x of h.habits.filter((x) => x.weekdays.includes(wd)))
      addEntry(db, { personId: x.personId, date: d, meal: x.meal, kind: "template", templateId: x.id, label: x.label, kcal: x.kcal, proteinG: x.proteinG, fatG: x.fatG, carbsG: x.carbsG });
  }

  await cookedWeek(db, h, calendar.previous, h.weeks.previous, { archive: true, freezeMargin: 2 });
  await cookedWeek(db, h, calendar.current, h.weeks.current, { archive: false, freezeMargin: 1 });
  const next = planWeek(db, calendar.next.start, h.weeks.next);
  await buildShoppingList(db, next.sel.map((x) => x.slug), { weekPlanId: next.planId, scales: Object.fromEntries(next.sel.map((x) => [x.slug, x.factor])) });

  setSetting(db, SETTING.setupDone, at(calendar.historyFrom, "19:00").toISOString());
}

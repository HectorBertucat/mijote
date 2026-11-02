// Écrit le foyer de la démo (./household.ts) dans une base où les recettes sont déjà importées, avec les
// fonctions de l'appli : la Semaine répartit les plats, la liste de courses se fait sans catalogue, la
// session est planifiée puis terminée, chaque marmite pesée part en réserve (portions de chacun, boîtes du
// congélo), les portions des repas passés sont mangées (ce qui remplit le journal de Santé). Seules les dates
// sont reculées à la main, pour que tout ait eu lieu.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, foodTemplates, mealBoxes, people, preferences, recipes, runProfiles, shoppingLists, workouts } from "@/lib/db/schema";
import { thawBox } from "@/lib/boxes/store";
import { defaultCounts, defaultFreezer } from "@/lib/reserve/core";
import { calcModel, eatPortion, listDishes, plannedSlots, saveReserve } from "@/lib/reserve/store";
import { addEntry } from "@/lib/health/log";
import { ingestV2, parseV2 } from "@/lib/health/ingest-v2";
import { addWeighIn, setWaist } from "@/lib/health/store";
import { applyKitchen } from "@/lib/kitchen/store";
import { ackPlans, noteFeedback, saveRunSettings, syncPlan, watchPlans } from "@/lib/running/store";
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
import { DEMO_RUN_SETTINGS, demoHealth, demoHousehold, demoRuns, demoWorkouts, runStart, type DemoHousehold } from "./household";

/** Une heure de Paris approchée en UTC (à une heure près selon la saison : le repas reste le même). */
const at = (date: string, utc: string) => new Date(`${date}T${utc}:00.000Z`);

/** Choisit les plats d'une semaine (la Semaine cale les quantités et répartit), renvoie le plan. */
function planWeek(db: Db, start: string, slugs: string[]) {
  const planId = ensureWeek(db, start);
  for (const slug of slugs) addRecipe(db, start, slug);
  return { planId, sel: loadSelection(db, planId) };
}

/**
 * Une semaine déjà cuisinée : la liste faite et payée le samedi, la session du dimanche terminée, chaque
 * marmite pesée (le poids cuit estimé du cru) et mise en réserve, avec les boîtes du congélo. Les portions
 * des repas passés sont mangées ; une boîte du congélo est sortie la veille. Une semaine archivée est finie.
 */
async function cookedWeek(db: Db, h: DemoHousehold, week: { start: string; cookedOn: string; listOn: string }, slugs: string[], opts: { archive: boolean }) {
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
  const weighed = at(week.cookedOn, "11:45");
  // Les repas passés et le midi d'aujourd'hui, dans l'ordre : chacun mange une portion du plat prévu ce jour-là
  // (la Semaine reste un repère) ; le batch est entamé, même un lundi.
  const meals: { reserveId: string; personId: string; date: string; meal: "lunch" | "dinner" }[] = [];
  const reserveIds = new Set<string>();
  for (const r of plan.recipes) {
    const recipeId = ids.get(r.slug);
    if (!recipeId) continue;
    const m = calcModel(db, r.slug, { scale: r.scale ?? 1, cookedOn: week.cookedOn, week: true }, weighed)!;
    const counts = defaultCounts(m);
    const weights = Object.fromEntries(m.groups.map((g) => [g.key, Math.round(g.estG / 5) * 5]));
    const { reserveId } = saveReserve(db, sessionId, recipeId, { weights, counts, freezer: defaultFreezer(m, counts) }, weighed);
    reserveIds.add(reserveId);
    for (const [personId, slots] of plannedSlots(db, recipeId, week.cookedOn)) for (const s of slots) if (s.date < today || (s.date === today && s.meal === "lunch") || opts.archive) meals.push({ reserveId, personId, date: s.date, meal: s.meal });
  }
  meals.sort((a, b) => a.date.localeCompare(b.date) || a.meal.localeCompare(b.meal));
  for (const x of meals) {
    try {
      eatPortion(db, x.reserveId, x.personId, { date: x.date, meal: x.meal }, at(x.date, x.meal === "dinner" ? "18:45" : "11:15"));
    } catch {
      // Plus rien de ce plat : le repas a été pris ailleurs.
    }
  }
  // Une semaine archivée : le reste du grand récipient est fini le samedi ; les boîtes du congélo restent.
  if (opts.archive) {
    const end = at(addDays(week.cookedOn, 6), "11:15");
    for (const d of listDishes(db, null, end).filter((x) => x.status === "cooked" && reserveIds.has(x.id)))
      for (const p of d.people) for (let k = 0; k < p.left - p.inBoxes; k++) eatPortion(db, d.id, p.personId, { date: addDays(week.cookedOn, 6), meal: "lunch" }, end);
  } else {
    // Une boîte du congélo sortie la veille, pour le lendemain.
    const frozen = db.select().from(mealBoxes).where(and(eq(mealBoxes.sessionId, sessionId), eq(mealBoxes.status, "stock"), eq(mealBoxes.place, "freezer"))).get();
    if (frozen) thawBox(db, frozen.id, addDays(today, -1));
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
  // Un an d'Apple Santé, reçu comme l'app iPhone l'enverrait (vérifié puis rangé par l'import v2).
  const runFrom = runStart(today);
  let efforts: { date: string; effort: number }[] = [];
  for (const [k, id] of (["alex", "sam"] as const).entries()) {
    const payload = demoHealth(id, today, 101 + k * 17);
    // Alex : depuis la mise en route du module Course, ses courses suivent le plan et viennent avec leur détail (v2.1).
    if (id === "alex") {
      const before = payload.workouts.filter((w) => w.activity === "running" && w.start < runFrom);
      const course = demoRuns(today, 211, before.map((w) => ({ date: w.start.slice(0, 10), minutes: w.durationMin, km: w.distanceM ? w.distanceM / 1000 : null })));
      payload.workouts = [...payload.workouts.filter((w) => !(w.activity === "running" && w.start >= runFrom)), ...course.runs];
      efforts = course.efforts;
    }
    const parsed = parseV2(payload, at(today, "23:00"));
    if ("error" in parsed) throw new Error(`démo, Apple Santé : ${parsed.error}`);
    ingestV2(db, id, parsed);
  }
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

  await cookedWeek(db, h, calendar.previous, h.weeks.previous, { archive: true });
  await cookedWeek(db, h, calendar.current, h.weeks.current, { archive: false });
  const next = planWeek(db, calendar.next.start, h.weeks.next);
  await buildShoppingList(db, next.sel.map((x) => x.slug), { weekPlanId: next.planId, scales: Object.fromEntries(next.sel.map((x) => [x.slug, x.factor])) });

  // Course : Alex suit un plan depuis six semaines ; son ressenti après les dernières sorties.
  saveRunSettings(db, "alex", DEMO_RUN_SETTINGS, runFrom);
  db.update(runProfiles).set({ startedOn: runFrom }).where(eq(runProfiles.personId, "alex")).run();
  for (const e of efforts.slice(-4)) noteFeedback(db, "alex", { date: e.date, effort: e.effort, pain: 0, enjoy: e.effort <= 3 ? 4 : 3 });
  // Le plan lu chaque matin, comme si la page ou l'app l'avaient ouvert : les séances passées sont rangées
  // (faites, manquées) ; celle du jour est sur la montre (accusé de l'app).
  for (let d = runFrom; d <= today; d = addDays(d, 1)) syncPlan(db, "alex", at(d, "06:00"));
  const todays = watchPlans(db, "alex", at(today, "06:05")).plans.filter((p) => p.date === today);
  ackPlans(db, "alex", { scheduled: todays.map((p) => ({ id: p.id, version: p.version })), scheduler: { supported: true, authorized: true } }, at(today, "06:05"));

  setSetting(db, SETTING.setupDone, at(calendar.historyFrom, "19:00").toISOString());
}

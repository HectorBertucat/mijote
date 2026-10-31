// Prise en main (src/lib/tour/) : les étapes de la visite guidée, quand la proposer, les premiers pas de
// l’accueil qui se cochent à l’usage ; les images de démarrage iOS (src/lib/launch.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "@/lib/db/open";
import { cookSessions, mealBoxes, people, recipes, shoppingLists, weekPlans, weekRecipes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { FIRST_STEPS, firstSteps, offerTour, SAMPLE_DISHES, showFirstSteps, stepAfter, tourSteps, type FirstStepsFacts } from "@/lib/tour/core";
import { firstStepsFacts, markTourSeen, setFirstStepsHidden, tourView } from "@/lib/tour/store";
import { LAUNCH_SCREENS, launchSize, startupImages } from "@/lib/launch";
import { dishArt } from "@/lib/illus/dish";
import { setSetting, SETTING } from "@/lib/settings";
import { seedTest } from "./helpers";

const NONE: FirstStepsFacts = { target: false, dishes: false, list: false, session: false, boxes: false };
const ALL: FirstStepsFacts = { target: true, dishes: true, list: true, session: true, boxes: true };

// ─── Visite ───

test("visite : le cycle dans l’ordre, de la semaine au frigo, puis Santé et la fin", () => {
  const ids = tourSteps({ catalog: false, profiles: 2, desktop: true }).map((s) => s.id);
  assert.deepEqual(ids, ["cycle", "semaine", "courses", "session", "frigo", "sante", "recherche", "profil", "fin"]);
});

test("visite : la recherche ⌘K seulement au bureau, le profil seulement à deux ou plus", () => {
  const phoneSolo = tourSteps({ catalog: false, profiles: 1, desktop: false }).map((s) => s.id);
  assert.ok(!phoneSolo.includes("recherche"));
  assert.ok(!phoneSolo.includes("profil"));
  assert.equal(phoneSolo.at(-1), "fin");
  assert.ok(tourSteps({ catalog: false, profiles: 3, desktop: false }).some((s) => s.id === "profil"));
});

test("visite : le panier du drive n’est promis qu’avec un catalogue", () => {
  const body = (catalog: boolean) => tourSteps({ catalog, profiles: 1, desktop: false }).find((s) => s.id === "courses")!.body;
  assert.match(body(true), /drive/);
  assert.doesNotMatch(body(false), /drive|prix/);
});

test("visite : textes sans jargon, chaque étape ancrée sur un élément qui existe", () => {
  const anchors = new Set(["semaine", "courses", "frigo", "sante", "recherche", "profil", "premiers-pas"]);
  for (const s of tourSteps({ catalog: true, profiles: 2, desktop: true })) {
    assert.doesNotMatch(`${s.title} ${s.body}`, /unités?\b/i, s.id);
    assert.ok(s.title.length <= 40 && s.body.length <= 180, `${s.id} : court`);
    if (s.anchor) assert.ok(anchors.has(s.anchor), s.anchor);
  }
});

test("visite : les plats d’exemple se dessinent avec leurs ingrédients", () => {
  for (const d of SAMPLE_DISHES) assert.ok(dishArt(d).pieces.length >= 2, d.slug);
});

test("visite : avancer, reculer, sortir par la fin", () => {
  assert.equal(stepAfter(0, 5, 1), 1);
  assert.equal(stepAfter(0, 5, -1), 0);
  assert.equal(stepAfter(3, 5, -1), 2);
  assert.equal(stepAfter(4, 5, 1), null);
});

test("visite : proposée une fois après la mise en route, pas à qui cuisine déjà", () => {
  assert.equal(offerTour({ setupDone: true, seen: false, cooked: false }), true);
  assert.equal(offerTour({ setupDone: false, seen: false, cooked: false }), false);
  assert.equal(offerTour({ setupDone: true, seen: true, cooked: false }), false);
  assert.equal(offerTour({ setupDone: true, seen: false, cooked: true }), false);
});

// ─── Premiers pas ───

test("premiers pas : le prochain dans l’ordre du cycle, fini quand tout est fait", () => {
  const v = firstSteps({ ...NONE, target: true, list: true });
  assert.equal(v.done, 2);
  assert.equal(v.total, FIRST_STEPS.length);
  assert.equal(v.next, "dishes");
  assert.equal(v.complete, false);
  const all = firstSteps(ALL);
  assert.equal(all.next, null);
  assert.equal(all.complete, true);
});

test("premiers pas : affichés après la mise en route, jusqu’à la fin ou jusqu’à être masqués", () => {
  assert.equal(showFirstSteps({ setupDone: true, hidden: false, facts: NONE }), true);
  assert.equal(showFirstSteps({ setupDone: false, hidden: false, facts: NONE }), false);
  assert.equal(showFirstSteps({ setupDone: true, hidden: true, facts: NONE }), false);
  assert.equal(showFirstSteps({ setupDone: true, hidden: false, facts: ALL }), false);
});

test("premiers pas : lus en base, au fil de l’usage réel (Alex et Sam)", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  setSetting(db, SETTING.setupDone, "2026-10-31T10:00:00Z");
  assert.deepEqual(firstStepsFacts(db, "alex"), NONE);
  let v = tourView(db, "alex");
  assert.equal(v.offer, true);
  assert.equal(v.showSteps, true);

  db.update(people).set({ setupDoneAt: "2026-10-31T10:05:00Z" }).where(eq(people.id, "alex")).run();
  assert.equal(firstStepsFacts(db, "alex").target, true);
  assert.equal(firstStepsFacts(db, "sam").target, false, "la cible est celle du profil ouvert");

  const recipeId = "r-visite";
  db.insert(recipes).values({ id: recipeId, slug: "visite", name: "Plat de visite", servingsUnits: 8, fridgeDays: 4 }).run();
  db.insert(weekPlans).values({ id: "w1", weekStart: "2026-11-02" }).run();
  db.insert(weekRecipes).values({ id: "wr1", weekPlanId: "w1", recipeId }).run();
  db.insert(shoppingLists).values({ id: "l1", weekPlanId: "w1" }).run();
  // Une session test ne compte pas : c’est pour montrer l’appli.
  db.insert(cookSessions).values({ id: "s0", status: "prep", startedAt: "2026-11-01T09:00:00Z", test: true }).run();
  assert.equal(firstStepsFacts(db, "alex").session, false);
  db.insert(cookSessions).values({ id: "s1", status: "done", startedAt: "2026-11-01T09:00:00Z" }).run();
  v = tourView(db, "alex");
  assert.equal(v.offer, false, "on a cuisiné : la visite ne s’impose plus");
  assert.equal(v.steps.next, "boxes");

  db.insert(mealBoxes).values({ id: "b1", sessionId: "s1", recipeId, name: "Plat de visite", cookedOn: "2026-11-01", place: "fridge", fridgeDays: 4 }).run();
  v = tourView(db, "alex");
  assert.equal(v.steps.complete, true);
  assert.equal(v.showSteps, false, "tout est fait : la liste disparaît");
});

test("premiers pas et visite : retenus dans les réglages de l’instance", () => {
  const { db } = openDb(":memory:");
  seedTest(db);
  setSetting(db, SETTING.setupDone, "2026-10-31T10:00:00Z");
  markTourSeen(db);
  assert.equal(tourView(db, "alex").offer, false);
  setFirstStepsHidden(db, true);
  assert.equal(tourView(db, "alex").showSteps, false);
  assert.equal(tourView(db, "alex").hidden, true);
  setFirstStepsHidden(db, false);
  assert.equal(tourView(db, "alex").showSteps, true);
});

// ─── Images de démarrage iOS ───

test("démarrage iOS : une image par écran et par thème, tailles connues seulement", () => {
  const imgs = startupImages();
  assert.equal(imgs.length, LAUNCH_SCREENS.length * 2);
  assert.equal(new Set(imgs.map((i) => i.media)).size, imgs.length, "pas deux images pour le même écran");
  const iphone = imgs.find((i) => i.media.includes("(device-width: 393px)") && i.media.includes("dark"))!;
  assert.equal(iphone.url, "/lancement?w=1179&h=2556&theme=sombre");
  assert.deepEqual(launchSize(1179, 2556), { w: 1179, h: 2556 });
  assert.equal(launchSize(5000, 5000), null);
  assert.equal(launchSize(Number.NaN, 2556), null);
});

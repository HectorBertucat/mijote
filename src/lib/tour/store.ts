// Prise en main, côté base : ce que l’instance a déjà fait (les premiers pas) et ce qui est retenu dans
// app_settings (visite vue, liste masquée). Par instance : le foyer partage une semaine, des courses, un frigo ;
// seul le premier pas « Régler ta part » regarde le profil ouvert.
import { eq, isNotNull, isNull, and } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { cookSessions, mealBoxes, people, reserves, shoppingLists, weekRecipes } from "@/lib/db/schema";
import { weighedOnce } from "@/lib/reserve/batch";
import { currentBatch } from "@/lib/reserve/store";
import { getSetting, isSetupDone, SETTING, setSetting } from "@/lib/settings";
import { firstSteps, offerTour, showFirstSteps, type FirstStepsFacts, type PendingBatch } from "./core";

const any = (db: Db, table: typeof weekRecipes | typeof shoppingLists) => db.select({ id: table.id }).from(table).limit(1).get() != null;

export function firstStepsFacts(db: Db, profileId: string | null): FirstStepsFacts {
  const person = profileId ? db.select({ at: people.setupDoneAt }).from(people).where(eq(people.id, profileId)).get() : undefined;
  return {
    target: !!person?.at,
    dishes: any(db, weekRecipes),
    list: any(db, shoppingLists),
    session: db.select({ id: cookSessions.id }).from(cookSessions).where(and(isNotNull(cookSessions.startedAt), eq(cookSessions.test, false))).limit(1).get() != null,
    boxes: weighedOnce(db.select({ groups: reserves.groups }).from(reserves).all(), db.select({ id: mealBoxes.id }).from(mealBoxes).where(isNull(mealBoxes.reserveId)).limit(1).get() != null),
  };
}

/** Le batch du moment, s'il reste des plats à peser. */
export function pendingBatch(db: Db, now = new Date()): PendingBatch | null {
  const b = currentBatch(db, now);
  return b && b.summary.toWeigh > 0 ? { id: b.id, title: b.title, toWeigh: b.summary.toWeigh } : null;
}

/** Ce que l’accueil montre : la visite à proposer, la liste des premiers pas. */
export function tourView(db: Db, profileId: string | null) {
  const facts = firstStepsFacts(db, profileId);
  const setupDone = isSetupDone(db);
  const hidden = getSetting(db, SETTING.firstStepsHidden) != null;
  return {
    offer: offerTour({ setupDone, seen: getSetting(db, SETTING.tourSeen) != null, cooked: facts.session }),
    showSteps: showFirstSteps({ setupDone, hidden, facts }),
    hidden,
    steps: firstSteps(facts, facts.boxes ? null : pendingBatch(db)),
  };
}

export const markTourSeen = (db: Db) => setSetting(db, SETTING.tourSeen, new Date().toISOString());
export const setFirstStepsHidden = (db: Db, hidden: boolean) => setSetting(db, SETTING.firstStepsHidden, hidden ? new Date().toISOString() : null);

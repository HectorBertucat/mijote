// Outils partagés des tests de session (pas un fichier *.test.ts : il n'est pas lancé seul).
import fs from "fs";
import path from "path";
import { RecipeInput } from "@/lib/recipes/format";
import type { PlannerRecipe, PlannerResources } from "@/lib/session/planner";
import type { InferInsertModel } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { foodTemplates, people, preferences, workouts } from "@/lib/db/schema";
import { KB_TEMPLATE } from "@/lib/training/program";
import { RENFO_TEMPLATE } from "@/lib/training/renfo";
import { assignProgram, programById } from "@/lib/training/programs";
import { EQUIPMENT, EQUIPMENT_FIT } from "@/seed/base";
import { seedBase } from "@/seed/seed";

export const RES: PlannerResources = {
  equipment: EQUIPMENT.map((e) => ({ id: e.id, kind: e.kind, name: e.name, maxBatchG: e.maxBatchG ?? null, dimsJson: e.dimsJson ?? null, count: e.count ?? 1 })),
  fits: EQUIPMENT_FIT.map((f) => ({ equipmentId: f.equipmentId, hobId: f.hobId, preferred: f.preferred ?? true })),
};

export function load(file: string): PlannerRecipe {
  const r = RecipeInput.parse(JSON.parse(fs.readFileSync(path.join("src/seed/recipes", file), "utf8")));
  return {
    slug: r.slug,
    name: r.name,
    ingredients: r.ingredients.map((i, n) => ({ id: `${r.slug}-ing-${n}`, item: i.item, grams: i.grams, units: i.units, group: i.group, optional: i.optional, pantry: i.pantry, foodId: i.food })),
    steps: r.steps.map((s) => ({ ...s, bowls: s.bowls ?? [] })),
  };
}


// ─── Foyer de test : Alex et Sam (une instance neuve n'a personne : la mise en route les crée) ───

const WORKOUTS: InferInsertModel<typeof workouts>[] = [
  { id: "kb-2026-09-30", personId: "alex", date: "2026-09-30", ts: 1790765962727, type: "A", minutes: 49, note: null, entries: [{ ex: "goblet", sets: [18,  18,  18], level: 0 }, { ex: "row", sets: [14,  13,  13], level: 0 }, { ex: "pushup", sets: [8,  8,  8], level: 0 }, { ex: "rdl", sets: [6,  8,  8], level: 0 }, { ex: "curl", sets: [12,  12], level: 0 }, { ex: "triceps", sets: [6,  5], level: 0 }, { ex: "deadbug", sets: [12,  12], level: 0 }, { ex: "plank", sets: [25,  25], level: 1 }] },
  { id: "kb-2026-10-02", personId: "alex", date: "2026-10-02", ts: 1790937836957, type: "B", minutes: 37, note: null, entries: [{ ex: "bulgare", sets: [8,  8,  8], level: 1 }, { ex: "floorpress", sets: [10,  10,  10], level: 0 }, { ex: "rowPause", sets: [10,  10,  10], level: 0 }, { ex: "press", sets: [5,  5,  5], level: 0 }, { ex: "swing", sets: [80], level: 0 }] },
  { id: "kb-2026-10-07", personId: "alex", date: "2026-10-07", ts: 1791372016279, type: "A", minutes: 29, note: null, entries: [{ ex: "goblet", sets: [18,  18,  18], level: 0 }, { ex: "row", sets: [14,  14,  14], level: 0 }, { ex: "pushup", sets: [10,  10,  10], level: 0 }, { ex: "rdl", sets: [6,  6,  6], level: 1 }, { ex: "curl", sets: [12,  12], level: 0 }, { ex: "triceps", sets: [6,  6], level: 0 }] },
  { id: "kb-2026-10-09", personId: "alex", date: "2026-10-09", ts: 1791543512897, type: "B", minutes: 34, note: null, entries: [{ ex: "bulgare", sets: [8,  8,  8], level: 1 }, { ex: "floorpress", sets: [10,  10,  10], level: 0 }, { ex: "rowPause", sets: [10,  12,  12], level: 0 }, { ex: "press", sets: [6,  6,  6], level: 0 }, { ex: "swing", sets: [80], level: 0 }] },
  { id: "kb-2026-10-19", personId: "alex", date: "2026-10-19", ts: 1792402787701, type: "A", minutes: 27, note: null, entries: [{ ex: "goblet", sets: [18,  18,  18], level: 0 }, { ex: "row", sets: [14,  14,  14], level: 0 }, { ex: "pushup", sets: [12,  12,  12], level: 0 }, { ex: "rdl", sets: [8,  8,  8], level: 1 }, { ex: "curl", sets: [12,  14], level: 0 }, { ex: "triceps", sets: [6,  6], level: 0 }] },
];

/** Goûts du foyer de test (ingrédients et plats que chacun n'aime pas). */
export const TEST_PREFERENCES: InferInsertModel<typeof preferences>[] = [
  { id: "pref-t1", personId: "alex", kind: "dislike", text: "Câpres", tags: ["ingredient"] },
  { id: "pref-t2", personId: "alex", kind: "dislike", text: "Olives", tags: ["ingredient"] },
  { id: "pref-t3", personId: "alex", kind: "dislike", text: "Cornichons", tags: ["ingredient"] },
  { id: "pref-t4", personId: "alex", kind: "dislike", text: "L'acidité en général (mais aime le citron)", tags: ["gout", "acidite"] },
  { id: "pref-t5", personId: "sam", kind: "dislike", text: "Bœuf haché sec", tags: ["ingredient"] },
  { id: "pref-t6", personId: "sam", kind: "dislike", text: "Brocoli", tags: ["ingredient"] },
  { id: "pref-t7", personId: "sam", kind: "dislike", text: "Concombre", tags: ["ingredient"] },
  { id: "pref-t8", personId: "sam", kind: "dislike", text: "Hachis parmentier", tags: ["plat"] },
];

/** Instance de test : seed de base, deux personnes, leurs goûts, l'habitude du matin d'Alex, leurs programmes. Idempotent. */
export function seedTest(db: Db) {
  seedBase(db);
  db.insert(people)
    .values([
      { id: "alex", name: "Alex", rank: 0, portionUnits: 5, sex: "m", birthDate: "1990-06-13", heightCm: 180, activity: "moderate", goal: "recomp", ratePct: -0.4, proteinG: 160 },
      { id: "sam", name: "Sam", rank: 1, portionUnits: 4, sex: "f", birthDate: "1992-03-08", activity: "light" },
    ])
    .onConflictDoNothing()
    .run();
  for (const p of TEST_PREFERENCES) db.insert(preferences).values(p).onConflictDoNothing().run();
  db.insert(foodTemplates)
    .values({
      id: "tpl-shaker-alex",
      personId: "alex",
      label: "Shaker du matin (skyr, lait, protéine, banane)",
      meal: "breakfast",
      // Macros recalculées depuis les aliments (src/lib/eaters/habits.ts).
      items: [
        { food: "skyr", grams: 150 },
        { food: "lait_demi", grams: 200 },
        { food: "whey", grams: 25 },
        { food: "banane", grams: 60 },
      ],
      kcal: 336,
      proteinG: 41.8,
      carbsG: 29.6,
      fatG: 5.2,
      weekdays: [0, 1, 2, 3, 4],
    })
    .onConflictDoNothing()
    .run();
  for (const w of WORKOUTS) db.insert(workouts).values(w).onConflictDoNothing().run();
  if (!programById(db, "kb12")) assignProgram(db, "alex", KB_TEMPLATE, "modele", null, "kb12");
  if (!programById(db, "sam-renfo")) assignProgram(db, "sam", RENFO_TEMPLATE, "modele", null, "sam-renfo");
}

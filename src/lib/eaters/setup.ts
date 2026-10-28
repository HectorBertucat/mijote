// Mise en route d'un mangeur (/sante/demarrer) : ce qu'il mange hors batch, ce qu'il n'aime pas,
// et la date à laquelle il a fini. Le profil (taille, objectif…) passe par health/store.
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { people, preferences } from "@/lib/db/schema";

/** Repères pour « ce que tu manges hors batch » (petit-déjeuner, en-cas), par jour. */
export const OUTSIDE_PRESETS = [
  { id: "rien", label: "Rien ou presque", hint: "café, thé", kcal: 0, protein: 0 },
  { id: "leger", label: "Léger", hint: "un fruit, un café au lait", kcal: 150, protein: 4 },
  { id: "classique", label: "Petit-déjeuner", hint: "tartines ou céréales, yaourt", kcal: 350, protein: 12 },
  { id: "complet", label: "Petit-déjeuner et en-cas", hint: "petit-déjeuner, goûter", kcal: 550, protein: 20 },
] as const;

export function setOutside(db: Db, personId: string, kcal: number, protein: number) {
  if (!(kcal >= 0 && kcal <= 2000)) throw new Error("Hors batch : entre 0 et 2 000 kcal par jour.");
  if (!(protein >= 0 && protein <= 150)) throw new Error("Hors batch : entre 0 et 150 g de protéines par jour.");
  db.update(people).set({ outsideKcal: Math.round(kcal), outsideProteinG: Math.round(protein) }).where(eq(people.id, personId)).run();
}

export const markSetupDone = (db: Db, personId: string, at = new Date().toISOString()) => db.update(people).set({ setupDoneAt: at }).where(eq(people.id, personId)).run();

/** Une préférence retirée dans l'appli garde sa ligne (le seed ne la remet pas) avec ce tag. */
export const REMOVED_TAG = "retiré";

export function listDislikes(db: Db, personId: string) {
  return db
    .select({ id: preferences.id, text: preferences.text, tags: preferences.tags })
    .from(preferences)
    .where(and(eq(preferences.personId, personId), eq(preferences.kind, "dislike")))
    .all()
    .filter((p) => !p.tags.includes(REMOVED_TAG));
}

/** « Brocoli, concombre » → une préférence par aliment (cherchée dans les ingrédients). */
export function addDislikes(db: Db, personId: string, text: string) {
  const items = text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60);
  const known = new Set(listDislikes(db, personId).map((p) => p.text.toLowerCase()));
  for (const t of items) {
    if (known.has(t.toLowerCase())) continue;
    db.insert(preferences).values({ id: randomUUID(), personId, kind: "dislike", text: t.charAt(0).toUpperCase() + t.slice(1), tags: ["ingredient"] }).run();
  }
}

export function removeDislike(db: Db, personId: string, id: string) {
  const p = db.select().from(preferences).where(and(eq(preferences.id, id), eq(preferences.personId, personId))).get();
  if (!p) return;
  if (p.id.startsWith("pref-")) db.update(preferences).set({ tags: [REMOVED_TAG] }).where(eq(preferences.id, id)).run();
  else db.delete(preferences).where(eq(preferences.id, id)).run();
}

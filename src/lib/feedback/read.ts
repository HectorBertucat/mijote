// Lectures des retours de goût (taste_feedback), sans autre dépendance que le schéma et ./core : la
// Semaine, l'assistant et l'atelier les lisent sans tirer la réserve ni l'atelier.
import { desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { people, recipes, tasteFeedback } from "@/lib/db/schema";
import { compactLine, isTag, issuesOf, latestByPerson, tasteMarks, tastePenalty, type Feedback, type TasteMark, type TasteTag } from "./core";

export const toFeedback = (r: typeof tasteFeedback.$inferSelect, name: string | null): Feedback => ({
  id: r.id,
  recipeId: r.recipeId,
  personId: r.personId,
  name: name ?? "?",
  rating: r.rating,
  tags: r.tags.filter(isTag),
  note: r.note,
  at: r.createdAt,
});

/** Tous les retours (ou ceux de ces recettes), le plus récent d'abord. */
export function listFeedback(db: Db, recipeIds?: string[]): Feedback[] {
  if (recipeIds && !recipeIds.length) return [];
  const q = db.select({ f: tasteFeedback, name: people.name }).from(tasteFeedback).leftJoin(people, eq(people.id, tasteFeedback.personId));
  const rows = (recipeIds ? q.where(inArray(tasteFeedback.recipeId, recipeIds)) : q).orderBy(desc(tasteFeedback.createdAt)).all();
  return rows.map(({ f, name }) => toFeedback(f, name));
}

/** Les retours d'une recette : le dernier de chacun, et l'historique. */
export function recipeFeedback(db: Db, recipeId: string): { latest: Feedback[]; all: Feedback[]; issues: TasteTag[] } {
  const all = listFeedback(db, [recipeId]);
  const latest = latestByPerson(all);
  return { latest, all, issues: issuesOf(latest) };
}

/** Les marques de goût de toute la bibliothèque, par slug (Semaine). */
export function loadTasteMarks(db: Db): Map<string, TasteMark> {
  const rs = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name, parentId: recipes.parentId, createdAt: recipes.createdAt, status: recipes.status }).from(recipes).all();
  return tasteMarks(rs, listFeedback(db));
}

/** Les retours en cours de chaque recette, en une ligne (assistant, atelier) : slug → « Sam bof (sec) ». */
export function compactTastes(db: Db): Map<string, string> {
  const slugOf = new Map(db.select({ id: recipes.id, slug: recipes.slug }).from(recipes).all().map((r) => [r.id, r.slug]));
  const by = new Map<string, Feedback[]>();
  for (const f of listFeedback(db)) by.set(f.recipeId, [...(by.get(f.recipeId) ?? []), f]);
  const out = new Map<string, string>();
  for (const [id, list] of by) {
    const slug = slugOf.get(id);
    if (slug) out.set(slug, compactLine(latestByPerson(list)));
  }
  return out;
}

/** Les points de la Semaine par slug (src/lib/week/propose.ts, ScoreContext.taste). */
export function tastePoints(marks: Map<string, TasteMark>): Map<string, number> {
  return new Map([...marks].map(([slug, m]) => [slug, tastePenalty(m)]));
}

/** Les retours en cours d'une recette pour l'atelier (« Ajuster » : option « D'après les retours »), ou null. */
export function recipeTasteLine(db: Db, slug: string): { line: string; meh: boolean } | null {
  const id = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, slug)).get()?.id;
  if (!id) return null;
  const latest = latestByPerson(listFeedback(db, [id]));
  return latest.length ? { line: compactLine(latest), meh: latest.some((f) => f.rating === "meh") } : null;
}

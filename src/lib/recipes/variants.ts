// Variantes d'une recette (recipes.parent_id, toujours la racine) : la famille d'une fiche
// et les écarts calculés en code avec l'originale (kcal, protéines par part, coût).
import { asc, eq, or } from "drizzle-orm";
import type { Db } from "@/lib/db/open";
import { people, recipes } from "@/lib/db/schema";
import { recipeCost } from "@/lib/costs";
import { DEFAULT_PORTION_UNITS } from "@/lib/nutrition/compute";

export interface FamilyMember {
  id: string;
  slug: string;
  name: string;
  status: string;
  /** Part de la première personne du foyer, si la nutrition est connue. */
  kcal: number | null;
  protein: number | null;
  /** Coût pratique de cette part (€), si on a un prix. */
  costH: number | null;
  /** Écarts avec l'originale (null si l'une des deux valeurs manque). */
  delta: { kcal: number | null; protein: number | null; costH: number | null };
}

export interface Family {
  root: FamilyMember;
  /** Variantes de la racine, la plus récente d'abord. */
  variants: FamilyMember[];
  /** La fiche affichée est-elle la racine ? */
  isRoot: boolean;
}

/** La recette d'origine d'une fiche : elle-même si ce n'est pas une variante. */
export function rootOf(db: Db, recipeId: string): { id: string; slug: string; name: string } | null {
  const r = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name, parentId: recipes.parentId }).from(recipes).where(eq(recipes.id, recipeId)).get();
  if (!r) return null;
  if (!r.parentId) return { id: r.id, slug: r.slug, name: r.name };
  const p = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name }).from(recipes).where(eq(recipes.id, r.parentId)).get();
  return p ?? { id: r.id, slug: r.slug, name: r.name };
}

export function familyOf(db: Db, recipeId: string): Family | null {
  const root = rootOf(db, recipeId);
  if (!root) return null;
  const rows = db
    .select({ id: recipes.id, slug: recipes.slug, name: recipes.name, status: recipes.status, kcalUnit: recipes.kcalUnit, proteinUnit: recipes.proteinUnit, createdAt: recipes.createdAt, parentId: recipes.parentId })
    .from(recipes)
    .where(or(eq(recipes.id, root.id), eq(recipes.parentId, root.id)))
    .orderBy(asc(recipes.createdAt))
    .all()
    .filter((r) => r.id === root.id || r.status !== "archived");
  const H = db.select({ u: people.portionUnits }).from(people).orderBy(asc(people.rank)).get()?.u ?? DEFAULT_PORTION_UNITS;
  const base = rows.map((r) => {
    const cost = recipeCost(db, r.id);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      createdAt: r.createdAt,
      kcal: r.kcalUnit != null ? Math.round(r.kcalUnit * H) : null,
      protein: r.proteinUnit != null ? Math.round(r.proteinUnit * H) : null,
      costH: cost && cost.kind !== "none" && cost.partLead ? cost.partLead.practical : null,
    };
  });
  const r0 = base.find((r) => r.id === root.id)!;
  const diff = (a: number | null, b: number | null, k = 1) => (a == null || b == null ? null : Math.round((a - b) * k) / k);
  const member = (m: (typeof base)[number]): FamilyMember => ({
    id: m.id,
    slug: m.slug,
    name: m.name,
    status: m.status,
    kcal: m.kcal,
    protein: m.protein,
    costH: m.costH,
    delta: { kcal: diff(m.kcal, r0.kcal), protein: diff(m.protein, r0.protein), costH: diff(m.costH, r0.costH, 100) },
  });
  const variants = base
    .filter((m) => m.id !== root.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(member);
  return { root: member(r0), variants, isRoot: recipeId === root.id };
}

/** Slugs de toute la famille (racine et variantes) : le même plat, à ne pas proposer pour un reste. */
export function familySlugs(db: Db, recipeId: string): Set<string> {
  const root = rootOf(db, recipeId);
  if (!root) return new Set();
  return new Set(
    db
      .select({ slug: recipes.slug })
      .from(recipes)
      .where(or(eq(recipes.id, root.id), eq(recipes.parentId, root.id)))
      .all()
      .map((r) => r.slug)
  );
}

/** Pour la bibliothèque : nombre de variantes par racine, et nom de la racine de chaque variante. */
export function variantLinks(db: Db): { count: Map<string, number>; parentOf: Map<string, { id: string; slug: string; name: string }> } {
  const count = new Map<string, number>();
  const parentOf = new Map<string, { id: string; slug: string; name: string }>();
  const all = db.select({ id: recipes.id, slug: recipes.slug, name: recipes.name, parentId: recipes.parentId, status: recipes.status }).from(recipes).all();
  const byId = new Map(all.map((r) => [r.id, r]));
  for (const r of all) {
    if (!r.parentId || r.status === "archived") continue;
    count.set(r.parentId, (count.get(r.parentId) ?? 0) + 1);
    const p = byId.get(r.parentId);
    if (p) parentOf.set(r.id, { id: p.id, slug: p.slug, name: p.name });
  }
  return { count, parentOf };
}

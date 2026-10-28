// Reste de paquet d'une variante : quelles recettes de la bibliothèque le finissent le mieux.
// Une recette « convient » quand ce qu'elle prend de l'aliment tient dans le reste ; la plus
// proche du reste passe en premier. La recette elle-même et sa famille (originale, variantes)
// sont exclues : c'est le même plat. Pur et testé.
import { gramsOf } from "@/lib/nutrition/compute";
import type { Leftover, LibraryRecipe } from "./verify";
import { norm } from "./verify";

export interface LeftoverSuggestion {
  slug: string;
  name: string;
  /** Ce que la recette prend de l'aliment (g), si on le sait. */
  usesG: number | null;
  /** Vrai si la recette finit le reste sans racheter (elle en prend au plus le reste, à 15 % près). */
  fits: boolean;
}

export type RankedLeftover = Omit<Leftover, "suggestions"> & { suggestions: LeftoverSuggestion[] };

const keyOf = (item: string) => norm(item).split(" ").filter((w) => w.length >= 4)[0];

export function rankLeftovers(leftovers: Leftover[], library: LibraryRecipe[], exclude: Set<string>, limit = 3): RankedLeftover[] {
  return leftovers.map((l) => {
    const key = keyOf(l.item);
    const byFood = l.food && l.food !== "zero";
    const found: LeftoverSuggestion[] = [];
    for (const r of library) {
      if (exclude.has(r.slug) || r.status === "archived") continue;
      const hits = r.ingredients.filter((x) => (byFood ? x.food === l.food : key ? norm(x.item).includes(key) : false));
      if (!hits.length) continue;
      const grams = hits.map((x) => gramsOf({ item: x.item, food: x.food, grams: x.grams, units: x.units }));
      const usesG = grams.every((g) => g == null) ? null : Math.round(grams.reduce<number>((t, g) => t + (g ?? 0), 0));
      found.push({ slug: r.slug, name: r.name, usesG, fits: usesG != null && usesG <= l.restG * 1.15 });
    }
    // D'abord celles qui finissent le reste (la plus proche du reste en tête), puis les autres (la plus petite d'abord).
    found.sort((a, b) => {
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      if (a.usesG == null || b.usesG == null) return a.usesG == null ? (b.usesG == null ? 0 : 1) : -1;
      return a.fits ? l.restG - a.usesG - (l.restG - b.usesG) : a.usesG - b.usesG;
    });
    return { ...l, suggestions: found.slice(0, limit) };
  });
}

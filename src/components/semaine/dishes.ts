// Ce qu'il faut à DishBox pour dessiner la boîte de chaque plat (Semaine, Composer) : nom et ingrédients,
// lus en une requête pour toute la bibliothèque. Les étapes, quand on les a, affinent le modèle (gratiné, mixé…).
import type { Db } from "@/lib/db/open";
import type { DishRecipe, DishStep } from "@/lib/illus/dish";
import { loadIngredients } from "@/lib/week/store";

export function dishRecipes(db: Db, recipes: { id: string; slug: string; name: string; steps?: DishStep[] }[]): Map<string, DishRecipe> {
  const ings = loadIngredients(db, recipes.map((r) => r.id));
  return new Map(recipes.map((r) => [r.slug, { slug: r.slug, name: r.name, ingredients: ings.get(r.id) ?? [], steps: r.steps }]));
}

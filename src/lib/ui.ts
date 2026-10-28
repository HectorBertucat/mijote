// Petites aides d'affichage partagées.

// Une teinte par recette (stable, tirée du slug) : étiquette de la recette et ses bols.
// Les couleurs viennent des tokens recipe-1…8 (src/app/cuisine-tokens.css), clair et sombre.
const RECIPE_TOKENS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--c-recipe-${n})`);
export function recipeColor(slug: string): string {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return RECIPE_TOKENS[h % RECIPE_TOKENS.length];
}

export const BOWL_COLORS = RECIPE_TOKENS;
export const bowlColor = (letter: string) => BOWL_COLORS[(letter.charCodeAt(0) - 65 + BOWL_COLORS.length) % BOWL_COLORS.length];

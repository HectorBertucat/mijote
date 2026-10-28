// RecipeTile (étiquette carrée de recette) et BowlBadge (pastille ronde lettrée d'un bol). Sans état.
// `color` : 1 à 8 (token recipe-N) ou une valeur CSS déjà résolue, p. ex. recipeColor(slug) de src/lib/ui.ts.
import type { CSSProperties, ReactNode } from "react";

export type RecipeColor = number | string;
/** Couleur d'une recette en valeur CSS (var(--c-recipe-N)). */
export function recipeVar(color: RecipeColor): string {
  return typeof color === "number" ? `var(--c-recipe-${((Math.round(color) - 1) % 8 + 8) % 8 + 1})` : color;
}
/** Lettres d'une étiquette : les deux premières du premier mot (« Chasseur de porc » → « Ch »). Passer `children` pour forcer. */
export function recipeInitials(name: string): string {
  const w = name.replace(/[^\p{L}\s-]/gu, "").trim().split(/\s+/)[0] ?? "";
  return w.slice(0, 1).toUpperCase() + w.slice(1, 2).toLowerCase();
}

const TILE = { sm: "size-7 rounded-[6px] text-[12px]", md: "size-11 rounded-[8px] text-[18px]", lg: "size-16 rounded-[12px] text-[26px]" } as const;

/** Étiquette carrée pleine aux couleurs de la recette, avec 2 lettres. Tailles sm 28, md 44, lg 64. `title` = nom complet. */
export function RecipeTile({ color, children, name, size = "md", className = "" }: { color: RecipeColor; children?: ReactNode; name?: string; size?: keyof typeof TILE; className?: string }) {
  return (
    <span
      title={name}
      aria-hidden={name ? undefined : true}
      className={`relative inline-grid shrink-0 place-items-center bg-[var(--rc)] font-display font-extrabold tracking-[-0.02em] text-on-recipe [font-stretch:90%] ${TILE[size]} ${className}`}
      style={{ "--rc": recipeVar(color) } as CSSProperties}
    >
      {children ?? (name ? recipeInitials(name) : null)}
    </span>
  );
}

const BOWL = {
  xs: "size-[22px] border-2 text-[11px]",
  sm: "size-7 border-2 text-[13px]",
  md: "size-10 border-[2.5px] text-[18px]",
  lg: "size-16 border-[3px] text-[30px]",
  xl: "size-24 border-4 text-[48px]",
} as const;

/** Bol de prep : rond teinté, bord et lettre à la couleur de la recette. Tailles xs 22, sm 28, md 40, lg 64, xl 96 (session, lu à 1 m). */
export function BowlBadge({ color, letter, size = "md", label, className = "" }: { color: RecipeColor; letter: string; size?: keyof typeof BOWL; label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      className={`inline-grid shrink-0 place-items-center rounded-full border-[var(--rc)] bg-[color-mix(in_srgb,var(--rc)_16%,var(--c-surface))] font-display font-extrabold leading-none text-[var(--rc)] ${BOWL[size]} ${className}`}
      style={{ "--rc": recipeVar(color) } as CSSProperties}
    >
      {letter}
    </span>
  );
}

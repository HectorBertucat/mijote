// RecipeTile (le plat en petit : sa boîte sur un carré de vichy) et BowlBadge (pastille ronde lettrée d’un bol). Sans état.
// `color` : 1 à 8 (token recipe-N) ou une valeur CSS déjà résolue, p. ex. recipeColor(slug) de src/lib/ui.ts.
import type { CSSProperties, ReactNode } from "react";

export type RecipeColor = number | string;
/** Couleur d’une recette en valeur CSS (var(--c-recipe-N)). */
export function recipeVar(color: RecipeColor): string {
  return typeof color === "number" ? `var(--c-recipe-${((Math.round(color) - 1) % 8 + 8) % 8 + 1})` : color;
}
/** Lettres d’une étiquette : les deux premières du premier mot (« Chasseur de porc » → « Ch »). Passer `children` pour forcer. */
export function recipeInitials(name: string): string {
  const w = name.replace(/[^\p{L}\s-]/gu, "").trim().split(/\s+/)[0] ?? "";
  return w.slice(0, 1).toUpperCase() + w.slice(1, 2).toLowerCase();
}

const TILE = { sm: "size-7", md: "size-11", lg: "size-16" } as const;
const GLYPH = { sm: 22, md: 34, lg: 50 } as const;

/**
 * Le plat en petit : sa boîte de verre (couvercle et contenu à la couleur de la recette) sur un carré de nappe
 * vichy. Remplace l’ancien monogramme « Ch », « Bu » (v3, docs/design/systeme.md § Signatures). Pour la boîte
 * composée à partir des ingrédients, voir DishBox. `children` force un contenu (cas rares). `title` = nom complet.
 */
export function RecipeTile({ color, children, name, size = "md", className = "" }: { color: RecipeColor; children?: ReactNode; name?: string; size?: keyof typeof TILE; className?: string }) {
  const vichy = "color-mix(in srgb, var(--rc) 22%, transparent)";
  return (
    <span
      title={name}
      role={name ? "img" : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-[4px] bg-bg ${TILE[size]} ${className}`}
      style={{
        "--rc": recipeVar(color),
        backgroundImage: `linear-gradient(90deg, ${vichy} 50%, transparent 50%), linear-gradient(${vichy} 50%, transparent 50%)`,
        backgroundSize: size === "sm" ? "7px 7px" : "11px 11px",
      } as CSSProperties}
    >
      {children ?? (
        <svg viewBox="0 0 56 44" width={GLYPH[size]} height={(GLYPH[size] * 44) / 56} aria-hidden>
          <rect x="4" y="12" width="48" height="29" rx="6" fill="var(--i-glass)" stroke="var(--i-line)" strokeWidth="2.6" />
          <rect x="8" y="21" width="40" height="16" rx="3" fill="color-mix(in srgb, var(--rc) 62%, var(--i-paper))" />
          <rect x="2" y="6" width="52" height="8" rx="3" fill="var(--c-accent)" stroke="var(--i-line)" strokeWidth="2.6" />
        </svg>
      )}
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

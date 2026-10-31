"use client";

// Illustrations animées de la banque (src/lib/illus/) : un geste de cuisine ou un aliment.
// Utilisables partout. `live` anime le dessin (étape en cours, bol à prendre) ; sinon il bouge
// seulement au survol. Un aliment sans dessin propre prend celui que l’IA a dessiné pour cette
// instance (table food_art, filtré par sanitizeIllu), posé par le layout dans CustomArtContext.
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { artKey } from "@/lib/illus/sanitize";
import { ACTIONS, FOODS, type ActionId, type FoodArtId } from "@/lib/illus/art";
import { actionArt, foodArt } from "@/lib/illus/resolve";

const SIZES = { xs: 20, s: 28, m: 40, l: 64, xl: 96, xxl: 128 } as const;
export type IlluSize = keyof typeof SIZES | number;

type Common = { size?: IlluSize; live?: boolean; label?: string; className?: string; /** Accepte les variables CSS : { "--tile": "var(--c-recipe-3)" }. */ style?: CSSProperties | Record<`--${string}`, string> };

function Svg({ svg, label, size = "m", live = false, className = "", style }: Common & { svg: string }) {
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    <svg
      className={`illu ${live ? "is-live" : ""} ${className}`}
      style={style as CSSProperties}
      width={px}
      height={px}
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--i-line)"
      strokeWidth={2.2}
      strokeLinejoin="round"
      strokeLinecap="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Dessins de src/lib/illus/art.ts, ou dessins de l’IA passés par la liste blanche de sanitizeIllu.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Dessins d’aliments de l’IA (clé artKey → fragment SVG filtré). */
const CustomArtContext = createContext<Record<string, string>>({});
export function CustomArtProvider({ art, children }: { art: Record<string, string>; children: ReactNode }) {
  return <CustomArtContext value={art}>{children}</CustomArtContext>;
}

/** Un aliment : `food` (id de la table nutritionnelle) et/ou `item` (le nom de l’ingrédient). */
export function FoodIllu({ food, item = "", id, ...rest }: Common & { food?: string | null; item?: string; id?: FoodArtId }) {
  const custom = useContext(CustomArtContext);
  if (id) return <Svg svg={FOODS[id].svg} {...rest} />;
  const r = foodArt(food, item);
  const own = !r.exact && item ? custom[artKey(item)] : undefined;
  return <Svg svg={own ?? FOODS[r.id].svg} {...rest} />;
}

/** Le geste d’une étape ou d’une sous-étape, deviné à son texte (sinon à son type). */
export function StepIllu({ kind = "", text = "", id, label, ...rest }: Common & { kind?: string; text?: string; id?: ActionId }) {
  const art = ACTIONS[id ?? actionArt(kind, text).id];
  return <Svg svg={art.svg} label={label ?? art.label} {...rest} />;
}

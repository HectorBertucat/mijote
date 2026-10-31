// La boîte (docs/design/systeme.md, « Signatures ») : la boîte de verre du plat, dessinée à partir de
// ses ingrédients (dishArt, src/lib/illus/dish.ts), couvercle cocotte, posée sur la nappe vichy de la
// couleur de la recette. Elle remplace le monogramme. Sans état ni effet : composant serveur, rendu
// en liste sans calcul côté client. `steam` dessine la vapeur, `live` l'anime (rien ne bouge avec
// prefers-reduced-motion, voir illus.css).
import type { CSSProperties } from "react";
import { FOODS } from "@/lib/illus/art";
import { DISH_GLASS as G, dishArt, type DishArt, type DishRecipe, type Dot, type Piece } from "@/lib/illus/dish";
import { recipeColor } from "@/lib/ui";
import { recipeVar, type RecipeColor } from "./recipe";

const v = (name: string) => `var(--i-${name})`;

const SIZE = {
  sm: { frame: "size-14 rounded-[8px]", box: "w-[50px]", check: 5 },
  md: { frame: "h-24 w-32 rounded-[14px]", box: "w-[112px]", check: 8 },
  lg: { frame: "h-48 w-64 rounded-[14px]", box: "w-[224px]", check: 12 },
  hero: { frame: "h-[clamp(200px,34vw,360px)] w-full", box: "w-[min(440px,78%)]", check: 16 },
} as const;
export type DishSize = keyof typeof SIZE;

/** Nappe vichy en CSS : deux rayures de la couleur du plat, fondues sur le papier. */
export function vichy(color: string, check: number): CSSProperties {
  return {
    "--rc": color,
    "--vc": `${check}px`,
    backgroundColor: "var(--c-bg)",
    backgroundImage: [
      "repeating-linear-gradient(0deg, transparent 0 var(--vc), color-mix(in srgb, var(--rc) 14%, transparent) var(--vc) calc(var(--vc) * 2))",
      "repeating-linear-gradient(90deg, color-mix(in srgb, var(--rc) 9%, var(--c-bg)) 0 var(--vc), color-mix(in srgb, var(--rc) 22%, var(--c-bg)) var(--vc) calc(var(--vc) * 2))",
    ].join(", "),
  } as CSSProperties;
}

// Morceau générique (aliment sans dessin de morceau), dans le repère 64 × 64 des dessins.
const CHUNK = `<path d="M10 36 Q8 22 24 20 Q40 14 50 26 Q58 38 46 46 Q30 52 18 46 Q10 44 10 36 Z" fill="${v("cream-2")}"/><path d="M20 28 Q28 24 34 26" fill="none" stroke="${v("shine")}" stroke-width="3"/>`;

function PieceUse({ p, pid }: { p: Piece; pid: string }) {
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${p.scale}) rotate(${p.rotate} 32 32)`} strokeWidth={+(1.25 / p.scale).toFixed(2)}>
      <use href={`#${pid}-${p.art ?? "chunk"}`} />
    </g>
  );
}

function Finish({ art }: { art: DishArt }) {
  const f = art.finish;
  if (!f) return null;
  if (f.kind === "citron")
    return f.dots.map((d, i) => {
      const lime = f.art === "citron_vert";
      return (
        <g key={i} transform={`rotate(${d.rotate} ${d.x} ${d.y})`} strokeWidth={1.4}>
          <circle cx={d.x} cy={d.y} r={d.r} fill={v(lime ? "lime" : "lemon")} />
          <circle cx={d.x} cy={d.y} r={d.r - 2} fill={v(lime ? "lime-pulp" : "lemon-pulp")} stroke="none" />
          <path d={`M${d.x - d.r + 2} ${d.y} H${d.x + d.r - 2} M${d.x} ${d.y - d.r + 2} V${d.y + d.r - 2}`} strokeWidth={0.9} />
        </g>
      );
    });
  const seeds = f.kind === "graines";
  return f.dots.map((d: Dot, i) => (
    <ellipse
      key={i}
      cx={d.x}
      cy={d.y}
      rx={seeds ? d.r : d.r * 2.2}
      ry={seeds ? d.r * 0.6 : d.r}
      transform={`rotate(${d.rotate} ${d.x} ${d.y})`}
      fill={seeds ? v("grain") : v(i % 3 ? "leaf" : "herb")}
      strokeWidth={0.7}
    />
  ));
}

function Contents({ art, pid }: { art: DishArt; pid: string }) {
  const s = art.sauce.area;
  const side = art.side;
  return (
    <>
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={9} fill={art.sauce.fill} stroke="none" />
      {art.model === "veloute" && (
        <path
          d={`M${s.x + 14} ${s.y + 18} Q${s.x + s.w / 2} ${s.y + 6} ${s.x + s.w - 18} ${s.y + 20} Q${s.x + s.w / 2} ${s.y + 30} ${s.x + 22} ${s.y + 24}`}
          fill="none"
          stroke={v("cream")}
          strokeWidth={3}
          opacity={0.85}
        />
      )}
      {side && (
        <>
          <rect x={side.area.x} y={side.area.y} width={side.area.w} height={side.area.h} rx={9} fill={side.fill} stroke="none" />
          {side.kind === "riz" &&
            side.grains.map((d, i) => <ellipse key={i} cx={d.x} cy={d.y} rx={d.r * 2} ry={d.r} transform={`rotate(${d.rotate} ${d.x} ${d.y})`} fill={v("rice")} strokeWidth={0.8} />)}
          {side.kind === "semoule" && side.grains.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={v("grain")} stroke={v("potato-2")} strokeWidth={0.5} />)}
          {side.kind === "pates" &&
            side.grains.map((d, i) => (
              <rect key={i} x={d.x - d.r * 2} y={d.y - d.r} width={d.r * 4} height={d.r * 2} rx={d.r} transform={`rotate(${d.rotate} ${d.x} ${d.y})`} fill={v("pasta")} strokeWidth={1} />
            ))}
          {side.kind === "pomme_de_terre" &&
            side.grains.map((d, i) => (
              <rect key={i} x={d.x - d.r} y={d.y - d.r} width={d.r * 2} height={d.r * 2} rx={2} transform={`rotate(${d.rotate} ${d.x} ${d.y})`} fill={v("potato")} strokeWidth={1} />
            ))}
          {side.pieces.map((p, i) => (
            <PieceUse key={i} p={p} pid={pid} />
          ))}
        </>
      )}
      {art.pieces.map((p, i) => (
        <PieceUse key={i} p={p} pid={pid} />
      ))}
      {art.model === "mijote" && (
        // La sauce remonte sur le bas des morceaux.
        <path
          d={`M${s.x} ${s.y + s.h * 0.86} Q${s.x + s.w * 0.25} ${s.y + s.h * 0.78} ${s.x + s.w * 0.5} ${s.y + s.h * 0.86} T${s.x + s.w} ${s.y + s.h * 0.84} V${s.y + s.h} H${s.x} Z`}
          fill={art.sauce.fill}
          stroke="none"
          opacity={0.85}
        />
      )}
      {art.crust && (
        <>
          <path d={art.crust.path} fill={v("cheese")} strokeWidth={1.6} />
          {art.crust.spots.map((d, i) => (
            <ellipse key={i} cx={d.x} cy={d.y} rx={d.r * 1.5} ry={d.r} transform={`rotate(${d.rotate} ${d.x} ${d.y})`} fill={v(i % 3 ? "cheese-2" : "seared")} stroke="none" />
          ))}
        </>
      )}
      <Finish art={art} />
    </>
  );
}

/**
 * La boîte d'un plat sur sa nappe vichy. Tailles : sm 56 (ligne de liste), md 128 × 96 (carte),
 * lg 256 × 192, hero (bande plein cadre en haut de la fiche). `aria-label` = nom du plat.
 */
export function DishBox({
  recipe,
  size = "md",
  color,
  without,
  steam = size === "hero",
  live = false,
  className = "",
}: {
  recipe: DishRecipe;
  size?: DishSize;
  /** Par défaut recipeColor(slug). */
  color?: RecipeColor;
  /** Variante : ingrédients retirés (« brocoli »). */
  without?: string[];
  steam?: boolean;
  live?: boolean;
  className?: string;
}) {
  const art = dishArt(recipe, { without });
  const pid = `dish-${art.key}`;
  const sz = SIZE[size];
  const arts = [...new Set([...art.pieces, ...(art.side?.pieces ?? [])].map((p) => p.art))];
  const glass = { x: G.x, y: G.y, width: G.w, height: G.h, rx: 16 };
  return (
    <span
      role="img"
      aria-label={recipe.name}
      title={size === "sm" ? recipe.name : undefined}
      className={`relative grid shrink-0 place-items-center overflow-hidden ${sz.frame} ${className}`}
      style={vichy(recipeVar(color ?? recipeColor(recipe.slug)), sz.check)}
    >
      <svg
        className={`illu block h-auto ${sz.box} ${live ? "is-live" : ""}`}
        viewBox="0 -16 200 158"
        fill="none"
        stroke="var(--i-line)"
        strokeWidth={2.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        aria-hidden
      >
        <defs>
          <clipPath id={`${pid}-in`}>
            <rect x={G.x + 4} y={G.y + 4} width={G.w - 8} height={G.h - 8} rx={12} />
          </clipPath>
          {arts.map((id) => (
            // Dessins de src/lib/illus/art.ts (constantes du dépôt, jamais une saisie).
            <g key={id ?? "chunk"} id={`${pid}-${id ?? "chunk"}`} dangerouslySetInnerHTML={{ __html: id ? FOODS[id].svg : CHUNK }} />
          ))}
        </defs>
        <ellipse cx={100} cy={128} rx={84} ry={7} fill="var(--i-line)" opacity={0.14} stroke="none" />
        {steam &&
          [72, 100, 128].map((x, i) => (
            <path
              key={x}
              className="a-steam"
              style={{ "--d": `${(i * 0.7).toFixed(1)}s` } as CSSProperties}
              d={`M${x} 10 q-4 -6 0 -12 t0 -12`}
              stroke="var(--i-steam)"
              strokeWidth={3}
              opacity={0.75}
            />
          ))}
        <path d="M30 22 L172 14 Q180 14 180 22 L181 30 L28 36 L27 29 Q27 22 30 22 Z" fill="var(--c-accent)" />
        <path d="M92 19 h18" stroke="var(--i-shine)" strokeWidth={2} opacity={0.5} />
        <rect {...glass} fill="var(--i-glass)" />
        <g clipPath={`url(#${pid}-in)`}>
          <Contents art={art} pid={pid} />
        </g>
        {art.side && (
          <>
            <path d={`M${art.side.area.x - 3} ${G.y + 8} V${G.y + G.h - 10}`} stroke="var(--i-glass)" strokeWidth={5} />
            <path d={`M${art.side.area.x - 3} ${G.y + 8} V${G.y + G.h - 10}`} strokeWidth={1.6} opacity={0.55} />
          </>
        )}
        <rect {...glass} strokeWidth={2.6} />
        <path d="M22 108 Q22 116 32 116" stroke="var(--i-shine)" strokeWidth={3} opacity={0.7} />
        <path d="M168 40 Q178 40 178 50" stroke="var(--i-shine)" strokeWidth={3} opacity={0.7} />
      </svg>
    </span>
  );
}

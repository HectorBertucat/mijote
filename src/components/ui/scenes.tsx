// Petites scènes dessinées pour les états vides et les chargements (même trait que la banque de dessins :
// couleurs --i-* de illus.css et tokens). Elles bougent une fois, puis se taisent ; Simmer mijote tant qu’il est là.
// Sans état.

export type SceneName = "fridge" | "basket" | "pot";

const STROKE = { stroke: "var(--i-line)", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Frigo vide, porte ouverte, un citron vert seul qui roule sur l’étagère. */
function Fridge() {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden className="k-scene" fill="none">
      <rect x="30" y="6" width="56" height="84" rx="8" fill="var(--c-surface)" {...STROKE} />
      <rect x="36" y="12" width="44" height="72" rx="4" fill="var(--c-raised)" {...STROKE} strokeWidth={1.6} />
      <path d="M38 46h40M38 70h40" {...STROKE} strokeWidth={1.8} />
      <path d="M86 8l22 8v66l-22 8" fill="var(--c-surface-2)" {...STROKE} />
      <path d="M92 40v14" {...STROKE} />
      <g className="k-scene-roll">
        <ellipse cx="50" cy="40.5" rx="6.5" ry="5.5" fill="var(--i-lime)" {...STROKE} strokeWidth={1.8} />
        <path d="M44.5 40.5h-2M55.5 40.5h2" {...STROKE} strokeWidth={1.6} />
      </g>
    </svg>
  );
}

/** Panier renversé, une miette de persil à côté. */
function Basket() {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden className="k-scene" fill="none">
      <g className="k-scene-tip" style={{ transformOrigin: "60px 78px" }}>
        <path d="M24 44h60l-7 34H31z" fill="var(--i-wood)" {...STROKE} />
        <path d="M38 44l14-22M70 44L56 22" {...STROKE} />
        <path d="M40 54v14M54 54v14M68 54v14" {...STROKE} strokeWidth={1.8} />
      </g>
      <path d="M92 80c3-6 9-8 12-6-2 5-7 8-12 6z" fill="var(--i-leaf)" {...STROKE} strokeWidth={1.8} />
      <path d="M16 84h90" {...STROKE} strokeWidth={1.6} opacity={0.5} />
    </svg>
  );
}

/** Cocotte vide, couvercle posé de travers. */
function Pot() {
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden className="k-scene" fill="none">
      <path d="M26 46h68v24a12 12 0 0 1-12 12H38a12 12 0 0 1-12-12z" fill="var(--c-hot)" {...STROKE} />
      <path d="M18 52h8M94 52h8" {...STROKE} strokeWidth={3} />
      <g className="k-scene-lid" style={{ transformOrigin: "60px 42px" }}>
        <path d="M24 42c4-10 20-14 36-14s32 4 36 14z" fill="var(--i-iron-2)" {...STROKE} />
        <path d="M56 26h8" {...STROKE} strokeWidth={4} />
      </g>
    </svg>
  );
}

const SCENES: Record<SceneName, () => React.JSX.Element> = { fridge: Fridge, basket: Basket, pot: Pot };

export function Scene({ name }: { name: SceneName }) {
  const S = SCENES[name];
  return <S />;
}

/** Chargement : une casserole qui mijote, trois fils de vapeur. `label` est lu (« Je prépare la liste… »). */
export function Simmer({ label, size = 72, className = "" }: { label?: string; size?: number; className?: string }) {
  return (
    <span role="status" aria-label={label} className={`inline-grid justify-items-center gap-1.5 text-[14px] text-ink-2 ${className}`}>
      <svg viewBox="0 0 80 64" width={size} height={(size * 64) / 80} aria-hidden className="k-simmer" fill="none">
        <path className="k-steam" d="M30 26c-5-6 5-9 0-16" {...STROKE} stroke="var(--i-steam)" strokeWidth={3} />
        <path className="k-steam" d="M40 26c-5-6 5-9 0-16" {...STROKE} stroke="var(--i-steam)" strokeWidth={3} />
        <path className="k-steam" d="M50 26c-5-6 5-9 0-16" {...STROKE} stroke="var(--i-steam)" strokeWidth={3} />
        <path d="M16 34h48v14a8 8 0 0 1-8 8H24a8 8 0 0 1-8-8z" fill="var(--c-hot)" {...STROKE} />
        <path className="k-lid" d="M12 32c2-3 14-5 28-5s26 2 28 5z" fill="var(--i-iron-2)" {...STROKE} />
        <path d="M8 40h8M64 40h8" {...STROKE} strokeWidth={3} />
      </svg>
      {label && <span aria-hidden>{label}</span>}
    </span>
  );
}

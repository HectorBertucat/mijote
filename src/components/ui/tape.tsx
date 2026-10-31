// Tape : étiquette d'étiqueteuse (nom d'un plat, jour où le manger), comme on marque ses boîtes. Capitales Archivo
// serrées, en clair sur la couleur du plat, légèrement de travers (angle tiré du texte, stable). Sans état.
import type { CSSProperties, ReactNode } from "react";
import { stampAngle } from "./angle";

export function Tape({ children, sub, seed, tint = "var(--c-recipe-1)", className = "" }: { children: ReactNode; sub?: ReactNode; seed?: string; tint?: string; className?: string }) {
  const rot = stampAngle(seed ?? String(children)) / 4;
  return (
    <span
      className={`label inline-grid max-w-full justify-items-start rounded-[2px] bg-[var(--tint)] px-2 py-[5px] !text-[12px] text-on-recipe ${className}`}
      style={{ "--tint": tint, transform: `rotate(${rot}deg)` } as CSSProperties}
    >
      <span className="max-w-full truncate">{children}</span>
      {sub && <span className="mt-0.5 !normal-case tracking-normal opacity-80">{sub}</span>}
    </span>
  );
}

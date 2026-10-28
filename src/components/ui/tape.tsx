// Tape : étiquette sur ruban adhésif, écrite à la main (nom d'un plat, jour où le manger), comme on marque ses
// boîtes. Inclinaison fixe tirée du texte. Sans état.
import type { CSSProperties, ReactNode } from "react";
import { stampAngle } from "./angle";

export function Tape({ children, sub, seed, tint = "var(--c-recipe-1)", className = "" }: { children: ReactNode; sub?: ReactNode; seed?: string; tint?: string; className?: string }) {
  const rot = stampAngle(seed ?? String(children)) / 2.5;
  return (
    <span
      className={`inline-grid max-w-full justify-items-start bg-[color-mix(in_srgb,var(--tint)_24%,var(--c-raised))] px-2.5 py-0.5 font-hand text-[19px] leading-[1.05] text-ink shadow-e1 [clip-path:polygon(0_6%,3%_0,97%_4%,100%_0,99%_94%,96%_100%,4%_96%,1%_100%)] ${className}`}
      style={{ "--tint": tint, transform: `rotate(${rot}deg)` } as CSSProperties}
    >
      <span className="max-w-full truncate font-bold">{children}</span>
      {sub && <span className="text-[15px] text-ink-2">{sub}</span>}
    </span>
  );
}

"use client";

// Fin de session (DA « Le frigo est plein ») : un frigo dessiné s'ouvre, une boîte par recette tombe sur une étagère
// avec son étiquette sur ruban, puis le cachet « Fait maison » se pose. L'animation ne joue que juste après
// « Session terminée » (moins de 2 min) ; en revenant plus tard, le frigo est simplement plein.
import { useEffect, useState, type CSSProperties } from "react";
import { StampFaitMaison, Tape } from "@/components/ui";
import type { SessionPlan } from "@/lib/session/planner";
import type { SessionEvent } from "@/lib/session/state";

export function FridgeDone({ plan, events, test = false, compact = false }: { plan: SessionPlan; events: SessionEvent[]; test?: boolean; compact?: boolean }) {
  const end = [...events].reverse().find((e) => e.kind === "note" && (e.payload as { status?: string } | null)?.status === "done");
  const endAt = end ? new Date(end.at) : new Date();
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (Date.now() - endAt.getTime() < 120_000) setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end?.at]);
  const boxes = plan.recipes.slice(0, 6);
  // Deux étagères, trois boîtes au plus par étagère.
  const shelf = (i: number) => (boxes.length <= 3 ? 0 : i < Math.ceil(boxes.length / 2) ? 0 : 1);
  const perShelf = (s: number) => boxes.filter((_, i) => shelf(i) === s).length;
  const posIn = (i: number) => boxes.slice(0, i).filter((_, k) => shelf(k) === shelf(i)).length;
  const W = compact ? 150 : 190;
  return (
    <div className={`k-fridge relative flex flex-wrap items-center gap-5 ${fresh ? "is-fresh" : ""}`}>
      <div className="relative shrink-0" style={{ width: W }}>
        <svg viewBox="0 0 190 240" width={W} role="img" aria-label={`Le frigo : ${boxes.map((b) => b.name).join(", ")}`} className="block overflow-visible">
          <rect x="8" y="6" width="174" height="228" rx="14" fill="var(--c-surface-2)" stroke="var(--c-ink)" strokeWidth="3" />
          <rect x="18" y="16" width="154" height="208" rx="8" fill="var(--c-raised)" stroke="var(--c-line-strong)" strokeWidth="2" />
          <line x1="20" y1="118" x2="170" y2="118" stroke="var(--c-line-strong)" strokeWidth="3" strokeLinecap="round" />
          <line x1="20" y1="214" x2="170" y2="214" stroke="var(--c-line-strong)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="160" cy="28" r="5" fill="var(--c-hot)" opacity="0.8" className="k-fridge-light" />
          {boxes.map((b, i) => {
            const s = shelf(i);
            const n = boxes.length <= 3 ? boxes.length : perShelf(s);
            const bw = n >= 3 ? 44 : 56;
            const gap = (150 - n * bw) / (n + 1);
            const x = 20 + gap + posIn(i) * (bw + gap);
            const y = (s === 0 ? 118 : 214) - 40;
            return (
              <g key={b.slug} className="k-fridge-box" style={{ "--d": `${450 + i * 170}ms` } as CSSProperties}>
                <rect x={x} y={y} width={bw} height="40" rx="7" fill={`color-mix(in srgb, ${b.color} 30%, var(--c-raised))`} stroke={b.color} strokeWidth="3" />
                <rect x={x - 2} y={y - 5} width={bw + 4} height="9" rx="4" fill={b.color} />
                <rect x={x + 7} y={y + 16} width={bw - 14} height="10" rx="1.5" fill="color-mix(in srgb, var(--c-recipe-1) 24%, var(--c-raised))" transform={`rotate(-3 ${x + bw / 2} ${y + 21})`} />
              </g>
            );
          })}
          {/* Porte : s'ouvre au début (vue de face : elle se replie vers la charnière gauche). */}
          <g className="k-fridge-door">
            <rect x="8" y="6" width="174" height="228" rx="14" fill="var(--c-surface)" stroke="var(--c-ink)" strokeWidth="3" />
            <rect x="160" y="70" width="8" height="60" rx="4" fill="var(--c-ink-3)" />
          </g>
        </svg>
        <span className="absolute -bottom-3 -right-5">
          <StampFaitMaison key={fresh ? "f" : "s"} date={endAt} size={compact ? 92 : 112} fresh={fresh} className="[--stamp-delay:1300ms]" />
        </span>
      </div>
      <div className="grid min-w-0 flex-1 basis-[220px] content-center gap-2.5">
        <p className="font-display text-[26px] leading-tight font-extrabold">{test ? "Test terminé" : "Le frigo est plein"}</p>
        <div className="flex flex-wrap gap-2.5">
          {boxes.map((b) => (
            <Tape key={b.slug} tint={b.color} seed={b.slug}>
              {b.name}
            </Tape>
          ))}
        </div>
      </div>
    </div>
  );
}

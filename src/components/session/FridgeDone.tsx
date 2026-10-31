"use client";

// Fin de session, un des trois moments de fête (docs/design/systeme.md, « Le cachet ») : un frigo dessiné
// s'ouvre, une boîte par plat tombe sur une étagère, puis le cachet « Fait maison » se pose ; à côté, le
// titre en très grand, la durée et l'étiquette de chaque plat. L'animation ne joue que juste après
// « Session terminée » (moins de 2 min) ; en revenant plus tard, le frigo est simplement plein.
import { useEffect, useState, type CSSProperties } from "react";
import { StampFaitMaison, Tape } from "@/components/ui";
import type { SessionPlan } from "@/lib/session/planner";
import type { SessionEvent } from "@/lib/session/state";
import { dur } from "./parts";

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

export function FridgeDone({ plan, events, test = false }: { plan: SessionPlan; events: SessionEvent[]; test?: boolean; compact?: boolean }) {
  const end = [...events].reverse().find((e) => e.kind === "note" && (e.payload as { status?: string } | null)?.status === "done");
  const endAt = end ? new Date(end.at) : new Date();
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (Date.now() - endAt.getTime() < 120_000) setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end?.at]);
  // Durée réelle : du premier geste noté à « Session terminée ».
  const first = events.find((e) => e.kind !== "note");
  const minutes = first && end ? (Date.parse(end.at) - Date.parse(first.at)) / 60000 : null;
  const boxes = plan.recipes.slice(0, 6);
  // Deux étagères, trois boîtes au plus par étagère.
  const shelf = (i: number) => (boxes.length <= 3 ? 0 : i < Math.ceil(boxes.length / 2) ? 0 : 1);
  const perShelf = (s: number) => boxes.filter((_, i) => shelf(i) === s).length;
  const posIn = (i: number) => boxes.slice(0, i).filter((_, k) => shelf(k) === shelf(i)).length;
  return (
    <section className={`k-fridge grid items-center gap-8 md:grid-cols-12 md:gap-6 ${fresh ? "is-fresh" : ""}`} aria-labelledby="fin-titre">
      <div className="relative w-[min(100%,240px)] md:col-span-4 md:w-full md:max-w-[280px]">
        <svg viewBox="0 0 190 240" width="100%" role="img" aria-label={`Le frigo : ${boxes.map((b) => b.name).join(", ")}`} className="block overflow-visible">
          <rect x="8" y="6" width="174" height="228" rx="14" fill="var(--c-surface-2)" stroke="var(--c-ink)" strokeWidth="3" />
          <rect x="18" y="16" width="154" height="208" rx="8" fill="var(--c-raised)" stroke="var(--c-line-strong)" strokeWidth="2" />
          <line x1="20" y1="118" x2="170" y2="118" stroke="var(--c-line-strong)" strokeWidth="3" strokeLinecap="round" />
          <line x1="20" y1="214" x2="170" y2="214" stroke="var(--c-line-strong)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="160" cy="28" r="5" fill="var(--c-ink-3)" className="k-fridge-light" />
          {boxes.map((b, i) => {
            const s = shelf(i);
            const n = boxes.length <= 3 ? boxes.length : perShelf(s);
            const bw = n >= 3 ? 44 : 56;
            const gap = (150 - n * bw) / (n + 1);
            const x = 20 + gap + posIn(i) * (bw + gap);
            const y = (s === 0 ? 118 : 214) - 40;
            return (
              <g key={b.slug} className="k-fridge-box" style={{ "--d": `${450 + i * 170}ms` } as CSSProperties}>
                <rect x={x} y={y} width={bw} height="40" rx="6" fill="var(--i-glass)" stroke="var(--i-line)" strokeWidth="2" />
                <rect x={x + 4} y={y + 14} width={bw - 8} height="22" rx="3" fill={`color-mix(in srgb, ${b.color} 62%, var(--i-paper))`} />
                <rect x={x - 2} y={y - 6} width={bw + 4} height="9" rx="3" fill={b.color} stroke="var(--i-line)" strokeWidth="2" />
                <rect x={x + 8} y={y + 18} width={bw - 22} height="8" rx="1" fill="var(--i-label)" transform={`rotate(-4 ${x + bw / 2} ${y + 22})`} />
              </g>
            );
          })}
          {/* Porte : s'ouvre au début (vue de face : elle se replie vers la charnière gauche). */}
          <g className="k-fridge-door">
            <rect x="8" y="6" width="174" height="228" rx="14" fill="var(--c-surface)" stroke="var(--c-ink)" strokeWidth="3" />
            <rect x="160" y="70" width="8" height="60" rx="4" fill="var(--c-ink-3)" />
          </g>
        </svg>
        <span className="absolute -right-8 -bottom-4">
          <StampFaitMaison key={fresh ? "f" : "s"} date={endAt} size={120} fresh={fresh} className="[--stamp-delay:1300ms]" />
        </span>
      </div>
      <div className="grid min-w-0 content-center gap-6 md:col-span-8">
        <p className="label text-ink-2">{test ? "Session test" : "Session finie"} · {DAY.format(endAt)}</p>
        <h1 id="fin-titre" className="text-display">
          {test ? "Test terminé." : "Le frigo est plein."}
        </h1>
        <p className="num text-lead text-ink-2">
          {boxes.length} plat{boxes.length > 1 ? "s" : ""}
          {minutes != null && minutes >= 1 ? `, ${dur(minutes)} en cuisine` : ""}.
        </p>
        <div className="flex flex-wrap gap-3">
          {boxes.map((b) => (
            <Tape key={b.slug} tint={b.color} seed={b.slug}>
              {b.name}
            </Tape>
          ))}
        </div>
      </div>
    </section>
  );
}

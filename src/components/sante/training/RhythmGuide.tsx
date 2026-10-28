"use client";

// Guide visuel du rythme (séance guidée) : la courbe du tempo défile de droite à gauche, la bille reste
// à la même place et suit la courbe. On voit venir la prochaine descente, le prochain palier, la
// prochaine remontée ; chaque début de phase est marqué, avec son mot (« Descends », « Tiens »…), et la
// bille clignote au moment du bip. Même horloge que la figure et les bips (`t`). Pur affichage :
// couleurs en jetons du thème, lisible sur téléphone comme sur grand écran.
import { heightAt, marksBetween, rhythmPath } from "@/lib/training/rhythm";
import type { Motion } from "@/lib/training/motion";

const W = 400;
const H = 112;
const PAD_Y = 18;
/** Secondes visibles avant la bille, et devant elle. */
const PAST = 1.2;
const AHEAD = 4.8;
const BALL_X = (PAST / (PAST + AHEAD)) * W;

const xOf = (dt: number) => BALL_X + (dt / (PAST + AHEAD)) * W;
const yOf = (h: number) => PAD_Y + (1 - h) * (H - 2 * PAD_Y);

export function RhythmGuide({ motion, t, end = null, active, className = "" }: { motion: Motion; t: number; end?: number | null; active: boolean; className?: string }) {
  const pts = rhythmPath(motion, t, PAST, AHEAD, end);
  const d = (list: typeof pts) => list.map((p, i) => `${i ? "L" : "M"}${xOf(p.x).toFixed(1)} ${yOf(p.h).toFixed(1)}`).join(" ");
  const past = pts.filter((p) => p.x <= 0);
  const ahead = pts.filter((p) => p.x >= 0);
  const marks = marksBetween(motion, t - PAST, t + AHEAD, end);
  const y = yOf(heightAt(motion, t, end));
  // Bip : la bille grossit pendant le premier dixième de seconde d'une phase.
  const justStarted = active && marks.some((m) => t - m.at >= 0 && t - m.at < 0.12);
  const next = marks.find((m) => m.at > t);
  return (
    <figure className={`grid gap-1 ${className}`} aria-label={next ? `Rythme : ${next.label} dans ${Math.max(0, next.at - t).toFixed(1)} s` : "Rythme"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible rounded-[14px] bg-surface-2" role="img" aria-hidden>
        {/* Haut et bas du geste. */}
        <line x1="0" x2={W} y1={yOf(1)} y2={yOf(1)} className="stroke-line" strokeWidth="1" strokeDasharray="2 6" />
        <line x1="0" x2={W} y1={yOf(0)} y2={yOf(0)} className="stroke-line" strokeWidth="1" strokeDasharray="2 6" />
        {/* Débuts de phase à venir : un trait et le mot. */}
        {marks.map((m) => {
          const x = xOf(m.at - t);
          const soon = m.at > t;
          return (
            <g key={`${m.at.toFixed(2)}`} className={soon ? "text-ink-2" : "text-faint"}>
              <line x1={x} x2={x} y1={4} y2={H - 4} className={m.rep ? "stroke-accent" : "stroke-line-strong"} strokeWidth={m.rep ? 2 : 1} strokeDasharray={m.rep ? undefined : "3 4"} opacity={soon ? 0.9 : 0.35} />
              {soon && x - BALL_X > 24 && (
                <text x={x + 4} y={12} className="fill-current" fontSize="11" fontWeight="700">
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
        <path d={d(past)} fill="none" className="stroke-faint" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d={d(ahead)} fill="none" className="stroke-accent" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {/* La bille. */}
        <circle cx={BALL_X} cy={y} r={justStarted ? 13 : 10} className="fill-accent transition-[r] duration-100" />
        <circle cx={BALL_X} cy={y} r={4} className="fill-surface" />
      </svg>
      {next && (
        <figcaption className="flex items-baseline justify-between text-[13px] text-ink-2 tabular-nums">
          <span>
            Ensuite : <b className="text-ink">{next.label}</b>
          </span>
          <span>{Math.max(0, next.at - t).toFixed(1).replace(".", ",")} s</span>
        </figcaption>
      )}
    </figure>
  );
}

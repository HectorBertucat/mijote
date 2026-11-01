"use client";

// Bonhomme animé d’un exercice. L’horloge (`t`, en secondes) vient de l’appelant quand le geste doit
// rester synchro avec le décompte et les bips (séance guidée) ; sinon useMotionClock la fait tourner.
// Dessin : src/lib/training/draw.ts (membres galbés, ombre, tapis, matériel) ; couleurs en jetons uniquement.
import { createContext, useContext, useEffect, useState } from "react";
import { drawFigure, VIEWBOX, type Paint } from "@/lib/training/draw";
import { MOTIONS } from "@/lib/training/figures";
import { sample, type Frame, type Motion } from "@/lib/training/motion";

/** Figures des exercices inventés (programme créé par l’IA), posées par la page Entraînement. */
export const MotionsContext = createContext<Record<string, Motion>>({});

/** La figure d’un exercice : celle du programme, sinon celle de la bibliothèque. */
export function useMotion(ex: string): Motion | null {
  const extra = useContext(MotionsContext);
  return extra[ex] ?? MOTIONS[ex] ?? null;
}

/** Préférence « réduire les animations » du système. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Secondes écoulées depuis `since` (ms epoch, ou le montage), à chaque image ; figée si `running` est faux. */
export function useMotionClock(running = true, since?: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = since ?? performance.timeOrigin + performance.now();
    let id = 0;
    const loop = () => {
      setT((performance.timeOrigin + performance.now() - t0) / 1000);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [running, since]);
  return t;
}

export function frameAt(m: Motion | null, t: number): Frame | null {
  return m ? sample(m, t) : null;
}

// Chaque « peinture » du dessin (draw.ts) en jetons du thème : le côté proche en encre, le côté éloigné
// en retrait, le matériel tenu à l'accent, le matériel posé en surfaces.
const PAINT: Record<Paint, string> = {
  ground: "stroke-line-strong",
  mat: "fill-accent-soft",
  shadow: "fill-line",
  prop: "fill-surface-2",
  propEdge: "fill-line-strong",
  far: "fill-faint",
  near: "fill-ink",
  tool: "fill-accent stroke-accent",
  toolFar: "fill-accent stroke-accent opacity-60",
};

/** Image du mouvement à l’instant `t`. Avec « réduire les animations », la pose clé la plus parlante, fixe. */
export function KbFigure({ ex, t, className = "", label }: { ex: string; t: number; className?: string; label?: string }) {
  const reduced = useReducedMotion();
  const m = useMotion(ex);
  if (!m) return null;
  // Pose fixe : la fin de la première étape, qui va vers la pose 1 (bas du squat, bras tendu…).
  const f = sample(m, reduced ? (m.steps[0]?.dur ?? 0) * 0.999 : t);
  return (
    <svg viewBox={VIEWBOX} role="img" aria-label={label ?? f.label} className={`block h-auto w-full ${className}`}>
      {drawFigure(f, m).map((p, i) =>
        p.stroke ? (
          <path key={i} d={p.d} className={PAINT[p.paint]} style={{ fill: "none" }} strokeWidth={p.stroke} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={i} d={p.d} className={PAINT[p.paint]} style={{ stroke: "none" }} />
        ),
      )}
    </svg>
  );
}

/** Figure qui tourne seule (bibliothèque), avec la phase en cours sous le dessin. */
export function LoopingFigure({ ex, className = "", caption = true, size }: { ex: string; className?: string; caption?: boolean; size?: number }) {
  const t = useMotionClock(true);
  const f = frameAt(useMotion(ex), t);
  return (
    <div className={className} style={size ? { width: size } : undefined}>
      <KbFigure ex={ex} t={t} />
      {caption && f && (
        <p className="mt-1 text-center text-[13px] font-semibold text-ink-2" aria-hidden>
          {f.label}
          {f.count && <span className="ml-1 tabular-nums text-faint">{Math.ceil(f.remaining)}</span>}
        </p>
      )}
    </div>
  );
}

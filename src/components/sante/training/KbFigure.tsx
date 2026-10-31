"use client";

// Bonhomme animé d’un exercice. L’horloge (`t`, en secondes) vient de l’appelant quand le geste doit
// rester synchro avec le décompte et les bips (séance guidée) ; sinon useMotionClock la fait tourner.
// Couleurs : jetons uniquement (encre, trait discret pour le côté éloigné, accent pour la kettlebell).
import { createContext, useContext, useEffect, useState } from "react";
import { figure, VIEWBOX } from "@/lib/training/draw";
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

/** Image du mouvement à l’instant `t`. Avec « réduire les animations », la pose clé la plus parlante, fixe. */
export function KbFigure({ ex, t, className = "", label }: { ex: string; t: number; className?: string; label?: string }) {
  const reduced = useReducedMotion();
  const m = useMotion(ex);
  if (!m) return null;
  // Pose fixe : le milieu de la première étape qui va vers la pose 1 (bas du squat, bras tendu…).
  const f = sample(m, reduced ? (m.steps[0]?.dur ?? 0) * 0.999 : t);
  const g = figure(f);
  const pt = (p: [number, number]) => p.map((v) => v.toFixed(1));
  return (
    <svg viewBox={VIEWBOX} role="img" aria-label={label ?? f.label} className={`block h-auto w-full ${className}`}>
      <line x1="4" y1="187" x2="196" y2="187" className="stroke-line-strong" strokeWidth="3" strokeLinecap="round" />
      {(m.props ?? []).map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx="4" className="fill-surface-2 stroke-line" />
      ))}
      <g className="stroke-faint" strokeLinecap="round">
        {g.back.map((s, i) => {
          const [x1, y1] = pt(s.a);
          const [x2, y2] = pt(s.b);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={s.w} />;
        })}
      </g>
      <g className="stroke-ink" strokeLinecap="round">
        {g.front.map((s, i) => {
          const [x1, y1] = pt(s.a);
          const [x2, y2] = pt(s.b);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={s.w} />;
        })}
      </g>
      <circle cx={g.head[0].toFixed(1)} cy={g.head[1].toFixed(1)} r="11" className="fill-ink" />
      {g.bell && (
        <g className="stroke-accent" strokeWidth="3" fill="none" strokeLinecap="round">
          <path d={`M${g.bell.handle[0] - 4} ${g.bell.handle[1]} Q${g.bell.handle[0]} ${g.bell.handle[1] - 6} ${g.bell.handle[0] + 4} ${g.bell.handle[1]}`} />
          <line x1={g.bell.handle[0]} y1={g.bell.handle[1]} x2={g.bell.at[0]} y2={g.bell.at[1]} />
          <circle cx={g.bell.at[0]} cy={g.bell.at[1]} r="8" className="fill-accent" stroke="none" />
        </g>
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

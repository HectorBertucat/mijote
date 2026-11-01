"use client";

// L'île client des graphiques : lire une valeur au survol, au doigt ou au clavier. Le dessin reste rendu
// par le serveur (children) ; l'île ne reçoit que les abscisses et les textes déjà formatés.
// - mode "x" (courbes, barres) : le point le plus proche du pointeur ; trait vertical et point sur une courbe.
// - mode "cells" (calendrier) : la case sous le pointeur ; flèches gauche/droite d'une colonne, haut/bas d'une case.
// Au clavier, c'est un curseur (role="slider") dont la valeur lue est le texte de l'infobulle.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { nearest, tipText, type Tip } from "./core";

export function ChartHover({
  tips,
  xs,
  ys,
  mode = "x",
  rows = 7,
  crosshair = false,
  label,
  className = "",
  children,
}: {
  tips: Tip[];
  /** Abscisse relative (0–1) de chaque point, croissante (mode "x"). */
  xs?: number[];
  /** Ordonnée relative depuis le haut (0–1) du point marqué, s'il y en a un. */
  ys?: (number | null)[];
  mode?: "x" | "cells";
  /** Cases par colonne (mode "cells"). */
  rows?: number;
  crosshair?: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [i, setI] = useState<number | null>(null);
  const [cell, setCell] = useState<{ x: number; y: number } | null>(null);
  const n = tips.length;

  // La marque active (barre, case) prend l'état « on » : le style est dans charts.css.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.querySelectorAll("[data-on]").forEach((e) => e.removeAttribute("data-on"));
    if (i == null) return setCell(null);
    const marks = el.querySelectorAll<HTMLElement>(`[data-i="${i}"]`);
    marks.forEach((e) => e.setAttribute("data-on", ""));
    if (mode === "cells" && marks[0]) {
      const r = el.getBoundingClientRect();
      const c = marks[0].getBoundingClientRect();
      setCell({ x: (c.left + c.width / 2 - r.left) / r.width, y: c.top - r.top });
    }
  }, [i, mode]);

  const fromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode === "cells") {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (t && box.current?.contains(t)) setI(Number(t.dataset.i));
      return;
    }
    if (!xs?.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    setI(nearest(xs, (e.clientX - r.left) / r.width));
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cur = i ?? n - 1;
    const step = mode === "cells" ? rows : 1;
    const moves: Record<string, number> = { ArrowLeft: cur - step, ArrowRight: cur + step, Home: 0, End: n - 1, ...(mode === "cells" ? { ArrowUp: cur - 1, ArrowDown: cur + 1 } : {}) };
    if (e.key === "Escape") return setI(null);
    if (!(e.key in moves)) return;
    e.preventDefault();
    setI(Math.max(0, Math.min(n - 1, moves[e.key])));
  };

  const tip = i != null ? tips[i] : null;
  const x = mode === "cells" ? cell?.x : i != null && xs ? xs[i] : null;
  const y = i != null && ys ? ys[i] : null;
  const right = x != null && x > 0.55;
  const off = mode === "cells" ? 0 : 12;

  return (
    <div
      ref={box}
      role="slider"
      tabIndex={n ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, n - 1)}
      aria-valuenow={i ?? n - 1}
      aria-valuetext={tips[i ?? n - 1] ? tipText(tips[i ?? n - 1]) : undefined}
      onPointerMove={(e) => (e.pointerType === "mouse" || e.buttons) && fromPointer(e)}
      onPointerDown={fromPointer}
      onPointerLeave={(e) => e.pointerType === "mouse" && setI(null)}
      onKeyDown={onKey}
      onFocus={() => i == null && setI(n - 1)}
      onBlur={() => setI(null)}
      className={`viz-hover relative touch-pan-y select-none rounded-[4px] ${className}`}
    >
      {children}
      {crosshair && x != null && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-line-strong" style={{ left: `${x * 100}%` }}>
          {y != null && <span className="absolute left-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-ink [box-sizing:content-box]" style={{ top: `${y * 100}%` }} />}
        </span>
      )}
      {tip && x != null && (
        <div
          aria-hidden
          className="viz-tip pointer-events-none absolute z-10 grid min-w-28 max-w-60 gap-1 rounded-[8px] border border-line bg-raised px-3 py-2 text-small shadow-float"
          style={
            mode === "cells"
              ? { top: (cell?.y ?? 0) - 8, transform: "translateY(-100%)", ...(right ? { right: `${(1 - x) * 100}%`, marginRight: -12 } : { left: `${x * 100}%`, marginLeft: -12 }) }
              : { top: 0, ...(right ? { right: `calc(${(1 - x) * 100}% + ${off}px)` } : { left: `calc(${x * 100}% + ${off}px)` }) }
          }
        >
          <span className="text-ink-2">{tip.title}</span>
          {tip.rows.map((r, k) => (
            <span key={k} className="flex items-baseline gap-2 whitespace-nowrap">
              {r.color && <i className={`inline-block shrink-0 self-center ${r.shape === "rect" ? "size-2.5 rounded-[2px]" : r.shape === "dot" ? "size-2 rounded-full" : "h-0.5 w-3 rounded-full"}`} style={{ background: r.color }} />}
              <b className="num font-[700] text-ink">{r.value}</b>
              {r.label && <span className="text-ink-2">{r.label}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

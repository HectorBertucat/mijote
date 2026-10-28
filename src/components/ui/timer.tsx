"use client";

// Timer : minuteur (anneau de progression, horloge condensée, état fini inversé qui pulse et « sonne »),
// useCountdown pour le faire tourner, formatClock pour l'afficher. Composant client.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button } from "./button";

/** 200 → « 03:20 », 3725 → « 1:02:05 ». */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const rr = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

/** Compte à rebours local : `endsAt` (ms epoch, l'heure de fin partagée par la session) ou `null` en pause avec `remainingWhenPaused`. Renvoie les secondes restantes. */
export function useCountdown(endsAt: number | null, remainingWhenPaused = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return endsAt == null ? remainingWhenPaused : Math.max(0, (endsAt - now) / 1000);
}

// Son court (880 Hz) ; seulement après un premier toucher de la page (règle des navigateurs).
let armed = false;
let ctx: AudioContext | null = null;
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => (armed = true), { once: true });
/** Bip court du minuteur fini (silencieux tant que la page n'a pas été touchée). `freq`/`length` : tons du tempo guidé. */
export function beep(freq = 880, length = 0.35) {
  if (!armed) return;
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = W.AudioContext ?? W.webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + length);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + length + 0.05);
  } catch {}
}

/** Glisser pour régler : 15 s par cran de 6 px (vers le haut = plus de temps). */
const ADJUST_PX = 6;
const ADJUST_STEP = 15;
const HOLD_MS = 450;

/**
 * Chiffres réglables à la souris : rester appuyé un instant, puis glisser vers le haut (plus) ou le bas (moins).
 * Au relâcher, `onAdjust(delta en secondes)`. Souris seulement : au doigt, rien ne change (le téléphone garde +1).
 */
function useDragAdjust(remaining: number, onAdjust?: (deltaSec: number) => void) {
  const [delta, setDelta] = useState<number | null>(null);
  const st = useRef<{ y: number; timer: ReturnType<typeof setTimeout> | null; on: boolean; id: number } | null>(null);
  if (!onAdjust) return { delta: null, props: {} };
  const clampDelta = (d: number) => Math.max(d, -Math.max(0, Math.floor(remaining) - 5));
  const end = () => {
    const s = st.current;
    if (s?.timer) clearTimeout(s.timer);
    st.current = null;
    setDelta(null);
    return s;
  };
  return {
    delta,
    props: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        const el = e.currentTarget;
        const id = e.pointerId;
        st.current = { y: e.clientY, on: false, id, timer: setTimeout(() => {
          if (!st.current) return;
          st.current.on = true;
          st.current.timer = null;
          try { el.setPointerCapture(id); } catch {}
          setDelta(0);
        }, HOLD_MS) };
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const s = st.current;
        if (!s) return;
        if (!s.on) {
          if (Math.abs(e.clientY - s.y) > 4) end(); // bougé avant la fin de l'appui : pas un réglage
          return;
        }
        setDelta(clampDelta(Math.round((s.y - e.clientY) / ADJUST_PX) * ADJUST_STEP));
      },
      onPointerUp: () => {
        const d = delta;
        const s = end();
        if (s?.on && d) onAdjust(d);
      },
      onPointerCancel: () => void end(),
      title: "Reste appuyé puis glisse vers le haut ou le bas pour régler",
      style: { cursor: delta != null ? "ns-resize" : "grab", touchAction: "none" } as CSSProperties,
    },
  };
}

/** Minuteur. `remaining`/`total` en secondes ; fini quand remaining ≤ 0 (fond d'encre, pulse ; `sound` bipe toutes les 4 s). `onToggle` affiche pause/lecture (ou « OK » une fois fini) ; `size="big"` pour la session. Jamais de couleur d'état. */
export function Timer({ title, detail, remaining, total, paused = false, onToggle, onDismiss, onAdjust, sound = false, size = "md", action, className = "" }: { title: ReactNode; detail?: ReactNode; remaining: number; total: number; paused?: boolean; onToggle?: () => void; onDismiss?: () => void; /** Réglage à la souris (appui long puis glisser) : delta en secondes. */ onAdjust?: (deltaSec: number) => void; sound?: boolean; size?: "md" | "big"; action?: ReactNode; className?: string }) {
  const done = remaining <= 0;
  const drag = useDragAdjust(remaining, done ? undefined : onAdjust);
  const p = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const was = useRef(done);
  useEffect(() => {
    if (!sound || !done) return;
    if (!was.current) beep();
    was.current = true;
    const id = setInterval(() => beep(), 4000);
    return () => clearInterval(id);
  }, [done, sound]);
  useEffect(() => {
    if (!done) was.current = false;
  }, [done]);
  const big = size === "big";
  const ringPx = big ? 76 : 52;
  return (
    <div
      role="timer"
      aria-live={done ? "assertive" : "off"}
      className={`flex items-center gap-3.5 k-timer rounded-[14px] px-3.5 py-3 transition-colors duration-[var(--dur-base)] ${done ? "k-timer-done" : ""} ${className}`}
    >
      <span className="k-ring grid shrink-0 place-items-center rounded-full" style={{ "--p": p.toFixed(3), width: ringPx, height: ringPx } as CSSProperties} aria-hidden />
      <div className="grid min-w-0 flex-1">
        <b className={big ? "text-[17px]" : "text-[14px]"}>{title}</b>
        {detail && <span className={`text-[13px] ${done ? "text-[color-mix(in_srgb,var(--c-on-inverse)_70%,transparent)]" : "text-ink-2"}`}>{done ? "Terminé" : detail}</span>}
      </div>
      <span
        {...drag.props}
        className={`relative font-display font-extrabold tabular-nums tracking-[-0.01em] [font-stretch:80%] select-none ${big ? "text-[52px] leading-none" : "text-[30px]"} ${paused && !done ? "text-faint" : ""} ${drag.delta != null ? "rounded-[8px] text-accent outline-2 outline-offset-4 outline-accent" : ""}`}
      >
        {formatClock(remaining + (drag.delta ?? 0))}
        {drag.delta != null && (
          <span className="absolute -top-5 right-0 font-sans text-[11px] font-bold tracking-normal text-accent">
            {drag.delta >= 0 ? "+" : "−"}
            {formatClock(Math.abs(drag.delta))}
          </span>
        )}
      </span>
      {action ??
        (done
          ? onDismiss && <Button size={big ? "md" : "sm"} variant="inverse" onClick={onDismiss}>OK</Button>
          : onToggle && <Button size={big ? "md" : "sm"} variant="quiet" iconOnly icon={paused ? "play" : "pause"} aria-label={paused ? "Reprendre" : "Pause"} onClick={onToggle} />)}
    </div>
  );
}

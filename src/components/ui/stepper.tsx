"use client";

// Stepper : compteur −/+ dont le chiffre « tique » (arrive d'en haut sur +, d'en bas sur −). Composant client.
import { useState, type CSSProperties } from "react";
import { Icon } from "./icon";

/** Compteur. Contrôlé (`value` + `onChange`) ou libre (`defaultValue`) ; `name` ajoute un input caché pour les formulaires ; `size="kitchen"` = boutons de 64 px, `size="sm"` = 36 px (lignes de courses).
 * `onStep` : pas non linéaire (unités d'une recette ×0,5 → ×3) — le compteur ne calcule rien, il appelle `onStep(±1)` et tique ; `canDec` / `canInc` disent si le pas existe ; `busy` grise le chiffre (serveur). */
export function Stepper({ value, defaultValue = 0, onChange, onStep, canDec, canInc, busy = false, min = 0, max = Infinity, step = 1, size = "md", name, unit, decLabel = "Un de moins", incLabel = "Un de plus", className = "" }: { value?: number; defaultValue?: number; onChange?: (v: number) => void; onStep?: (dir: 1 | -1) => void; canDec?: boolean; canInc?: boolean; busy?: boolean; min?: number; max?: number; step?: number; size?: "sm" | "md" | "kitchen"; name?: string; unit?: string; decLabel?: string; incLabel?: string; className?: string }) {
  const [inner, setInner] = useState(defaultValue);
  const cur = value ?? inner;
  const [tick, setTick] = useState<{ n: number; dir: string }>({ n: 0, dir: "-6px" });
  const bump = (d: 1 | -1) => {
    if (onStep) {
      onStep(d);
      setTick((t) => ({ n: t.n + 1, dir: d > 0 ? "-8px" : "8px" }));
      return;
    }
    const v = Math.min(max, Math.max(min, cur + d * step));
    if (v === cur) return;
    setInner(v);
    onChange?.(v);
    setTick((t) => ({ n: t.n + 1, dir: d > 0 ? "-8px" : "8px" }));
  };
  const btn = size === "kitchen" ? "size-16" : size === "sm" ? "size-9" : "size-11";
  const num = size === "kitchen" ? "min-w-16 text-[28px]" : size === "sm" ? "min-w-8 text-[16px]" : "min-w-11 text-[18px]";
  const decOff = canDec != null ? !canDec : cur <= min;
  const incOff = canInc != null ? !canInc : cur >= max;
  return (
    <div className={`inline-flex items-center overflow-hidden rounded-[12px] border border-line-strong bg-surface ${className}`}>
      <button type="button" aria-label={decLabel} disabled={decOff} onClick={() => bump(-1)} className={`grid place-items-center text-ink transition-[background-color,transform] duration-[var(--dur-quick)] active:bg-surface-2 disabled:opacity-35 ${btn}`}>
        <Icon name="minus" size={size === "kitchen" ? "l" : size === "sm" ? "s" : "m"} />
      </button>
      <output aria-live="polite" className={`inline-block text-center font-display font-bold tabular-nums transition-opacity ${busy ? "opacity-50" : ""} ${num}`}>
        <span key={tick.n} className={`inline-block ${tick.n ? "k-tick" : ""}`} style={{ "--dir": tick.dir } as CSSProperties}>
          {cur}
        </span>
        {unit && <span className="ml-0.5 text-[0.6em] font-semibold text-ink-2">{unit}</span>}
      </output>
      <button type="button" aria-label={incLabel} disabled={incOff} onClick={() => bump(1)} className={`grid place-items-center text-ink transition-[background-color,transform] duration-[var(--dur-quick)] active:bg-surface-2 disabled:opacity-35 ${btn}`}>
        <Icon name="plus" size={size === "kitchen" ? "l" : size === "sm" ? "s" : "m"} />
      </button>
      {name && <input type="hidden" name={name} value={cur} />}
    </div>
  );
}

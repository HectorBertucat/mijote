"use client";

// Segmented (sélecteur à segments, aria-pressed) et Tabs (onglets soulignés, role=tablist). Composants client.
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type SegOption<T extends string> = { value: T; label?: ReactNode; icon?: IconName; ariaLabel?: string; disabled?: boolean };

/** Segments exclusifs. Contrôlé (`value` + `onChange`) ou libre (`defaultValue`). `tone="inverse"` sur fond d'encre ; `size="icon"` pour des segments à icône seule (thème). */
export function Segmented<T extends string>({ options, value, defaultValue, onChange, label, tone = "default", size = "md", className = "" }: { options: SegOption<T>[]; value?: T; defaultValue?: T; onChange?: (v: T) => void; label: string; tone?: "default" | "inverse"; size?: "md" | "icon"; className?: string }) {
  const [inner, setInner] = useState<T | undefined>(defaultValue ?? options[0]?.value);
  const cur = value ?? inner;
  const wrap = tone === "inverse" ? "border-transparent bg-[color-mix(in_srgb,var(--c-on-inverse)_12%,transparent)]" : "border-line bg-surface-2";
  const pad = size === "icon" ? "gap-0.5 rounded-[9px] p-0.5" : "gap-0.5 rounded-[12px] p-[3px]";
  return (
    <div role="group" aria-label={label} className={`inline-flex w-fit max-w-full justify-self-start border ${wrap} ${pad} ${className}`}>
      {options.map((o) => {
        const on = o.value === cur;
        const look =
          tone === "inverse"
            ? on ? "bg-on-inverse text-inverse" : "text-[color-mix(in_srgb,var(--c-on-inverse)_70%,transparent)]"
            : on ? "bg-surface text-ink shadow-e1" : "text-ink-2 hover:text-ink";
        const shape = size === "icon" ? "h-7 w-[30px] justify-center rounded-[7px]" : "min-h-9 gap-1.5 rounded-[9px] px-3 text-[14px] font-semibold";
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            onClick={() => {
              setInner(o.value);
              onChange?.(o.value);
            }}
            className={`inline-flex items-center transition-[background-color,color,transform] duration-[var(--dur-quick)] active:scale-[0.96] disabled:opacity-45 ${shape} ${look}`}
          >
            {o.icon && <Icon name={o.icon} size="s" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

/** Onglets soulignés d'accent. Contrôlé (`value` + `onChange`) ou libre (`defaultValue`). Le contenu est à la charge de l'appelant (`aria-controls` via `idPrefix`). */
export function Tabs<T extends string>({ items, value, defaultValue, onChange, label, idPrefix, className = "" }: { items: TabItem<T>[]; value?: T; defaultValue?: T; onChange?: (v: T) => void; label: string; idPrefix?: string; className?: string }) {
  const [inner, setInner] = useState<T | undefined>(defaultValue ?? items[0]?.value);
  const cur = value ?? inner;
  const pick = (v: T) => {
    setInner(v);
    onChange?.(v);
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`k-noscroll flex gap-1 overflow-x-auto border-b border-line ${className}`}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = items.findIndex((t) => t.value === cur);
        const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
        pick(next.value);
        (e.currentTarget.querySelector(`[data-tab="${next.value}"]`) as HTMLElement | null)?.focus();
      }}
    >
      {items.map((t) => {
        const on = t.value === cur;
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            data-tab={t.value}
            id={idPrefix ? `${idPrefix}-tab-${t.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.value}` : undefined}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => pick(t.value)}
            className={`-mb-px whitespace-nowrap border-b-[2.5px] px-3 py-2.5 text-[15px] font-semibold transition-colors duration-[var(--dur-quick)] active:scale-100 ${on ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
            {t.count != null && <span className="num ml-1.5 text-faint">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

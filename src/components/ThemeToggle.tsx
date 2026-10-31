"use client";

// Sélecteur de thème : un bouton qui fait le tour Auto / Clair / Sombre (icônes auto, sun, moon). Le choix vit sur l'appareil
// (localStorage `mijote.theme`, absent = suivre le système), posé avant le premier rendu par le script de layout.tsx.
import { useEffect, useState } from "react";
import { Icon } from "./ui/icon";

type Mode = "system" | "light" | "dark";
const KEY = "mijote.theme";

function apply(m: Mode) {
  const root = document.documentElement;
  if (m === "system") delete root.dataset.theme;
  else root.dataset.theme = m;
  try {
    if (m === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, m);
  } catch {}
}

const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "Thème : suit le système", light: "Thème : clair", dark: "Thème : sombre" };
const ICON = { system: "auto", light: "sun", dark: "moon" } as const;

/** Un seul bouton qui fait le tour Auto → Clair → Sombre (l'en-tête reste léger). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setMode(t === "light" || t === "dark" ? t : "system");
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const m = NEXT[mode];
        setMode(m);
        apply(m);
      }}
      aria-label={`${LABEL[mode]} (changer)`}
      title={LABEL[mode]}
      className={`grid size-tap place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink ${className}`}
    >
      <Icon name={ICON[mode]} />
    </button>
  );
}

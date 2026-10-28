"use client";

// Sélecteur de thème segmenté Auto / Clair / Sombre (icônes auto, sun, moon). Le choix vit sur l'appareil
// (localStorage `mijote.theme`, absent = suivre le système), posé avant le premier rendu par le script de layout.tsx.
import { useEffect, useState } from "react";
import { Segmented } from "./ui/segmented";

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

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setMode(t === "light" || t === "dark" ? t : "system");
  }, []);
  return (
    <Segmented<Mode>
      label="Thème"
      size="icon"
      className={className}
      value={mode}
      onChange={(m) => {
        setMode(m);
        apply(m);
      }}
      options={[
        { value: "system", icon: "auto", ariaLabel: "Thème : suivre le système" },
        { value: "light", icon: "sun", ariaLabel: "Thème clair" },
        { value: "dark", icon: "moon", ariaLabel: "Thème sombre" },
      ]}
    />
  );
}

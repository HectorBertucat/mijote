// Check : case à cocher animée (la case se remplit, la coche se trace, le libellé se barre de gauche à droite).
// Case native cachée : marche dans un <form> serveur (name/value) comme en contrôlé (checked + onChange, composant client).
import type { InputHTMLAttributes, ReactNode } from "react";

/** Case du kit. `children` = libellé barré une fois cochée (`strike={false}` pour ne pas barrer) ; `size="kitchen"` agrandit la case. */
export function Check({ children, strike = true, size = "md", className = "", ...input }: { children?: ReactNode; strike?: boolean; size?: "md" | "kitchen" } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">) {
  const box = size === "kitchen" ? "size-9 rounded-[9px]" : "size-[26px] rounded-[7px]";
  const svg = size === "kitchen" ? 24 : 18;
  return (
    <label className={`k-check relative inline-flex min-h-tap cursor-pointer items-center gap-3 ${className}`}>
      <input type="checkbox" className="peer absolute size-px opacity-0" {...input} />
      <span className={`k-box grid shrink-0 place-items-center transition-[background-color,border-color,transform] duration-[var(--dur-quick)] ease-[var(--ease-out)] ${box}`}>
        <svg viewBox="0 0 24 24" width={svg} height={svg} fill="none" stroke="var(--c-on-accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      {children != null && <span className={strike ? "k-lbl" : ""}>{children}</span>}
    </label>
  );
}

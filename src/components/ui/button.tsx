// Button et buttonClass : boutons de la DA v3 (primary plein encre, accent cocotte réservé à l'action du moment,
// secondary, quiet, danger, inverse, ink), tailles sm / normal / kitchen,
// icône seule, états chargement (roue + texte qui dit ce qui se passe) et fait (bleu pâle + coche qui « pop »).
// Sans hook : utilisable dans une page serveur tant qu'on ne passe pas de onClick.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type ButtonVariant = "primary" | "accent" | "secondary" | "quiet" | "danger" | "danger-solid" | "inverse" | "ink" | "on-inverse";
export type ButtonSize = "sm" | "md" | "kitchen";
export type ButtonState = "idle" | "loading" | "done";

const BASE = "k-btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap border font-sans font-bold tracking-[-0.005em] disabled:cursor-not-allowed disabled:opacity-40";
const VARIANT: Record<ButtonVariant, string> = {
  // Plein encre : l'action principale d'un écran. La couleur reste au plat ; l'accent est rare.
  primary: "border-transparent bg-inverse text-on-inverse hover:bg-[color-mix(in_srgb,var(--c-inverse)_86%,var(--c-bg))]",
  // Cocotte : seulement l'action « maintenant » (cuisiner, valider la semaine).
  accent: "border-transparent bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border-line-strong bg-transparent text-ink hover:border-ink hover:bg-surface",
  quiet: "border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border-[color-mix(in_srgb,var(--c-ko)_45%,transparent)] bg-surface text-ko hover:bg-ko-soft",
  "danger-solid": "border-transparent bg-ko text-on-accent hover:bg-[color-mix(in_srgb,var(--c-ko)_88%,var(--c-ink))]",
  // Sur fond d'encre (bandeau de session, minuteur fini, toast) : contour clair.
  inverse: "border-[color-mix(in_srgb,var(--c-on-inverse)_38%,transparent)] bg-transparent text-on-inverse hover:bg-[color-mix(in_srgb,var(--c-on-inverse)_12%,transparent)]",
  // Plein d'encre (« Fait » de la session sur téléphone, « Arrêter » du minuteur fini) : le contraste maximal.
  ink: "border-transparent bg-inverse text-on-inverse hover:bg-[color-mix(in_srgb,var(--c-inverse)_86%,var(--c-bg))]",
  // Plein, posé sur un fond d'encre (minuteur fini en plein écran).
  "on-inverse": "border-transparent bg-on-inverse text-inverse hover:bg-[color-mix(in_srgb,var(--c-on-inverse)_88%,var(--c-inverse))]",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 rounded-[8px] px-3 text-[14px]",
  md: "min-h-tap rounded-[8px] px-4 text-[16px]",
  kitchen: "min-h-kitchen rounded-[8px] px-6 text-[20px]",
};
const ICON_ONLY: Record<ButtonSize, string> = { sm: "w-9 !px-0", md: "w-tap !px-0", kitchen: "w-kitchen !px-0" };
const DONE = "!border-transparent !bg-accent-soft !text-accent !shadow-none";

/** Classes d'un bouton, pour donner l'allure d'un bouton à un <Link> ou un <a>. */
export function buttonClass({ variant = "secondary", size = "md", iconOnly = false, block = false, className = "" }: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; block?: boolean; className?: string } = {}) {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${iconOnly ? ICON_ONLY[size] : ""} ${block ? "w-full" : ""} ${className}`;
}

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icône à gauche du texte (ou seule si `iconOnly`). */
  icon?: IconName;
  /** Bouton carré sans texte visible : `aria-label` obligatoire. */
  iconOnly?: boolean;
  block?: boolean;
  /** loading : roue à la place de l'icône, désactivé ; done : fond bleu pâle et coche. */
  state?: ButtonState;
  loadingLabel?: ReactNode;
  doneLabel?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/** Bouton du kit. `state` pilote chargement / fait ; les libellés `loadingLabel` / `doneLabel` remplacent le texte. */
export function Button({ variant = "secondary", size = "md", icon, iconOnly, block, state = "idle", loadingLabel, doneLabel, children, className = "", type = "button", disabled, ...rest }: ButtonProps) {
  const iconSize = size === "kitchen" ? "l" : size === "sm" ? "s" : "m";
  const loading = state === "loading";
  const done = state === "done";
  const label = loading ? (loadingLabel ?? children) : done ? (doneLabel ?? children) : children;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${buttonClass({ variant, size, iconOnly, block })} ${done ? DONE : ""} ${loading ? "!cursor-progress !opacity-100" : ""} ${className}`}
      {...rest}
    >
      {loading ? <span className="k-spin" aria-hidden /> : done ? <Icon name="check" size={iconSize} className="animate-pop" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {iconOnly ? null : label}
    </button>
  );
}

// Button et buttonClass : boutons de la DA (primary, secondary, quiet, danger, inverse, ink), tailles sm / normal / kitchen,
// icône seule, états chargement (roue + texte qui dit ce qui se passe) et fait (bleu pâle + coche qui « pop »).
// Sans hook : utilisable dans une page serveur tant qu'on ne passe pas de onClick.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "danger-solid" | "inverse" | "ink" | "on-inverse";
export type ButtonSize = "sm" | "md" | "kitchen";
export type ButtonState = "idle" | "loading" | "done";

const BASE = "k-btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap border font-display font-[650] [font-stretch:100%] disabled:cursor-not-allowed disabled:opacity-45";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-accent text-on-accent shadow-e1 hover:bg-accent-hover",
  secondary: "border-line-strong bg-surface text-ink hover:bg-[color-mix(in_srgb,var(--c-surface)_88%,var(--c-ink))]",
  quiet: "border-transparent bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border-[color-mix(in_srgb,var(--c-ko)_45%,transparent)] bg-surface text-ko hover:bg-ko-soft",
  "danger-solid": "border-transparent bg-ko text-on-accent hover:bg-[color-mix(in_srgb,var(--c-ko)_88%,var(--c-ink))]",
  // Sur fond d'encre (bandeau de session, minuteur fini, toast) : contour clair.
  inverse: "border-[color-mix(in_srgb,var(--c-on-inverse)_38%,transparent)] bg-transparent text-on-inverse hover:bg-[color-mix(in_srgb,var(--c-on-inverse)_12%,transparent)]",
  // Plein d'encre (« Fait » de la session sur téléphone, « Arrêter » du minuteur fini) : le contraste maximal.
  ink: "border-transparent bg-inverse text-on-inverse shadow-e1 hover:bg-[color-mix(in_srgb,var(--c-inverse)_88%,var(--c-bg))]",
  // Plein, posé sur un fond d'encre (minuteur fini en plein écran).
  "on-inverse": "border-transparent bg-on-inverse text-inverse hover:bg-[color-mix(in_srgb,var(--c-on-inverse)_88%,var(--c-inverse))]",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-[34px] rounded-[8px] px-3 text-[14px]",
  md: "min-h-tap rounded-[10px] px-4 text-[15px]",
  kitchen: "min-h-kitchen rounded-[16px] px-6 text-[20px]",
};
const ICON_ONLY: Record<ButtonSize, string> = { sm: "w-[34px] !px-0", md: "w-tap !px-0", kitchen: "w-kitchen !px-0" };
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
      {loading ? <span className="k-spin" aria-hidden /> : done ? <Icon name="check" size={iconSize} className="animate-[k-pop_260ms_var(--ease-spring)]" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {iconOnly ? null : label}
    </button>
  );
}

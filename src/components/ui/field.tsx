// Field (libellé + aide ou erreur), Input (48 px, icône de recherche ou autre, état erreur) et Textarea. Sans état.
import { useId, type ComponentProps, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

const INPUT = "min-h-12 w-full rounded-[8px] border bg-surface px-4 text-[17px] text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--c-accent-soft)] focus:outline-none disabled:opacity-50";

/** Champ texte. `icon` (p. ex. "search") se pose à gauche ; `invalid` borde en rouge et met aria-invalid ; `num` pour des chiffres tabulaires. */
export function Input({ icon, invalid = false, num = false, className = "", ...rest }: { icon?: IconName; invalid?: boolean; num?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const input = <input aria-invalid={invalid || undefined} className={`${INPUT} ${invalid ? "border-ko" : "border-line-strong"} ${icon ? "pl-[42px]" : ""} ${num ? "num" : ""} ${className}`} {...rest} />;
  if (!icon) return input;
  return (
    <span className="relative flex items-center">
      <Icon name={icon} className="pointer-events-none absolute left-3.5 text-faint" />
      {input}
    </span>
  );
}

/** Zone de texte, même allure que Input (accepte `ref`). */
export function Textarea({ invalid = false, className = "", ...rest }: { invalid?: boolean } & ComponentProps<"textarea">) {
  return <textarea aria-invalid={invalid || undefined} className={`${INPUT} py-3 leading-normal ${invalid ? "border-ko" : "border-line-strong"} ${className}`} {...rest} />;
}

/** Libellé, champ, puis aide (gris) ou erreur (rouge foncé, remplace l’aide). `children` reçoit l’id à poser sur le champ. */
export function Field({ label, help, error, children, className = "" }: { label: ReactNode; help?: ReactNode; error?: ReactNode; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const hid = help || error ? `${id}-help` : undefined;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="label text-ink-2">
        {label}
      </label>
      {children(id, hid)}
      {(error || help) && (
        <span id={hid} className={`text-[13px] ${error ? "text-ko-ink" : "text-ink-2"}`}>
          {error ?? help}
        </span>
      )}
    </div>
  );
}

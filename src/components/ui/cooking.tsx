// Repères de cuisson : Induction (niveau 1-9 en segments), OvenLevel (gradin du four), SpecChip (récipient, foyer, durée…), Cue (repère sensoriel). Sans état.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/** Niveau d’induction : 9 segments croissants, le chiffre et « /9 ». `size="big"` pour la session (lu à 1 m, sans « /9 »). */
export function Induction({ level, size = "md", className = "" }: { level: number; size?: "md" | "big"; className?: string }) {
  const big = size === "big";
  const lv = Math.max(0, Math.min(9, Math.round(level)));
  return (
    <span role="img" aria-label={`Induction niveau ${lv} sur 9`} className={`inline-flex items-center gap-2 ${className}`}>
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} className={`block rounded-[1.5px] ${i < lv ? "bg-ink" : "bg-line-strong"}`} style={{ width: big ? 10 : 5, height: big ? 8 + (i + 1) * 3.4 : 4 + (i + 1) * 1.4 }} />
        ))}
      </span>
      <b className="font-display font-extrabold leading-none tabular-nums" style={{ fontSize: big ? 44 : 18 }} aria-hidden>
        {lv}
      </b>
      {!big && (
        <span className="text-[13px] text-ink-2" aria-hidden>
          /9
        </span>
      )}
    </span>
  );
}

/** Gradin du four : `rails` traits (5 par défaut), celui de `level` (1 = haut) épaissi. */
export function OvenLevel({ level, rails = 5, className = "" }: { level: number; rails?: number; className?: string }) {
  return (
    <span role="img" aria-label={`Gradin ${level} sur ${rails}`} className={`inline-grid w-[22px] gap-0.5 ${className}`}>
      {Array.from({ length: rails }, (_, i) => (
        <i key={i} className={`block rounded-[1px] ${i + 1 === level ? "h-1 bg-ink" : "h-[3px] bg-line-strong"}`} />
      ))}
    </span>
  );
}

/** Puce de spécification d’une étape : icône (pan, pot, hob, oven, clock, fridge…) ou un élément en tête (`lead`, p. ex. <Induction/>), puis le texte. */
export function SpecChip({ icon, lead, children, className = "" }: { icon?: IconName; lead?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] bg-surface-2 px-2.5 text-[14px] font-semibold ${className}`}>
      {icon && <Icon name={icon} size="s" />}
      {lead}
      {children != null && <span>{children}</span>}
    </span>
  );
}

const SENSE: Record<"ear" | "eye" | "nose" | "bell" | "clock" | "scale", IconName> = { ear: "ear", eye: "eye", nose: "nose", bell: "bell", clock: "clock", scale: "scale" };

/** Repère sensoriel ou sonore : `sense` (ear = ça chante, eye = ça se voit, nose = ça sent, bell = minuteur), `quote` en gras entre guillemets, puis l’explication. */
export function Cue({ sense = "eye", quote, children, className = "" }: { sense?: keyof typeof SENSE; quote?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-[10px] bg-surface-2 px-3 py-2.5 text-[15px] ${className}`}>
      <Icon name={SENSE[sense]} className="mt-0.5 text-ink-2" />
      <span>
        {quote != null && <q className="font-semibold" style={{ quotes: '"«\u00a0" "\u00a0»"' }}>{quote}</q>} {children}
      </span>
    </div>
  );
}

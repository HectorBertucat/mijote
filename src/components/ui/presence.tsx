// Presence (pastille de présence d'une personne à un repas : initiale + maison / bureau / absent) et PresenceDots
// (deux points compacts, grille de la semaine sur téléphone). Sans hook : le tap est à la charge de l'appelant.
import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./icon";

export type Place = "home" | "office" | "away";
export const PLACE_WORD: Record<Place, string> = { home: "maison", office: "bureau", away: "absent" };
const PLACE_ICON: Record<Place, IconName> = { home: "home", office: "brief", away: "dash" };

/** Pastille : rond d'encre avec l'initiale, puis l'icône du lieu ; absent = pointillés, gris. `size="lg"` (feuille du téléphone) = 40 px de haut, avec le mot.
 * Rendu en <button> : passer `onClick`, et `pending` pour le point qui pulse tant que le serveur n'a pas répondu. */
export function Presence({ initial, name, place, size = "md", pending = false, className = "", ...rest }: { initial: string; name: string; place: Place; size?: "md" | "lg"; pending?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const away = place === "away";
  const lg = size === "lg";
  return (
    <button
      type="button"
      aria-label={`${name} : ${PLACE_WORD[place]} (toucher pour changer)`}
      title={`${name} : ${PLACE_WORD[place]}`}
      className={`relative inline-flex shrink-0 items-center rounded-full border font-bold transition-[transform,background-color,border-color] duration-[var(--dur-press)] ease-[var(--ease-out)] before:absolute before:-inset-1.5 before:content-[''] active:scale-90 ${lg ? "h-10 gap-2 pl-1 pr-3 text-[15px]" : "h-6 gap-[3px] pl-[3px] pr-1.5 text-[11px]"} ${away ? "border-dashed border-line-strong bg-transparent text-faint" : "border-line-strong bg-surface text-ink"} ${className}`}
      {...rest}
    >
      <span className={`grid shrink-0 place-items-center rounded-full font-display ${lg ? "size-8 text-[14px]" : "size-[18px] text-[10px]"} ${away ? "bg-surface-2 text-faint" : "bg-inverse text-on-inverse"}`}>{initial}</span>
      <Icon name={PLACE_ICON[place]} size={lg ? 18 : 12} strokeWidth={2.2} />
      {lg && <span>{PLACE_WORD[place]}</span>}
      {pending && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 animate-ping rounded-full bg-accent" />}
    </button>
  );
}

/** Points de présence compacts : plein = mange (maison ou bureau), cerclé = absent. */
export function PresenceDots({ places, className = "" }: { places: { name: string; place: Place }[]; className?: string }) {
  return (
    <span className={`flex gap-0.5 ${className}`} role="img" aria-label={places.map((p) => `${p.name} ${PLACE_WORD[p.place]}`).join(", ")}>
      {places.map((p, i) => (
        <i key={i} className={`size-[7px] rounded-full ${p.place === "away" ? "border border-faint" : p.place === "office" ? "border-[1.5px] border-ink bg-surface" : "bg-ink"}`} />
      ))}
    </span>
  );
}

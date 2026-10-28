"use client";

// Stamp : cachet d'encre (tampon de marché). Une seule encre (couleur de recette ou de rubrique, bleu pour une
// confirmation), bords irréguliers (filtre SVG), inclinaison fixe tirée de `seed`. `fresh` : il se pose avec un
// « pof » (une seule fois, au moment où la chose arrive) ; sinon il est simplement là. Deux par écran au plus.
import { useId, type CSSProperties } from "react";
import { stampAngle } from "./angle";

export type StampShape = "round" | "rect" | "wavy" | "heart" | "badge";
export type StampIcon = "leaf" | "snow" | "clock" | "pot" | "basket" | "check";

const ICONS: Record<StampIcon, string> = {
  leaf: "M0-18c-13 8-15 23-4 31 7-4 13-15 4-31zM-4 13l-6 10",
  snow: "M0-17V17M-15-8.5 15 8.5M-15 8.5 15-8.5M-4-13 0-9 4-13M-4 13 0 9 4 13",
  clock: "M0-15a15 15 0 1 1 0 30a15 15 0 1 1 0-30M0-8V0l7 5",
  pot: "M-15-3h30v10a8 8 0 0 1-8 8h-14a8 8 0 0 1-8-8zM-19-3h38M-6-11c0-4 4-4 4-8M4-11c0-4 4-4 4-8",
  basket: "M-17-4h34l-4 18h-26zM-10-4l6-12M10-4l-6-12M-6 3v5M0 3v5M6 3v5",
  check: "M-13 0l8 8 18-17",
};

// Boîtes de chaque forme (viewBox), le texte se place dedans.
/** Garde un mot dans sa boîte : au-delà de `max` px (largeur estimée), le texte est resserré à `max`. */
const fitText = (text: string, size: number, spacing: number, max: number) => (text.length * (size * 0.8 + spacing) > max ? { textLength: max, lengthAdjust: "spacingAndGlyphs" as const } : {});

const BOX: Record<StampShape, [number, number]> = { round: [120, 120], rect: [170, 84], wavy: [170, 76], heart: [120, 110], badge: [110, 110] };

export function Stamp({
  label,
  sub,
  center,
  shape = "rect",
  icon,
  color = "var(--c-accent)",
  seed,
  angle,
  size,
  fresh = false,
  className = "",
  title,
}: {
  /** Le mot du cachet (« COMMANDÉ », « FAIT MAISON »), en capitales. */
  label: string;
  /** Petite ligne (date, lieu). */
  sub?: string;
  /** Rond, cœur : le gros texte du centre (« 19 », « J »). */
  center?: string;
  shape?: StampShape;
  icon?: StampIcon;
  /** Valeur CSS : var(--c-recipe-3), var(--c-sec-semaine)… */
  color?: string;
  /** Graine de l'inclinaison (id de la liste, slug…). Sinon le mot. */
  seed?: string;
  angle?: number;
  /** Largeur en px (la hauteur suit la forme). */
  size?: number;
  fresh?: boolean;
  className?: string;
  /** Texte lu par les lecteurs d'écran (sinon le mot et la petite ligne). */
  title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [w, h] = BOX[shape];
  const px = size ?? (shape === "round" || shape === "heart" || shape === "badge" ? 96 : 132);
  const rot = angle ?? stampAngle(seed ?? label);
  const ink = `url(#ink${uid})`;
  const T = { fill: "currentColor", stroke: "none", textAnchor: "middle" as const };
  const words = label.toUpperCase();
  const long = words.length > 9;
  return (
    <span
      role="img"
      aria-label={title ?? [label, sub].filter(Boolean).join(", ")}
      title={title ?? [label, sub].filter(Boolean).join(" · ")}
      className={`k-stamp pointer-events-none inline-block shrink-0 select-none ${fresh ? "is-fresh" : ""} ${className}`}
      style={{ "--rot": `${rot}deg`, color, width: px } as CSSProperties}
    >
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" aria-hidden className="font-display block overflow-visible" style={{ letterSpacing: 0 }}>
        <defs>
          <filter id={`ink${uid}`} x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={(uid.length * 7) % 97} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="1" seed={(uid.length * 13) % 89} result="sp" />
            <feColorMatrix in="sp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.75" result="mask" />
            <feComposite in="rough" in2="mask" operator="in" />
          </filter>
          {shape === "round" && <path id={`arc${uid}`} d="M60 60 m-40 0 a40 40 0 1 1 80 0 a40 40 0 1 1 -80 0" />}
        </defs>
        <g filter={ink} fill="none" stroke="currentColor">
          {shape === "round" && (
            <>
              <circle cx="60" cy="60" r="56" strokeWidth="4" />
              <circle cx="60" cy="60" r="29" strokeWidth="2.2" />
              <text {...T} textAnchor="start" fontWeight="800" fontSize="13" letterSpacing="2">
                <textPath href={`#arc${uid}`} startOffset="0" textLength={246} lengthAdjust="spacing">
                  {`${words} · ${words} ·`}
                </textPath>
              </text>
              {center && (
                <text {...T} x="60" y={sub ? 63 : 67} fontWeight="900" fontSize={center.length > 2 ? 15 : 20}>
                  {center}
                </text>
              )}
              {sub && (
                <text {...T} x="60" y={center ? 76 : 64} fontWeight="700" fontSize="9.5" letterSpacing="1">
                  {sub.toUpperCase()}
                </text>
              )}
              {!center && !sub && icon && <path d={ICONS[icon]} transform="translate(60 60) scale(.8)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
            </>
          )}
          {shape === "rect" && (
            <>
              <rect x="5" y="5" width="160" height="74" rx="5" strokeWidth="4" />
              <rect x="12" y="12" width="146" height="60" rx="2.5" strokeWidth="1.8" />
              <text {...T} x="85" y={sub ? 47 : 53} fontWeight="900" fontSize={long ? 19 : 24} letterSpacing="1.5" {...fitText(words, long ? 19 : 24, 1.5, 138)}>
                {words}
              </text>
              {sub && (
                <text {...T} x="85" y="63" fontWeight="650" fontSize="9" letterSpacing="1" {...fitText(sub, 9, 1, 136)}>
                  {sub.toUpperCase()}
                </text>
              )}
            </>
          )}
          {shape === "wavy" && (
            <>
              <path d="M8 8q6 5 12 0t12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 12 0 6 0v60q-6-5-12 0t-12 0-12 0-12 0-12 0-12 0-12 0-12 0-12 0-12 0-12 0-12 0-12 0-6 0z" strokeWidth="3.4" strokeLinejoin="round" />
              <text {...T} x="85" y={sub ? 40 : 47} fontWeight="900" fontSize={long ? 17 : 22} letterSpacing="1.5" {...fitText(words, long ? 17 : 22, 1.5, 140)}>
                {words}
              </text>
              {sub && (
                <text {...T} x="85" y="56" fontWeight="650" fontSize="10" letterSpacing="1.4">
                  {sub.toUpperCase()}
                </text>
              )}
            </>
          )}
          {shape === "heart" && (
            <>
              <path d="M60 102C24 80 8 60 12 42c4-18 30-21 48-2 18-19 44-16 48 2 4 18-12 38-48 60z" strokeWidth="4" strokeLinejoin="round" />
              <text {...T} x="60" y="60" fontWeight="900" fontSize="26">
                {center ?? words.slice(0, 1)}
              </text>
              <text {...T} x="60" y="76" fontWeight="750" fontSize="10" letterSpacing="1.6">
                {words}
              </text>
            </>
          )}
          {shape === "badge" && (
            <>
              <circle cx="55" cy="55" r="50" strokeWidth="3.2" strokeDasharray="5 3.5" />
              {icon && <path d={ICONS[icon]} transform="translate(55 40) scale(.9)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
              <text {...T} x="55" y={icon ? 76 : 60} fontWeight="850" fontSize="10.5" letterSpacing="1" {...fitText(words, 10.5, 1, 78)}>
                {words}
              </text>
              {sub && !icon && (
                <text {...T} x="55" y="74" fontWeight="650" fontSize="9" letterSpacing="1">
                  {sub.toUpperCase()}
                </text>
              )}
            </>
          )}
        </g>
      </svg>
    </span>
  );
}

// Les cachets de l'appli : un seul endroit pour leur forme, leur encre et leur mot.
type P = Partial<Parameters<typeof Stamp>[0]>;
const dayMonth = (d: Date) => ({ day: String(d.getDate()), month: d.toLocaleDateString("fr-FR", { month: "short", timeZone: "Europe/Paris" }).replace(".", "") });

/** Fin de session : « Fait maison » avec le jour. */
export function StampFaitMaison({ date, ...p }: P & { date: Date }) {
  const { day, month } = dayMonth(date);
  return <Stamp shape="round" label="Fait maison" center={day} sub={month} color="var(--c-recipe-2)" seed={`fm${date.toDateString()}`} {...p} />;
}
/** Liste de courses validée. */
export function StampCommande({ date, ...p }: P & { date?: Date | null }) {
  const sub = date ? `drive · ${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" })} · ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", "h")}` : "drive";
  return <Stamp shape="rect" label="Commandé" sub={sub} color="var(--c-accent)" {...p} />;
}
export const StampSaison = (p: P) => <Stamp shape="badge" label="De saison" icon="leaf" color="var(--c-sec-semaine)" {...p} />;
export const StampCongele = (p: P) => <Stamp shape="badge" label="Se congèle" icon="snow" color="var(--c-recipe-3)" {...p} />;
export const StampNouveau = (p: P) => <Stamp shape="wavy" label="Nouveau" color="var(--c-recipe-5)" {...p} />;
export const StampSemainePrete = (p: P) => <Stamp shape="wavy" label="Semaine prête" color="var(--c-hot)" {...p} />;
export const StampExpress = ({ minutes, ...p }: P & { minutes: number }) => <Stamp shape="round" label="Express" center={`${minutes}`} sub="min" color="var(--c-recipe-1)" {...p} />;

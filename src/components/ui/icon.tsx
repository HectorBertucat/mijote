// Icon : le jeu de symboles de la DA « Plan de travail » (trait 1,8, coins ronds), sans état, utilisable côté serveur.
import type { SVGProps } from "react";

const PATHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  book: (<><path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16V4.5z" /><path d="M5 16a3.5 3.5 0 0 1 3.5-3.5H19M9 8h6" /></>),
  cal: (<><rect x="4" y="5.5" width="16" height="14" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>),
  pot: (<><path d="M5 10h14v6.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V10z" /><path d="M3 10h18M9 6.5c0-1.2.9-2 2-2h2c1.1 0 2 .8 2 2" /></>),
  basket: (<><path d="M4 9.5h16l-1.6 9a2 2 0 0 1-2 1.5H7.6a2 2 0 0 1-2-1.5L4 9.5z" /><path d="M8.5 9.5L11 4M15.5 9.5L13 4M9.5 13.5v3M14.5 13.5v3" /></>),
  pulse: <path d="M3 12.5h4l2-5 3.5 10 2.5-6.5 1.5 1.5H21" />,
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  auto: (<><rect x="3.5" y="5" width="17" height="11.5" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>),
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  alert: (<><path d="M12 4l9 15.5H3L12 4z" /><path d="M12 10v4M12 17v.5" /></>),
  info: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.5" /></>),
  ear: (<><path d="M7 9.5a5 5 0 0 1 10 0c0 3-3 3.5-3 6.5a3 3 0 0 1-5.5 1.5" /><path d="M10 10a2 2 0 0 1 4 0c0 1-1 1.5-1.5 2" /></>),
  eye: (<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>),
  nose: <path d="M6 15c2-1 3-3 4-6M10 19c1.5-1.5 2-3.5 2-6M14 19c.5-2 2-3.5 4-4M15 11c1-2 2.5-3 4-3.5" />,
  sliders: (<><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>),
  snow: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 6l2.5-1.5M9.5 19.5L12 18l2.5 1.5" />,
  fridge: (<><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M6 10h12M9 6v2M9 13v3" /></>),
  copy: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>),
  play: <path d="M8 5.5v13l10-6.5-10-6.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5l1.5-2zM10 20.5h4" />,
  leaf: <path d="M5 19c0-8 5-13.5 14.5-14-.5 9.5-6 14.5-14 14.5zM5 19l7-7" />,
  home: <path d="M4 11l8-6.5 8 6.5M6.5 9.5V19.5h11V9.5" />,
  brief: (<><rect x="3.5" y="7.5" width="17" height="12" rx="2" /><path d="M9 7.5V5.5h6v2M3.5 12.5h17" /></>),
  dash: <path d="M7 12h10" />,
  chev: <path d="M9.5 6l6 6-6 6" />,
  swap: <path d="M7 7.5h12l-3.5-3.5M17 16.5H5l3.5 3.5" />,
  hob: (<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="3" /><circle cx="16" cy="14" r="2.5" /></>),
  oven: (<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M3.5 8h17M7 6h.5M10 6h.5" /><rect x="7" y="11" width="10" height="6" rx="1" /></>),
  pan: (<><circle cx="10" cy="12" r="6.5" /><path d="M16.5 12h5" /></>),
  flame: <path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 2.5-1-3 0-6 1-8z" />,
  qr: (<><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2M20 14v6h-6v-2M17 17v.5" /></>),
  moonset: <path d="M15.5 13A6 6 0 0 1 9 5.5 6.5 6.5 0 1 0 15.5 13zM4 20h16" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  trash: <path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 12.5h8L17 7" />,
  archive: (<><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.2" /><path d="M5 9v9a1.8 1.8 0 0 0 1.8 1.8h10.4A1.8 1.8 0 0 0 19 18V9M10 13h4" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>),
  wave: <path d="M3 9c2 0 2-2 4.5-2S10 9 12 9s2-2 4.5-2S19 9 21 9M3 15c2 0 2-2 4.5-2S10 15 12 15s2-2 4.5-2S19 15 21 15" />,
  kb: (<><path d="M9 8.5a3 3 0 0 1 6 0" /><path d="M8 8.5h8l1.5 3a6 6 0 1 1-11 0L8 8.5z" /></>),
  scale: (<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M8.5 9.5a4 4 0 0 1 7 0L12 11" /></>),
  sparkdraft: <path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4zM13.5 7.5l3 3" />,
  // Préféré (produit du drive) : passer fill="currentColor" pour l’état actif.
  star: <path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.6l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 4.2z" />,
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

const SIZE = { s: 16, m: 20, l: 28 } as const;
export type IconSize = keyof typeof SIZE;

/** Icône du jeu de la DA. `size` s=16, m=20 (défaut), l=28 ; `label` la rend lisible par les lecteurs d’écran, sinon décorative. */
export function Icon({ name, size = "m", label, strokeWidth = 1.8, className = "", ...rest }: { name: IconName; size?: IconSize | number; label?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const px = typeof size === "number" ? size : SIZE[size];
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

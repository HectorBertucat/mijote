// Images de démarrage iOS (apple-touch-startup-image) : l’écran que l’iPhone ou l’iPad montre pendant que l’appli
// installée s’ouvre. Une image par taille d’écran et par thème (papier ou encre), servie par /lancement.
// Pur et testé (tests/visite.test.ts).

/** Écrans en points CSS et densité : iPhone SE à 16 Pro Max, iPad mini à iPad Pro 12,9 pouces. */
export const LAUNCH_SCREENS: { w: number; h: number; dpr: 2 | 3 }[] = [
  { w: 440, h: 956, dpr: 3 },
  { w: 430, h: 932, dpr: 3 },
  { w: 428, h: 926, dpr: 3 },
  { w: 414, h: 896, dpr: 3 },
  { w: 414, h: 896, dpr: 2 },
  { w: 414, h: 736, dpr: 3 },
  { w: 402, h: 874, dpr: 3 },
  { w: 393, h: 852, dpr: 3 },
  { w: 390, h: 844, dpr: 3 },
  { w: 375, h: 812, dpr: 3 },
  { w: 375, h: 667, dpr: 2 },
  { w: 1024, h: 1366, dpr: 2 },
  { w: 834, h: 1194, dpr: 2 },
  { w: 820, h: 1180, dpr: 2 },
  { w: 810, h: 1080, dpr: 2 },
  { w: 744, h: 1133, dpr: 2 },
];

export type LaunchTheme = "clair" | "sombre";

/** Couleurs des jetons --c-bg et --c-ink (src/app/cuisine-tokens.css), en clair et en sombre : une image n’a pas de variables CSS. */
export const LAUNCH_COLORS: Record<LaunchTheme, { paper: string; ink: string; accent: string; hot: string; steam: string }> = {
  clair: { paper: "#f3f1ec", ink: "#15161a", accent: "#2342c4", hot: "#e4572e", steam: "#878a92" },
  sombre: { paper: "#111317", ink: "#f2f0eb", accent: "#8ea0ff", hot: "#ff6a3d", steam: "#878a92" },
};

/** Taille demandée à /lancement, acceptée seulement si c’est un écran connu (pas d’image à la taille de n’importe quoi). */
export function launchSize(w: number, h: number): { w: number; h: number } | null {
  return LAUNCH_SCREENS.some((s) => s.w * s.dpr === w && s.h * s.dpr === h) ? { w, h } : null;
}

/** Liens <link rel="apple-touch-startup-image"> : en portrait, un par écran et par thème. */
export function startupImages(): { url: string; media: string }[] {
  return LAUNCH_SCREENS.flatMap((s) =>
    (["clair", "sombre"] as const).map((t) => ({
      url: `/lancement?w=${s.w * s.dpr}&h=${s.h * s.dpr}&theme=${t}`,
      media: `(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait) and (prefers-color-scheme: ${t === "clair" ? "light" : "dark"})`,
    }))
  );
}

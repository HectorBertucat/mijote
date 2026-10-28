// Icône de l'écran d'accueil (iPhone, iPad) : le bol de src/app/icon.svg (même dessin, coins droits : iOS les arrondit),
// en PNG 180 × 180 généré au build.
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="0" fill="#f6f4f0"/>
  <path d="M24 14c-4 4 4 6 0 10M32 12c-4 4 4 6 0 10M40 14c-4 4 4 6 0 10" fill="none" stroke="#868a93" stroke-width="3" stroke-linecap="round"/>
  <path d="M8 30h48c0 13-10 22-24 22S8 43 8 30z" fill="#2342c4" stroke="#1b1d23" stroke-width="3" stroke-linejoin="round"/>
  <ellipse cx="32" cy="30" rx="24" ry="5" fill="#e4572e" stroke="#1b1d23" stroke-width="3"/>
  <path d="M15 37c3 6 8 9 13 10" fill="none" stroke="#e5eafb" stroke-width="3" stroke-linecap="round" opacity=".7"/>
</svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`data:image/svg+xml;base64,${Buffer.from(SVG).toString("base64")}`} width={180} height={180} alt="" />,
    size
  );
}

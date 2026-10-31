// Image de démarrage iOS (src/lib/launch.ts) : la cocotte du mot-symbole, seule au centre, sur le papier ou l’encre.
// /lancement?w=1179&h=2556&theme=clair ; seules les tailles d’écrans connus sont servies. PNG mis en cache un an.
import { ImageResponse } from "next/og";
import { LAUNCH_COLORS, launchSize, type LaunchTheme } from "@/lib/launch";

const cocotte = (c: (typeof LAUNCH_COLORS)[LaunchTheme]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path d="M12 1.5c-1.4 1.3 1.4 2.3 0 3.6" fill="none" stroke="${c.steam}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>
  <rect x="4.5" y="6.6" width="15" height="2.6" rx="1.3" fill="${c.hot}"/>
  <rect x="10.4" y="5" width="3.2" height="2" rx=".8" fill="${c.hot}"/>
  <path d="M3.2 10.4h17.6v5.6a6 6 0 0 1-6 6H9.2a6 6 0 0 1-6-6z" fill="${c.accent}"/>
  <path d="M1 12.2h2.2M20.8 12.2H23" stroke="${c.accent}" stroke-width="2.2" stroke-linecap="round"/>
</svg>`;

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const size = launchSize(Number(q.get("w")), Number(q.get("h")));
  if (!size) return new Response("taille inconnue", { status: 404 });
  const c = LAUNCH_COLORS[q.get("theme") === "sombre" ? "sombre" : "clair"];
  const side = Math.round(Math.min(size.w, size.h) * 0.22);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: c.paper }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(cocotte(c)).toString("base64")}`} width={side} height={side} alt="" />
      </div>
    ),
    { width: size.w, height: size.h, headers: { "Cache-Control": "public, max-age=31536000, immutable" } }
  );
}

// Avant chaque page : le mot de passe de l'instance s'il y en a un (src/lib/auth.ts), et le chemin
// demandé passé à la mise en page (en-tête x-mijote-path), qui ouvre /bienvenue tant que la mise en
// route n'est pas faite. En démo (MIJOTE_DEMO=1) : l'identifiant du visiteur, tiré de son cookie ou
// créé à sa première visite, passé aux pages (en-tête x-mijote-demo) pour qu'elles ouvrent sa base.
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, authToken, PUBLIC_PATHS } from "@/lib/auth";
import { DEMO_COOKIE, DEMO_HEADER, demoEnabled, isVisitorId, newVisitorId } from "@/lib/demo/core";

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (authEnabled() && !PUBLIC_PATHS.some((r) => r.test(path))) {
    const ok = req.cookies.get(AUTH_COOKIE)?.value === (await authToken());
    if (!ok) {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "connexion requise" }, { status: 401 });
      const url = new URL("/connexion", req.url);
      url.searchParams.set("suite", path + req.nextUrl.search);
      return NextResponse.redirect(url);
    }
  }
  const headers = new Headers(req.headers);
  headers.set("x-mijote-path", path);
  if (!demoEnabled()) {
    headers.delete(DEMO_HEADER);
    return NextResponse.next({ request: { headers } });
  }
  // L'en-tête vient toujours d'ici, jamais du navigateur.
  const known = req.cookies.get(DEMO_COOKIE)?.value;
  const visitor = isVisitorId(known) ? known : newVisitorId();
  headers.set(DEMO_HEADER, visitor);
  const res = NextResponse.next({ request: { headers } });
  if (visitor !== known) res.cookies.set(DEMO_COOKIE, visitor, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

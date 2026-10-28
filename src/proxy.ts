// Avant chaque page : le mot de passe de l'instance s'il y en a un (src/lib/auth.ts), et le chemin
// demandé passé à la mise en page (en-tête x-mijote-path), qui ouvre /bienvenue tant que la mise en
// route n'est pas faite.
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, authEnabled, authToken, PUBLIC_PATHS } from "@/lib/auth";

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
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

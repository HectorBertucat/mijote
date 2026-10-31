// Accès à l'instance (src/proxy.ts, src/lib/auth.ts) : sans mot de passe, tout est ouvert et la mise
// en page reçoit le chemin ; avec, tout passe par /connexion, sauf l'import Apple Santé (clé par personne).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { AUTH_COOKIE, authEnabled, authToken, PUBLIC_PATHS } from "@/lib/auth";

const req = (path: string, cookie?: string) => new NextRequest(new URL(path, "http://localhost:3010"), { headers: cookie ? { cookie } : {} });

test("sans mot de passe : tout passe, le chemin est transmis à la mise en page", async () => {
  delete process.env.MIJOTE_PASSWORD;
  assert.equal(authEnabled(), false);
  const r = await proxy(req("/recettes"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-middleware-request-x-mijote-path"), "/recettes");
});

test("avec mot de passe : redirection vers /connexion (avec la suite), 401 pour l'API, cookie qui ouvre", async () => {
  process.env.MIJOTE_PASSWORD = "pâte à crêpes";
  try {
    const page = await proxy(req("/semaine?w=2026-10-26"));
    assert.equal(page.status, 307);
    const to = new URL(page.headers.get("location")!);
    assert.equal(to.pathname, "/connexion");
    assert.equal(to.searchParams.get("suite"), "/semaine?w=2026-10-26");
    assert.equal((await proxy(req("/api/session/x/stream"))).status, 401);
    assert.equal((await proxy(req("/recettes", `${AUTH_COOKIE}=faux`))).status, 307);
    const ok = await proxy(req("/recettes", `${AUTH_COOKIE}=${await authToken()}`));
    assert.equal(ok.status, 200);
    // Chemins publics : connexion, import Apple Santé (il exige sa propre clé), manifeste.
    for (const p of ["/connexion", "/api/sante/import", "/manifest.webmanifest"]) assert.equal((await proxy(req(p))).status, 200, p);
    assert.ok(!PUBLIC_PATHS.some((r) => r.test("/api/sante/seance")), "le reste de l'API santé est protégé");
  } finally {
    delete process.env.MIJOTE_PASSWORD;
  }
});

test("empreinte du mot de passe : stable, différente d'un mot de passe à l'autre, jamais le mot de passe", async () => {
  const a = await authToken("secret");
  assert.equal(a, await authToken("secret"));
  assert.equal(a, await authToken("  secret "), "espaces autour ignorés");
  assert.notEqual(a, await authToken("Secret"));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes("secret"));
});

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false, // le contexte des agents est dans CLAUDE.md
  serverExternalPackages: ["better-sqlite3"],
  // `next build` ne revérifie pas les types : `pnpm typecheck` le fait déjà, obligatoirement, dans
  // la CI (vérification requise pour fusionner dans main) et au push (.githooks/pre-push). Une image
  // ou un serveur qui construit lui-même ne doit donc construire que des commits de main.
  typescript: { ignoreBuildErrors: true },
  // Les migrations et les recettes de départ sont lues au démarrage (src/lib/db/, src/seed/).
  outputFileTracingIncludes: {
    "/**": ["./src/lib/db/migrations/**/*", "./src/seed/recipes/**/*"],
  },
};

export default nextConfig;

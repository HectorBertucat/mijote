import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  agentRules: false, // le contexte des agents est dans CLAUDE.md
  serverExternalPackages: ["better-sqlite3"],
  // Les migrations et les recettes de départ sont lues au démarrage (src/lib/db/, src/seed/).
  outputFileTracingIncludes: {
    "/**": ["./src/lib/db/migrations/**/*", "./src/seed/recipes/**/*"],
  },
};

export default nextConfig;

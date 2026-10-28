# Mijote : image de production (Next.js standalone + SQLite).
#   docker compose up -d   (voir docker-compose.yml et docs/installation.md)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# La base de build est jetable : elle sert seulement aux pages pré-rendues.
RUN MIJOTE_DATA_DIR=/tmp/build-data pnpm build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3010 HOSTNAME=0.0.0.0 \
    MIJOTE_DATA_DIR=/data \
    MIJOTE_MIGRATIONS_DIR=/app/src/lib/db/migrations \
    MIJOTE_RECIPES_DIR=/app/src/seed/recipes
RUN useradd --system --uid 1001 mijote && mkdir -p /data && chown mijote /data
COPY --from=build --chown=mijote /app/.next/standalone ./
COPY --from=build --chown=mijote /app/.next/static ./.next/static
COPY --from=build --chown=mijote /app/public ./public
COPY --from=build --chown=mijote /app/src/lib/db/migrations ./src/lib/db/migrations
COPY --from=build --chown=mijote /app/src/seed/recipes ./src/seed/recipes
USER mijote
VOLUME /data
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3010/manifest.webmanifest').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

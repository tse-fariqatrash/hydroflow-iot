# ── Hydroflow Tanjung Manis — IoT Monitoring & EMS ───────────────────────────
# Multi-stage: better-sqlite3 is a native module and needs a toolchain to
# build, but nothing to run. The runtime image carries no compiler.

FROM node:20-bookworm-slim AS build
WORKDIR /app
# Toolchain for node-gyp (better-sqlite3). Removed with this whole stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund


FROM node:20-bookworm-slim AS runtime
# sqlite3 CLI is here for `docker compose exec` backups — `.backup` is the only
# safe way to copy a live WAL database.
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    MQTT_PORT=1883 \
    DB_FILE=/app/data/hydroflow.db

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY tests ./tests
COPY docs ./docs
COPY deploy ./deploy
COPY README.md ./

# The historian lives on a named volume; the image itself stays stateless.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000 1883

# tini reaps zombies and forwards SIGTERM, so the graceful shutdown in
# server/index.js actually runs and SQLite closes cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

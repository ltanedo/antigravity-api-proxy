# syntax=docker/dockerfile:1
# npm is only used in the dependency stage; the shipped runtime is Bun.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS dependencies
WORKDIR /app
COPY proxy-app/package.json proxy-app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS runtime
LABEL org.opencontainers.image.title="Antigravity Proxy" \
      org.opencontainers.image.source="https://github.com/ltanedo/antigravity-api-proxy" \
      org.opencontainers.image.version="0.4.0" \
      org.opencontainers.image.licenses="MIT"
USER root
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY proxy-app/package.json proxy-app/LICENSE ./
COPY proxy-app/src ./src
COPY proxy-app/public ./public
COPY container/entrypoint.sh /usr/local/bin/antigravity-entrypoint
RUN chmod 755 /usr/local/bin/antigravity-entrypoint \
    && mkdir -p /data/.config/antigravity-proxy \
    && chown -R 1000:1000 /data \
    && chmod 700 /data /data/.config /data/.config/antigravity-proxy
ENV NODE_ENV=production \
    HOME=/data \
    USERPROFILE=/data \
    HOST=0.0.0.0 \
    PORT=8086 \
    OAUTH_CALLBACK_PORT=38080 \
    ANTIGRAVITY_DISABLE_DB_FALLBACK=true
USER 1000:1000
# Fail the build if the production native dependency cannot load under Linux Bun.
RUN bun --eval 'const Database = require("better-sqlite3"); const db = new Database(":memory:"); if (db.prepare("select 1 as ok").get().ok !== 1) throw Error("SQLite smoke check failed"); db.close();'
# BuildKit mounts tests for verification without shipping them in the image.
RUN --mount=type=bind,source=proxy-app/tests,target=/app/tests \
    bun tests/test-openai-compat.cjs && bun tests/test-model-registry.cjs
EXPOSE 8086 38080
# Local HTTP liveness only: /health also queries Google quotas for linked accounts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["bun", "--eval", "const r = await fetch('http://127.0.0.1:8086/favicon.svg', {method: 'HEAD', signal: AbortSignal.timeout(4000)}); if (!r.ok) process.exit(1);"]
ENTRYPOINT ["/usr/local/bin/antigravity-entrypoint"]
CMD ["src/index.js"]

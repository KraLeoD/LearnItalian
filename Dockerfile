# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 compiles from source when a prebuilt binary is unavailable for
# the exact Node.js release. Keep the native build toolchain in this stage only.
RUN apt-get update \
    && apt-get install --no-install-recommends --yes python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown 10001:10001 /data
COPY --from=build --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=10001:10001 /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=10001:10001 /app/apps/web/web-build ./apps/web/web-build

USER 10001:10001
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]

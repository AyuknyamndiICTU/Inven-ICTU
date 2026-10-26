# syntax=docker/dockerfile:1
# LabPass API, worker and migrations (S14). Build from the repository root:
#   docker build -f deploy/docker/api.Dockerfile -t labpass/api .
# Targets: `build` (full toolchain: migrations, seed, reconcile) and `runtime` (default; production deps only).
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g --fetch-retries=5 pnpm@11.23.0
# Packages are cached across builds in a BuildKit cache mount; retries ride out flaky campus links.
ENV pnpm_config_store_dir=/pnpm/store pnpm_config_fetch_retries=5 pnpm_config_fetch_timeout=300000 pnpm_config_network_concurrency=8 \
  npm_config_store_dir=/pnpm/store npm_config_fetch_retries=5 npm_config_fetch_timeout=300000
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=labpass-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@labpass/api..."
RUN pnpm exec turbo run build --filter=@labpass/api
WORKDIR /repo/apps/api
CMD ["node", "scripts/prisma.cjs", "migrate", "deploy"]

FROM build AS deploy
WORKDIR /repo
# Self-contained API folder with production dependencies only (workspace packages copied in, not linked).
# dist/ is git-ignored, so it is copied explicitly; the Prisma client is generated with the build-stage CLI.
RUN --mount=type=cache,id=labpass-pnpm,target=/pnpm/store pnpm --filter @labpass/api deploy --prod --legacy /out \
  && rm -rf /out/dist && cp -r apps/api/dist /out/dist \
  && cd /out && /repo/node_modules/.bin/prisma generate --schema prisma/schema.prisma \
  && rm -rf /out/src /out/test /out/vitest.config.* /out/tsconfig*.json

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 STORAGE_DIR=/data/storage
WORKDIR /app
COPY --from=deploy /out ./
RUN mkdir -p /data/storage && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]

# syntax=docker/dockerfile:1
# LabPass admin console (Next.js standalone). Build from the repository root:
#   docker build -f deploy/docker/admin.Dockerfile -t labpass/admin .
# The /api rewrite target is fixed at build time; inside compose the API is http://api:4000.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g --fetch-retries=5 pnpm@11.23.0
# Packages are cached across builds in a BuildKit cache mount; retries ride out flaky campus links.
ENV pnpm_config_store_dir=/pnpm/store pnpm_config_fetch_retries=5 pnpm_config_fetch_timeout=300000 pnpm_config_network_concurrency=8 \
  npm_config_store_dir=/pnpm/store npm_config_fetch_retries=5 npm_config_fetch_timeout=300000
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=labpass-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@labpass/admin..."
ARG LABPASS_API_ORIGIN=http://api:4000
ENV LABPASS_API_ORIGIN=${LABPASS_API_ORIGIN}
RUN pnpm exec turbo run build --filter=@labpass/admin

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3100
WORKDIR /app
# Standalone output mirrors the monorepo layout (server at apps/admin/server.js).
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=node:node /repo/apps/admin/public ./apps/admin/public
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/admin/server.js"]

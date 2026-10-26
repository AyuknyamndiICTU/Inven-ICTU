# syntax=docker/dockerfile:1
# LabPass edge: Caddy serving the student PWA (Expo web export) and proxying the API and admin console.
#   docker build -f deploy/docker/web.Dockerfile -t labpass/web .
# EXPO_PUBLIC_* values are compiled into the bundle, so pass them as build args.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true EXPO_NO_TELEMETRY=1
RUN npm install -g --fetch-retries=5 pnpm@11.23.0
# Packages are cached across builds in a BuildKit cache mount; retries ride out flaky campus links.
ENV pnpm_config_store_dir=/pnpm/store pnpm_config_fetch_retries=5 pnpm_config_fetch_timeout=300000 pnpm_config_network_concurrency=8 \
  npm_config_store_dir=/pnpm/store npm_config_fetch_retries=5 npm_config_fetch_timeout=300000
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=labpass-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter "@labpass/mobile..."
ARG EXPO_PUBLIC_VAPID_PUBLIC_KEY=
ENV EXPO_PUBLIC_VAPID_PUBLIC_KEY=${EXPO_PUBLIC_VAPID_PUBLIC_KEY}
RUN pnpm exec turbo run build --filter=@labpass/mobile

FROM caddy:2-alpine AS runtime
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/mobile/dist /srv/app
RUN mkdir -p /srv/downloads

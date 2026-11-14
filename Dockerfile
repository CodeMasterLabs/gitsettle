# syntax=docker/dockerfile:1
# Node 22.23.0 is above near-api-js 7.5.3's 22.22.2 minimum.
# The multi-platform digest was verified against the official Node image.
FROM node:22.23.0-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
# SQLite is a native addon. Compile it reproducibly instead of relying on a
# platform-specific prebuilt binary being available for this Node release.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Copy manifests separately so ordinary source edits reuse the locked install.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/community/package.json ./packages/community/package.json
COPY packages/triage/package.json ./packages/triage/package.json
COPY services/verifier/package.json ./services/verifier/package.json
RUN npm ci

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Public settings are read at runtime; neither keys nor .env enter this image.
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM base AS runtime
LABEL org.opencontainers.image.source="https://github.com/CodeMasterLabs/gitsettle" \
      org.opencontainers.image.title="GitSettle" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NPM_CONFIG_CACHE=/tmp/npm-cache \
    DATABASE_PATH=/data/gitsettle.sqlite
# Keep workspace TypeScript sources: the verifier and shared package run with tsx.
COPY --from=builder --chown=node:node /app /app
RUN mkdir -p /data /app/apps/web/.next/cache \
    && chown -R node:node /data /app/apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["npm", "start"]

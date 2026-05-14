# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config/package.json ./packages/config/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter api...

# ── build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm --filter api build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN addgroup -S sher && adduser -S sher -G sher
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=sher:sher /app/apps/api/dist ./dist
COPY --from=builder --chown=sher:sher /app/apps/api/package.json ./package.json
COPY --from=builder --chown=sher:sher /app/node_modules ./node_modules
USER sher
EXPOSE 3000
CMD ["node", "dist/main"]

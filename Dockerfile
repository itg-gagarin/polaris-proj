# Furniture BOM Studio — web app (editor + API + in-process job worker) in one container.
# Storage: with DATABASE_URL (free Neon / Supabase Postgres) data lives in the database and the schema is
# migrated on first start; without it, data is a JSON file in /data (mount a volume, or it resets).
# See docs/deploy.md.
ARG BASE_IMAGE=node:22-slim
FROM ${BASE_IMAGE}

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN corepack enable
WORKDIR /app

# Install with the lockfile first so dependency layers cache between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages ./packages
COPY services ./services
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && rm -rf apps/web/.next/cache && chmod -R a+rX /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_BACKEND=auto \
    DATA_FILE=/data/db.json \
    AUTH_PROVIDER=dev \
    AI_PROVIDER=mock
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm", "--filter", "@bom/web", "start"]

# Furniture BOM Studio — web app (editor + API + in-process job worker) in one container.
# Data lives in a JSON file on a mounted volume (/data). For multi-instance or production use,
# switch to PostgreSQL (DATA_BACKEND=supabase) — see docs/deploy.md.
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
    DATA_BACKEND=file \
    DATA_FILE=/data/db.json \
    AUTH_PROVIDER=dev \
    AI_PROVIDER=mock
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["pnpm", "--filter", "@bom/web", "start"]

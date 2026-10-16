# @bom/worker as a container service (vercel.json: root ".", entrypoint "services/worker/Dockerfile";
# the build context is the repository root so workspace packages resolve).
ARG BASE_IMAGE=node:22-slim
FROM ${BASE_IMAGE}

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY scripts/package.json scripts/
COPY packages ./packages
COPY services ./services
# Schema migrations, and the demo seed for standalone runs (never fixtures/private, see .dockerignore).
COPY supabase ./supabase
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile --filter @bom/worker... && chmod -R a+rX /app

ENV NODE_ENV=production PORT=8787
USER node
EXPOSE 8787
CMD ["pnpm", "--filter", "@bom/worker", "start"]

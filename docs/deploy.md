# Deploying a hosted preview

## Vercel with services (web + sync + worker) — `vercel.json`

One Vercel project, one domain, three services:

| Service | What | Public? | Talks to |
|---|---|---|---|
| `web` | Next.js editor + API routes (`apps/web`) | yes, `/` (catch-all) | `sync` via binding `SYNC_URL` (internal patch endpoint); Postgres |
| `sync` | Hocuspocus WebSocket server (`services/sync`, container) | yes, `/sync/*` — browsers open `wss://<domain>/sync/ws` | Postgres |
| `worker` | job queue worker (`services/worker`, container) | no (internal) | Postgres only (jobs table) |

How they connect:
- **Browser → sync**: WebSocket on the same domain (`/sync/ws`). The web app derives this URL itself when
  the `SYNC_URL` binding is present, and hands each signed-in browser a 10-minute token
  (`/api/sync-token`, behind the site password) signed with `SYNC_TOKEN_SECRET`; the sync service refuses
  anything else. Override with `SYNC_PUBLIC_URL` if the path changes.
- **web → sync (binding `SYNC_URL`)**: when the API saves a change (AI accept, suggestion, waiver), it
  posts the patch to `<SYNC_URL>/internal/revisions/:id/patch` (signed with `SYNC_TOKEN_SECRET`), and the
  sync service applies it on top of the live document so unsaved live edits survive.
- **web ↔ worker**: no HTTP; jobs go through `app.jobs` in Postgres (`QUEUE_BACKEND=postgres` is the
  default whenever a database URL is set in the worker; set it on `web` too).

Project environment variables (shared by all services): `DATABASE_URL` (or `POSTGRES_URL` from the
Neon/Supabase integration), `SITE_PASSWORD`, `SYNC_TOKEN_SECRET` (a long random string),
`QUEUE_BACKEND=postgres`. Do **not** set `SYNC_URL` — Vercel injects it into `web` from the binding.

Verified in the build sandbox with the same images and wiring (Postgres 16, web + sync + worker started
together): migrations applied once under a lock, two separate browsers co-edited live through `sync`,
an AI accept in one browser reached the other through the binding call, the 30 s snapshot saved both
the live edit and the AI change with the right author, and the worker ran a queued export.
`vercel.json` passes the Vercel CLI's schema validator (v64.3.1). Not verified: an actual Vercel deploy
(Vercel was unreachable from the sandbox) — in particular WebSocket support and `$PORT` for container
services, and that the `/sync/(.*)` rewrite forwards WebSocket upgrades in production as `vercel dev` does.

## Free: Vercel (Hobby) + a free Postgres (Neon or Supabase)

Vercel runs the app as serverless functions: no disk, nothing kept between requests. So the data must
live in Postgres. The app finds the database URL (`DATABASE_URL` or `POSTGRES_URL`), creates its tables on
first start (`supabase/migrations`, applied once) and seeds the Hollan House demo.

1. **Import** — vercel.com → *Add New → Project* → import this GitHub repository.
   - *Root Directory*: `apps/web` (Framework preset: Next.js; keep the default install/build commands —
     pnpm is detected from the lockfile at the repo root).
   - Branch: Vercel deploys the default branch to production and every other branch as a *preview*
     URL; merge `claude/cool-feynman-nbcwvy` or use its preview deployment.
2. **Database** — in the project, *Storage → Create Database → Neon* (free tier) and connect it to the
   project. That injects the connection string as an environment variable. Supabase works too: copy its
   connection string into `DATABASE_URL` (if TLS fails with a certificate error, add `DATABASE_SSL=no-verify`).
3. **Password** — *Settings → Environment Variables*: `SITE_PASSWORD` = a long shared password.
4. **Redeploy**, open the URL, enter the password, pick a demo user. The very first request takes
   longer (migrations + seed).

What changes on Vercel (all handled in code, verified in a simulated run — `VERCEL=1`, `POSTGRES_URL`,
empty database: migrations, seed, sign-in, editor, PDF/XLSX/STEP export and AI optimize all worked):
- No in-process background worker (serverless); everything the UI needs runs inside requests.
- Without a database the app still starts but keeps data in `/tmp`, which resets often — add the database.
- Live collaboration works between tabs of one browser only (no websocket sync server on Vercel).

**Check before relying on it** (could not be verified from the build environment — vercel.com and
render.com were not reachable):
- Vercel's Hobby plan terms restrict it to personal, non-commercial use as far as I know; a company tool
  may need the Pro plan. Read the current terms.
- The exact environment variable name the Neon/Supabase integration injects (the app accepts
  `DATABASE_URL` and `POSTGRES_URL`) and the free-tier limits (storage, compute hours, idle pausing).
- The function duration limit on Hobby; the entry routes ask for 60 s for the cold-start seed.

## Paid: a Docker host with a disk

Alternatively, the repo ships a `Dockerfile` that runs the whole web app (editor, API routes, in-process job worker)
in one container. Data is a JSON file on a mounted volume, so the host **must** provide a persistent
disk/volume at `/data`, otherwise every redeploy starts from the demo seed again.

Verified in the build sandbox: the image builds, `/api/health` answers, the password gate blocks pages
(redirect) and APIs (401), the editor loads after sign-in, and an edit survives a container restart.

## Required settings

| Variable | Value | Why |
|---|---|---|
| `SITE_PASSWORD` | a long shared password | Gates the whole site. Without it, the dev user picker lets anyone act as any user, including admin |
| `DATA_FILE` | `/data/db.json` | On the persistent volume |
| `PORT` | set by most hosts | The container listens on `$PORT` (default 3000) |

Optional: `AI_PROVIDER=claude` + `ANTHROPIC_API_KEY` for the real model (otherwise the deterministic mock).

**Security:** the shared password is a gate for an internal pilot, not user accounts. Everyone who has it
can sign in as any demo user. Do not share it with external buyers. For real accounts, set up Supabase
(`AUTH_PROVIDER=supabase`, `DATA_BACKEND=supabase`, see `README.md`).

## Render (Blueprint)

1. Render dashboard → **New → Blueprint** → pick this GitHub repository and the branch to deploy.
2. Render reads `render.yaml`: one Docker web service (`starter` plan, needed for the disk) with a 1 GB
   disk at `/data`. Check the preview — the field names were written without access to Render's docs.
3. Enter `SITE_PASSWORD` when asked. Deploy. The first start seeds the Hollan House demo (a few seconds).

## Railway / Fly.io / any Docker host

- Deploy from the repository's `Dockerfile`.
- Attach a volume at `/data`.
- Set `SITE_PASSWORD` (and `DATA_FILE=/data/db.json`, already the image default).
- Health check path: `/api/health`.
- Run **one** instance: the file repository is single-process.

## Building the image yourself

```bash
docker build -t bom-studio .
docker run -p 3000:3000 -e SITE_PASSWORD=change-me -v bom-data:/data bom-studio
```

If Docker Hub rate-limits you, pass a mirror: `--build-arg BASE_IMAGE=mirror.gcr.io/library/node:22-slim`.

## Limits of this setup

- Single instance; live collaboration works between tabs of one browser only (no sync server).
  Multi-device live editing needs `services/sync` plus PostgreSQL.
- The original customer workbook is never in the image (`.dockerignore` excludes `fixtures/private`).

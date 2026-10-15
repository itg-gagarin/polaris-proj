# Deploying a hosted preview

The repo ships a `Dockerfile` that runs the whole web app (editor, API routes, in-process job worker)
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

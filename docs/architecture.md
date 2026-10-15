# Architecture

Furniture BOM Studio is a TypeScript monorepo. One set of shared packages (domain, engine, workflow)
runs in the browser for instant feedback, in the API routes to validate saves, in the sync server to
re-check snapshots, and in the AI pipeline to validate model output. A check that passes in the browser
passes on the server because it is the same code (PRD §11).

```
                ┌──────────────────────── browser (apps/web) ─────────────────────────┐
                │ Board (frames + markup) · 3D (R3F, instanced) · Sheet (SVG) · BOM   │
                │ Docks · command line · palette · meeting mode · AI panel            │
                │ LiveWorkspace: Yjs docs (board + one per revision), per-user undo,  │
                │ IndexedDB offline copy, pending-patch queue, engine.analyze()       │
                └───────┬──────────────────────────────┬──────────────────────────────┘
       REST (patches,   │                              │ Yjs updates + awareness
       workflow, AI,    │                              │ (local: BroadcastChannel,
       import, export)  │                              │  server: Hocuspocus)
                ┌───────▼────────────┐        ┌────────▼───────────┐       ┌──────────────────┐
                │ Next.js API routes │        │ services/sync      │       │ services/worker  │
                │ (apps/web/src/app/ │        │ Hocuspocus: auth,  │       │ job queue:        │
                │  api, server/)     │        │ persistence, 30 s  │       │ import, exports,  │
                │ permissions per op │        │ snapshot + server  │       │ AI runs, digest,  │
                │ audit, lanes, AI   │        │ check run          │       │ ERP, webhooks     │
                └───────┬────────────┘        └────────┬───────────┘       └────────┬─────────┘
                        └──────────────┬───────────────┴────────────────────────────┘
                                ┌──────▼───────────────────────────────────┐
                                │ @bom/db Repository                        │
                                │ memory · file (.data/db.json) · SQL       │
                                │ (PostgreSQL / Supabase, RLS per request)  │
                                └───────────────────────────────────────────┘
```

## Packages

| Package | Role | Runs in |
|---|---|---|
| `@bom/domain` | Entities, `Patch` + inverse, permissions (`can`, `classifyPatch`), settings, hashing | everywhere |
| `@bom/sheets` | xlsx/csv read/write, password-protected OOXML decryption | Node |
| `@bom/dictionary` | Standard part-name dictionary import, quality report, matcher, role rules, overlay | everywhere |
| `@bom/bom-io` | Product BOM import (standard + legacy breakdown form), exports (BOM, cut list, JSON) | Node (exceljs) |
| `@bom/engine` | Expressions, inference, layout templates, clash (BVH + SAT), checks, fixes, optimize, diff, sets | everywhere, no DOM |
| `@bom/workflow` | Revisions, lanes, comments, tasks, notifications, meetings, audit | everywhere |
| `@bom/collab` | Yjs schema, `syncDocTo`, locks, per-user undo, presence, channel provider, meeting summon/ink | browser + Node |
| `@bom/ai` | Provider port, Claude adapter, deterministic mock, optimize pipeline, helpers | server |
| `@bom/db` | Repository port + memory/file/SQL adapters, demo seed | server |
| `@bom/exporters` | PDF sheet, personal sheet with QR, GLB, DXF, STEP AP214; projection + colours for the browser | both |
| `@bom/integrations` | Signed webhooks, Slack/Teams/WhatsApp, ERP payload + connectors | server |
| `@bom/fixtures` | Dictionary, Hollan House products and bed sets for tests and the demo seed | Node |

## Data flow for an edit (PRD §11)

1. A user changes a size (BOM cell, Properties, gizmo, `SET W 567`). The client builds a `Patch`.
2. `classifyPatch` (same code as the server) splits it per op: **direct**, **suggestion** (outside the
   user's team scope, sent to the owning team as a change-request thread) or **denied** (role, locked,
   released). Part locks held by someone else also refuse the op.
3. Direct ops are written to the revision's Yjs document with the user's origin (so `Ctrl+Z` only undoes
   their own steps). `analyze()` re-runs within a frame (1–17 ms for the Hollan products).
4. Persistence depends on the sync mode:
   - **local** (default, no sync server): the history step is turned into a patch (`diffToPatch`) and
     posted to `/api/revisions/:id/patch`. The API re-classifies it, applies it, resets lanes whose scope
     changed, writes the audit event and stores a server check result. Patches wait in a per-revision
     `localStorage` queue until acknowledged, so edits made offline are re-sent on reconnect.
   - **server** (`NEXT_PUBLIC_SYNC_URL`): Hocuspocus persists the document and every 30 s writes a
     snapshot to the draft revision, resets lanes, audits the editors and re-runs the checks.
5. Submitting freezes a content hash; lane approvals attach to it; any later edit in a team's scope resets
   that lane with the reason.

## Shared documents

- `board:<id>`: frames and markup (`items` map), meeting summon and shared ink. Every member writes.
- `revision:<id>`: one `Y.Map` per part (field-level last-write-wins), assemblies, joints, parameters,
  assumptions, waivers, meta. Read-only on the socket for viewers, reviewers, external users and released
  revisions (ADR 0006).
- When the revision row changed while nobody had the document open (REST edit, AI accept, restore),
  `syncDocTo` reconciles field by field so offline replicas still merge cleanly.

## Security model

- Roles and team scopes are enforced three times: in the browser (UX), in the API (`classifyPatch`,
  workflow functions) and in PostgreSQL row-level security (`supabase/migrations/…_rls.sql`):
  workspace membership, external buyers see only shared products, reviewers approve only their lane,
  private meeting notes are visible to their author only, released revisions and the audit log are
  immutable by trigger.
- The sync server enforces document-level read-only connections; field-level team scope on the socket is
  not enforced (Yjs has no per-key write hook) — see ADR 0006 for the trade-off.
- Dev auth (`AUTH_PROVIDER=dev`) trusts a cookie / `dev:<userId>` token and must never be deployed.
  Production uses Supabase access tokens (HS256) with an `app_user_id` claim.

## AI

`runOptimize` = deterministic rule fixes (up to 4 passes) → model pass (structured JSON only) → every
model patch re-validated by the engine; patches that add a failure are dropped as “Not applied, made
things worse”. Accepting lands as one patch “AI optimize, accepted by Name”. Every run is logged
(`ai_runs`). With no `ANTHROPIC_API_KEY` the deterministic mock provider is used.

## Jobs

`services/worker` claims jobs from `app.jobs` with `FOR UPDATE SKIP LOCKED` (ADR 0007). Uploaded
workbook bytes are scrubbed from the job when it finishes; passwords are never queued.

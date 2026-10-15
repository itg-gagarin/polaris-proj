# Furniture BOM Studio

A BOM-driven, multi-user 3D editor for furniture product development: an infinite board with live 3D,
drawing sheets and BOM tables, Excalidraw-style markup pinned to parts, team review lanes, product
meetings, and an AI optimize step whose every number is re-checked by the rule engine.
Spec: [`docs/prd/PRD.md`](docs/prd/PRD.md) · Architecture: [`docs/architecture.md`](docs/architecture.md) ·
Status per phase gate: [`docs/phase-status.md`](docs/phase-status.md) · Decisions: [`docs/adr`](docs/adr).

## Quick start (no database, no AI key)

```bash
pnpm install
pnpm build          # Next.js production build
pnpm --filter @bom/web start   # http://localhost:3000  (or `pnpm dev`)
```

Pick a demo user (dev sign-in). The first start imports the Hollan House Curated Craftsman fixtures
(11 products, two bed sets) into `.data/db.json`. Open a second tab to see live co-editing.

Useful keys: `V` select · `H` hand · `R D O A L P T N E` markup · `W` move · `S` resize · `M` measure ·
`X` section · `Shift+X` explode · `Shift+A` add part · `F` frame selection · `Alt+1/3/7/0` views ·
`Ctrl+K` palette · `Ctrl+Z` undo (your own changes). Command line: `SET W 567`, `SECTION X 300`, `HELP`.

## Tests

```bash
pnpm typecheck && pnpm test        # 150 unit/integration tests (engine goldens, RLS on PGlite, sync, worker…)
pnpm build && pnpm e2e             # Playwright editor smoke tests
pnpm loadtest                      # 25 Hocuspocus clients, propagation p50/p95
```

## Running with real services

| Concern | Dev default | Production |
|---|---|---|
| Data | `DATA_BACKEND=file` | `DATA_BACKEND=supabase`, `DATABASE_URL`, run `supabase/migrations` |
| Auth | `AUTH_PROVIDER=dev` (user picker — never deploy) | `AUTH_PROVIDER=supabase`, `SUPABASE_JWT_SECRET` |
| Live sync | tabs on one machine (BroadcastChannel) | `pnpm sync` + `NEXT_PUBLIC_SYNC_URL=ws://…` |
| Jobs | in-process memory queue | `QUEUE_BACKEND=postgres` + `pnpm worker` |
| AI | deterministic mock | `AI_PROVIDER=claude`, `ANTHROPIC_API_KEY` (server only) |
| ERP / chat | off | `ERP_PROVIDER`, `CHAT_PROVIDER` (open questions, PRD §14) |

See `.env.example`. The file repository is single-process: when the sync server runs, point both it and
the web app at PostgreSQL.

## Fixtures and private data

- `fixtures/dictionary/ref.xlsx` — the standard part-name dictionary (1,920 entries).
- `fixtures/products/hollan-house-curated-craftsman.xlsx` — sanitized standard-format export of the
  Hollan House workbook. Costing columns were never read.
- The original customer workbook is password-protected and **not committed** (`fixtures/private/`,
  git-ignored). Rebuild the fixture locally with `HOLLAN_PASSWORD=… pnpm fixtures:hollan`.
- New products follow the standard import format (PRD §4), one sheet per product revision; columns are
  matched by header name, so extra or reordered columns are fine.

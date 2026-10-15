# Furniture BOM Studio — rules for Claude Code

Read `docs/prd/PRD.md` (the product spec) and `docs/architecture.md` before changing behaviour.

## Non-negotiables
- Units are millimetres everywhere. Never round stored values (display rounds to 0.5 mm, input to 0.1 mm).
- `packages/engine` has no React, DOM or browser imports. It must run in Node for server validation and the AI service.
- Every check is a pure function `(context) → findings` in `packages/engine/src/checks`. Each check gets a test with numbers taken from a fixture.
- No geometry change bypasses the check run. Content changes only through `Patch` objects (`@bom/domain` `applyPatch`).
  The AI service may only return JSON patches, and the server validates them with the engine.
- Golden tests in `fixtures/expected` must pass before any merge. Update them only with a written reason:
  `pnpm golden:update "why"` (appends to `fixtures/expected/CHANGELOG.md`).
- Part names stay as written (Indonesian). UI strings go through the i18n layer (`apps/web/src/i18n`, en + id).
- Checks report severity, confidence (High = BOM arithmetic, Medium = depends on an assumption, Low = interpretation),
  the numbers, and the assumption keys they depend on. Thresholds come from workspace settings, not code.
- The carcass layout must never depend on the size of moving parts (drawers, doors): a wrong drawer shows as a clash.
- Costing data never enters the tool: importers must not read cost, price or margin columns.
- The original customer workbooks are never committed (`fixtures/private/` is git-ignored).

## Layout of the repo
- `packages/domain` entity types, patches, permissions, settings
- `packages/sheets` xlsx/csv read/write (incl. password-protected workbooks)
- `packages/dictionary` standard part-name dictionary: importer, quality report, re-import diff, name matcher, role rules
- `packages/bom-io` product BOM import (PRD §4 format + legacy "Material Breakdown Form"), exports
- `packages/engine` parameters, expressions, layout templates, clash, checks, fixes, optimize, diff
- `packages/workflow` revisions, review lanes, comments, tasks, meetings, notifications, audit
- `packages/collab` Yjs document schema, presence, locks, per-user undo, offline queue
- `packages/ai` AI provider interface, Claude adapter, mock provider, patch validation pipeline
- `packages/db` repository interface + in-memory/file store + Supabase adapter; SQL in `supabase/migrations`
- `packages/exporters` PDF sheets, spec sheets with QR, GLB, DXF, STEP
- `packages/integrations` ERP push, chat notifications, webhooks
- `packages/fixtures` loads the dictionary, Hollan House products and bed sets for tests and seeds
- `apps/web` Next.js editor + API routes; `services/sync` Hocuspocus; `services/worker` jobs

## Commands
- `pnpm test` all tests · `pnpm typecheck` · `pnpm dev` web editor · `pnpm golden:update "reason"`
- `HOLLAN_PASSWORD=… pnpm fixtures:hollan` rebuild the Hollan fixture from `fixtures/private/`

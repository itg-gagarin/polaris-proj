# Phase status against the PRD §13 gate criteria

Legend: **Done** = built and covered by an automated test (named) · **Partial** = built, with a stated gap ·
**Not done** · **Needs real-world validation** = cannot be proven in code (people, hardware, vendors).

All numbers below were measured on the committed fixtures (`fixtures/`), 15 Oct 2026. The only real
product data available was the Hollan House Curated Craftsman bedroom workbook (11 products, Rev 5);
the PRD's "4 validation products and Dresser 1727" were not provided.

## Phase 0 — Foundations

| Gate | Status | Evidence |
|---|---|---|
| Monorepo, CI | Done | pnpm workspaces; `.github/workflows/ci.yml` (typecheck, unit, build, e2e) |
| Auth, workspace and team model, roles | Partial | Role matrix + team scopes (`domain` permissions tests); dev user picker; Supabase JWT verification in `services/sync/src/auth.ts` and `apps/web/src/server/auth.ts`. **Gap:** no Supabase login UI (email/SSO) — needs a Supabase project. |
| Dictionary imported; 1,920 entries searchable | Done | `dictionary` tests: 1,920 entries (423 L1, 1,497 L2), 8 categories, 41 sub-categories (PRD table says 42 — the workbook has 41) |
| Data problems listed | Done | 106 "Please specify"; misspellings "Extention" (9 rows) and "Entertaiment" (78 rows) |
| Axis Map + Default Role for the top 50 | Done | Default Role 50/50; Axis Map 36/50 — the other 14 are L1 assembly heads (Body, Hardware Bungkus, Pallet Skid, Kaki…) where an axis map does not apply. Proposed by rules, **needs review by Engineering** (`fixtures/dictionary/axis-role-overlay.json`) |

## Phase 1 — Single-user editor

| Gate | Status | Evidence |
|---|---|---|
| Import with match preview; zero unplaced after confirmation | Done for Hollan | Standard + legacy importers; preview UI with candidates, "confirm all good", AI suggestions; e2e "import a workbook…" and the encrypted original via password. All 11 products: 0 unplaced. Each product keeps 6–8 `unmatched` lines (no dictionary entry: veneer, misc hardware) — they are non-geometric or tray items, listed, never dropped |
| 4 validation products + Dresser 1727 | Not done | Not provided. Run them through the importer and the golden tests as soon as they are available |
| 3D frame, Outliner, Properties, resize handles, typed sizes, expressions, undo/redo | Done | e2e "select a BOM row, edit a size…, undo it"; resize gizmo maps scale to T/W/L via the axis map |
| Check library v1; seeded issues flagged (Dresser fronts 590, Queen slats 1550) | Done | engine "seeded issues" tests; golden files in `fixtures/expected` |
| BOM and cut-list export | Done | `bom-io` round-trip + take-off tests; xlsx export in the UI |
| Checks < 200 ms for 300 parts | Done | 1–9 ms per Hollan product in Node; perf test on a ~340-instance dresser |

## Phase 2 — Canvas and markup

| Gate | Status | Evidence |
|---|---|---|
| Infinite board with 3D, sheet, BOM, Compare frames; minimap; docking panels | Done | e2e "editor loads the Hollan board" (screenshots in the session); docks collapse to icons. Docks are fixed left/right (no drag-to-rearrange, dockview not used) |
| Excalidraw tools with reference keys; markup pinned to parts | Done | Custom layer (ADR 0001); e2e creates a sticky note; pins follow parts in 3D and sheets |
| Measure, dimension, section, explode, lenses; PDF sheet + GLB | Done | Measure (point + clear gap), persistent dimensions on 3D frames, section plane + cap, explode slider, 4 lenses; exporter tests |
| 60 fps orbit with 1,000 parts on a mid-range laptop | Needs real-world validation | Parts are instanced by colour (few draw calls) and the canvas renders on demand; not measured on target hardware |

## Phase 3 — Revisions and review

| Gate | Status | Evidence |
|---|---|---|
| States, immutable releases, diff table, Compare frame | Done | workflow tests; DB triggers (PGlite test); Compare frame with slider, ghost and diff list |
| Comments, sticky notes, tasks, notifications | Done | workflow tests; comments panel; daily digest job |
| Lanes with checklists; release blocked until required lanes approve; resets on scope edits | Done | workflow + sync snapshot tests; Review panel |
| Meeting mode v1 (personal sheets PDF+QR, pen/typed notes pinned, private/shared, decisions, record) | Partial | All built (meeting tests, record page, QR part page). **Gap:** uploading a photo of a marked paper sheet and attaching its notes via the QR codes is not built (needs image + QR decoding) |
| Pilot with Team Pak Margono; baselines measured | Needs real-world validation | |

## Phase 4 — Multiplayer

| Gate | Status | Evidence |
|---|---|---|
| Presence, follow mode, live co-editing of model, BOM and markup | Done | collab tests; sync tests; e2e "two tabs co-edit live" |
| Presenter view, "Bring everyone here", live ink | Done | Presenter flag, summon, shared ink in the board document when presenting |
| Part locks, per-user undo, offline queue | Done | collab tests (locks, undo); IndexedDB copy + pending-patch queue (local mode); Hocuspocus merge (server mode) |
| 25-person load test on tablets < 500 ms | Partial | 25 real Hocuspocus clients: p95 ≈ 7 ms **on loopback** (sync test + `pnpm loadtest`). Office Wi-Fi and tablets **need real-world validation** |

## Phase 5 — AI optimize

| Gate | Status | Evidence |
|---|---|---|
| Deterministic passes, model pass with structured output, validation of every patch | Done (mock) | ai tests; Claude adapter request shape tested without network. **Needs verification against the live API with a key** (not configured, by request) |
| Suggested revision, accept/reject per change, low confidence unticked | Done | e2e "AI optimize…": Night Stand 2 → 0 failing checks after accept |
| Recording with consent, transcript linked to parts, AI decision cards | Partial | Consent, start/stop, bookmarks, transcript segments tagged with the presenter's parts, AI proposals confirmed by a person. **Gap:** no audio capture or speech-to-text provider; segments are entered as text. Bahasa transcription trial **needs real-world validation** |
| Import mapping and revision-note helpers | Done (mock) | Import dialog "Suggest with AI"; Review "Draft with AI" |

## Phase 6 — Export and integrations

| Gate | Status | Evidence |
|---|---|---|
| DXF sheets | Done | exporter test (three view layers, mm) |
| STEP after a feasibility spike | Done (boxes) | ADR 0004; OCCT reads every solid. Import into the factory's CAD tool **needs verification** |
| ERP push and chat notifications once the open questions are answered | Partial by design | Neutral ERP payload (released only), REST + file connectors, signed webhooks, Slack/Teams/WhatsApp adapters — all off by default. Which ERP and which chat app are open questions (PRD §14) |

## Known limitations worth fixing next

1. Server sync mode enforces read-only per document, not per team scope (ADR 0006).
2. Review assistant compares with the parent revision, not with the exact approved snapshot (only the
   approval hash is stored). Store approved content per lane to make it exact.
3. File bytes are stored inline in the dev repository; the SQL adapter stores only the index row —
   wire Supabase Storage before production uploads.
4. External buyers can view and comment; "approve sample" has a permission but no UI or API yet.
5. Keyboard: the PRD keymap preferences (AutoCAD / Blender styles) are not built; dynamic input while
   dragging a gizmo is replaced by typed commands (`MOVE -120`).

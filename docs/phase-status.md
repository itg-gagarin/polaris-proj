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

## UI v2 — simple studio (after user testing, 2026-10-16)

Feedback from the first hosted preview: too complex for the people who will use it (many are older),
no settings, laggy, zoom unclear, hard to know where to start, gaps in the 3D, no screws or bolts,
unclear how to add hardware. What changed (the PRD's power features stay under Settings → Advanced):

| Area | Change | Evidence |
|---|---|---|
| Layout | Figma-style light canvas with floating cards: title + version (top left), view switch (3D model / Drawing / Parts list / Checks; Board in Advanced), actions (top right), parts list (left), inspector (right), big labelled tools (bottom) | e2e `simple.spec.ts` |
| Start | Home page after sign-in: open a product, bring one in from Excel, open the board; "How it works" | e2e |
| Guidance | 4-step getting-started card that ticks itself off; "Show me" highlights the target; Help with plain Q&A and shortcuts | e2e (`guide-edit`, `guide-checks`) |
| Inspector | Plain Length / Width / Thickness boxes, how many, material, finish, problems; codes, team, joints under "More details"; product summary when nothing is selected | e2e |
| Settings | Language, text size (normal / large / extra large scales the whole interface), simple / advanced, light / dark / system, 3D quality (detailed / fast), hints, guide; workspace check limits for leads and admins (`PATCH /api/workspace/settings`, audited) | domain tests, e2e |
| Zoom | One zoom for every view: − % + and fit at the bottom, Ctrl + / Ctrl − / Ctrl 0 (instead of the browser's page zoom), Shift+1 fit, Ctrl+wheel | e2e "zoom" |
| Lag | Components subscribe to the store fields they draw; presence (cursors) on its own channel; frames memoised; hover tooltip is DOM (no 3D redraw); lower resolution while turning | Headless Chrome (software GL): mouse move over the model 6.6 s of long tasks → 0; board pan over empty space 0 long tasks. **Real-GPU timing needs verification on the factory's PCs** |
| 3D | Flush faces no longer flicker (near plane + size-dependent inset); outlines and ground shadow in detailed quality; knobs go to the narrowest drawers and pulls to the widest (they used to stack on the first drawers) | golden update with reason |
| Screws & bolts | `planFasteners`: positions suggested from the template (insert nuts on glides, hanger bolts on leg tops, connector bolts at posts / rail ends, screws at blocks, runners, slides, drawer fronts), quantities from the BOM, counted when there are more than places, Allen keys "in the bag". Shown with see-through wood and a legend | engine tests (Night Stand: 4 mur nanas on the 4 glides, 60/60 screws) |
| Hardware | "Add hardware" dialog: pull handle, knob, glide, drawer slide, screws; quantity from drawers / legs; inspector switches pull ↔ knob and 1 / 2 per drawer | e2e "add hardware" |
| New checks | `face-frame-gap` (a 489 mm profile in a 571 mm leg gap leaves 41 mm at each end — same on all three case goods, so the template's joint guess or the BOM needs an engineer's call) and `drawer-pull` (Dresser: 6 knobs/pulls for 8 drawers) | engine tests with fixture numbers |

Open: fastener positions are suggestions (Low confidence) until joints carry fastener counts; the
corner gaps above need the factory's answer on how the face frame is joined.

### Follow-up: seamless finished look (2026-10-16)

- Front frame corners: inferred assumption `faceFrameCorners = butt-to-legs` draws the horizontal face
  profiles and rails leg to leg (no 41 mm holes); `face-frame-gap` reports the BOM length against the
  drawn length. Set the assumption to `as-bom` to see the BOM geometry exactly.
- 3D "Finished look" (default in the simple layout): one honey-teak finish with procedural wood grain
  along each part's length, eased (light) edges, studio reflections, no outlines. Touching parts no
  longer get the size inset (it showed as hairline seams); a ≤ 0.4 mm per-part depth tie-break stops
  flush faces flickering instead.
- Not from the BOM, so not drawn: tapered legs, profiles' moulded shapes, woven seats. Seating has no
  layout template yet.

### Follow-up: search, follow, notes, detail drawings (2026-10-16)

| Area | Change | Evidence |
|---|---|---|
| Parts search | Free-text search in the parts panel (name, original name, Std Code, position, material, finish, SKU, assembly); matches highlighted, Enter selects the first | e2e |
| Follow mode | Presence carries the person's view, product, take-apart, colours and selection; followers mirror them (camera too) with a "You are following …" banner and Stop; everyone sees others' selections outlined in their colour (3D and parts list) | e2e (two tabs) |
| Notes | "Notes" tab in the simple layout; "Notes on this part" in the inspector (kind, @mentions); 💬 pins on parts in 3D; counts in the parts list | e2e |
| Detail view | Part sheet: title block, three views with sizes (cut size from the BOM), corner details A–D with the parts each corner meets, joints table; knob / pull drawn from BOM sizes. Assembly sheets: one assembly at a time (one copy), balloons in a row with leaders, parts table, Previous / Next for meetings; Print | exporters tests (Night Stand profile 489 × 55, corners meet the front legs; Chest 794 cut vs 876 drawn), e2e |
| AutoCAD | Attach a .dxf (or a picture) to a part (versioned field `drawing`), optionally to every part with the same code; DXF reader handles lines, polylines with bulges, circles, arcs, ellipses, splines, text and blocks, in mm from $INSUNITS. DWG must be saved as DXF first | bom-io DXF tests; agrees with `dxf-parser` on our own exported DXF |

Not done: importing a whole product's geometry from AutoCAD (only per-part drawings); the Behance
reference could not be opened from the build environment.

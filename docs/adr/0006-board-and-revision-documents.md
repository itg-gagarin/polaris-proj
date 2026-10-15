# ADR 0006 — Separate Yjs documents for the board and for each revision

Status: accepted (phase 4)

## Context
PRD §11 says "a CRDT document per board". Viewers and reviewers must be able to draw markup and notes
on the board but not change product data. Yjs has no per-key write authorization: a client that can
write to a document can write any key in it.

## Decision
`board:<id>` holds frames and markup (all members write). `revision:<id>` holds draft content and is
**read-only on the socket** unless the user's role can edit and the revision is not released. Both use the
same `@bom/collab` functions.

## Consequences
- + Product data is protected at the transport, not only in the UI.
- − Team scope (e.g. an engineer editing a hardware SKU) is not enforced on the socket in server mode;
  it is enforced in the client and by the server-side snapshot audit. If that is not acceptable, route
  out-of-scope edits through the API only (suggestions already are) or add an update-inspection hook.
- A board with N open products syncs N+1 documents.

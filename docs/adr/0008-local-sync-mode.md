# ADR 0008 — "Local" sync mode: BroadcastChannel + API patches

Status: accepted (phase 4)

## Context
Development and single-machine demos should not need the sync server or PostgreSQL.

## Decision
Without `NEXT_PUBLIC_SYNC_URL`, tabs on one machine share documents over BroadcastChannel and each tab
posts its own history steps to the API as patches (with an offline queue). The file repository is
single-process, so the sync server must not run against the same `.data/db.json`; use PostgreSQL for
both when running the sync server.

## Consequences
Two tabs editing the same field resolve last-write-wins in the CRDT while the API applies patches in
arrival order; the next load reconciles from the row (`syncDocTo`). Multi-machine collaboration requires
the server mode.

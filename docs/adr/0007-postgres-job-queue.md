# ADR 0007 — Job queue on PostgreSQL (SKIP LOCKED) instead of pg-boss

Status: accepted (phase 3)

## Decision
`app.jobs` with `FOR UPDATE SKIP LOCKED` claims, exponential backoff, dedupe keys and stale-lock recovery,
behind a `JobQueue` port with an in-memory implementation for development.

## Why
Same database, same migrations, testable on PGlite; pg-boss would add its own schema management.

## Consequences
Fine for the expected volume (imports, exports, AI runs, a daily digest). Revisit (pg-boss/BullMQ) if
jobs exceed a few per second.

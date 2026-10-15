# ADR 0003 — SQL repository over node-postgres instead of supabase-js

Status: accepted (phase 3)

## Decision
`@bom/db` talks SQL through a tiny `SqlExecutor` (node-postgres in production, PGlite in tests). Row-level
security is applied per request with `SET LOCAL ROLE authenticated` and the JWT `sub` claim, exactly as
Supabase's PostgREST does. Storage of file bytes belongs in Supabase Storage (only the index row is in
`app.files` today).

## Why
- The same migrations and RLS policies are tested in CI on PGlite (no Docker, no network).
- No dependency on the hosted API surface; any PostgreSQL works.

## Consequences
- A connection pooler is needed in production; transactions are short.
- Supabase Realtime is not used (Hocuspocus does real-time).

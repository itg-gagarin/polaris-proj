-- Background jobs (services/worker). Claimed with FOR UPDATE SKIP LOCKED so several workers can run.
-- Only the service role touches this table: RLS is on with no policies for `authenticated`.
create table app.jobs (
  id text primary key,
  kind text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_at timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  result jsonb,
  error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claim on app.jobs (status, run_at);
create unique index jobs_dedupe on app.jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'running');
alter table app.jobs enable row level security;

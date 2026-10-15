-- Furniture BOM Studio — core schema (PRD §4 entities, §11 storage).
-- Nested, versioned structures (revision content, anchors, checklists) are jsonb; anything that
-- is filtered, joined or secured is a column.

create schema if not exists app;

create table app.workspaces (
  id text primary key,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- People in a workspace. auth_user_id links to Supabase Auth (auth.users.id).
create table app.members (
  id text primary key,
  workspace_id text not null references app.workspaces(id) on delete cascade,
  auth_user_id uuid unique,
  name text not null,
  email text not null,
  teams text[] not null default '{}',
  role text not null check (role in ('viewer', 'reviewer', 'editor', 'lead', 'admin')),
  color text not null default '#64748b',
  locale text not null default 'id' check (locale in ('en', 'id')),
  external boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

-- Standard part-name dictionary (one per installation; owner is an open question, PRD §14).
create table app.std_parts (
  std_code text primary key,
  level smallint not null check (level in (1, 2)),
  l1 text not null,
  l2 text,
  name text not null,
  name_en text,
  category text not null,
  sub_category text not null,
  positions text[] not null default '{}',
  variants text[] not null default '{}',
  merged_names text[] not null default '{}',
  fgs_using int not null default 0,
  sg_lines int not null default 0,
  source text,
  axis_map jsonb,
  default_role text,
  owner_team text,
  parent_code text references app.std_parts(std_code) deferrable initially deferred,
  updated_at timestamptz not null default now()
);
create index std_parts_category on app.std_parts (category, sub_category);

create table app.products (
  id text primary key,
  workspace_id text not null references app.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  category text not null,
  sub_category text not null,
  current_revision_id text,
  shared_with_buyer boolean not null default false,
  component_product_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table app.revisions (
  id text primary key,
  product_id text not null references app.products(id) on delete cascade,
  label text not null,
  state text not null check (state in ('draft', 'in_review', 'changes_requested', 'approved', 'released')),
  notes text not null default '',
  author_id text not null references app.members(id),
  parent_revision_id text references app.revisions(id),
  branch jsonb,
  content jsonb not null,
  content_hash text,
  submitted_hash text,
  released_at timestamptz,
  meeting_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, label)
);
create index revisions_product on app.revisions (product_id);

alter table app.products
  add constraint products_current_revision_fk foreign key (current_revision_id) references app.revisions(id) deferrable initially deferred;

-- A released revision never changes; editing it starts the next revision (PRD §9).
create function app.guard_released_revision() returns trigger language plpgsql as $$
begin
  if old.state = 'released' and (new.content is distinct from old.content or new.state <> 'released') then
    raise exception 'Released revisions are read-only (revision %)', old.id using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger revisions_guard before update on app.revisions for each row execute function app.guard_released_revision();
create function app.guard_released_delete() returns trigger language plpgsql as $$
begin
  if old.state = 'released' then raise exception 'Released revisions cannot be deleted' using errcode = 'P0001'; end if;
  return old;
end $$;
create trigger revisions_guard_delete before delete on app.revisions for each row execute function app.guard_released_delete();

-- Server-side check results (the sync server re-runs the engine on every snapshot, PRD §11).
create table app.check_results (
  revision_id text not null references app.revisions(id) on delete cascade,
  content_hash text not null,
  findings jsonb not null,
  summary jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (revision_id, content_hash)
);

create table app.reviews (
  id text primary key,
  revision_id text not null references app.revisions(id) on delete cascade,
  team text not null,
  state text not null check (state in ('pending', 'approved', 'changes_requested')),
  reviewer_id text references app.members(id),
  hash text,
  checklist jsonb not null default '{}'::jsonb,
  comment text not null default '',
  at timestamptz,
  reset_reason text,
  unique (revision_id, team)
);

create table app.threads (
  id text primary key,
  product_id text not null references app.products(id) on delete cascade,
  revision_id text not null references app.revisions(id) on delete cascade,
  anchor jsonb not null,
  status text not null check (status in ('open', 'resolved')),
  kind text not null check (kind in ('comment', 'checkNote', 'revisionNote', 'changeRequest')),
  tag text,
  task jsonb,
  carried_from_thread_id text,
  meeting_id text,
  created_at timestamptz not null default now()
);
create index threads_revision on app.threads (revision_id);

create table app.comments (
  id text primary key,
  thread_id text not null references app.threads(id) on delete cascade,
  author_id text not null references app.members(id),
  body text not null,
  mentions text[] not null default '{}',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_thread on app.comments (thread_id);

create table app.notifications (
  id text primary key,
  user_id text not null references app.members(id) on delete cascade,
  kind text not null,
  text text not null,
  link text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_user on app.notifications (user_id, read);

-- Board snapshots (live state is a Yjs document; see board_docs).
create table app.boards (
  id text primary key,
  workspace_id text not null references app.workspaces(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Hocuspocus persistence: one Yjs document per board.
create table app.board_docs (
  name text primary key,
  workspace_id text not null references app.workspaces(id) on delete cascade,
  state bytea not null,
  updated_at timestamptz not null default now()
);

create table app.meetings (
  id text primary key,
  product_id text not null references app.products(id) on delete cascade,
  revision_id text not null references app.revisions(id),
  title text not null,
  lead_id text not null references app.members(id),
  note_taker_id text not null references app.members(id),
  agenda jsonb not null default '[]'::jsonb,
  state text not null check (state in ('planned', 'live', 'closed')),
  presenter jsonb,
  participants jsonb not null default '[]'::jsonb,
  record jsonb,
  started_at timestamptz,
  closed_at timestamptz
);

create table app.meeting_notes (
  id text primary key,
  meeting_id text not null references app.meetings(id) on delete cascade,
  author_id text not null references app.members(id),
  team text not null,
  visibility text not null check (visibility in ('private', 'shared')),
  anchor jsonb not null,
  kind text not null check (kind in ('ink', 'text', 'voice')),
  ink jsonb not null default '[]'::jsonb,
  text text not null default '',
  tag text,
  client_id text unique,
  at timestamptz not null default now()
);

create table app.decisions (
  id text primary key,
  meeting_id text not null references app.meetings(id) on delete cascade,
  text text not null,
  part_ids text[] not null default '{}',
  owner_team text not null,
  due date,
  status text not null check (status in ('proposed', 'confirmed', 'rejected', 'done')),
  linked_thread_id text references app.threads(id),
  transcript_ref jsonb,
  confirmed_by text references app.members(id),
  source text not null check (source in ('note-taker', 'ai')),
  confidence text
);

create table app.recordings (
  meeting_id text primary key references app.meetings(id) on delete cascade,
  audio_uri text,
  consent jsonb not null default '[]'::jsonb,
  segments jsonb not null default '[]'::jsonb,
  bookmarks jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  stopped_at timestamptz,
  retain_until date
);

-- Audit log: who, what, before, after, when, source (PRD §9). Append-only.
create table app.audit_events (
  id text primary key,
  workspace_id text not null references app.workspaces(id) on delete cascade,
  product_id text,
  revision_id text,
  who text not null,
  what text not null,
  before jsonb,
  after jsonb,
  source text not null check (source in ('user', 'ai', 'rule', 'import', 'meeting', 'system')),
  at timestamptz not null default now()
);
create index audit_scope on app.audit_events (workspace_id, product_id, revision_id, at desc);
create function app.audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'The audit log is append-only' using errcode = 'P0001';
end $$;
create trigger audit_no_update before update or delete on app.audit_events for each row execute function app.audit_append_only();

-- AI runs: prompts and responses logged per run (PRD §12).
create table app.ai_runs (
  id text primary key,
  workspace_id text not null references app.workspaces(id) on delete cascade,
  revision_id text not null,
  kind text not null,
  user_id text not null,
  model text,
  request jsonb,
  response jsonb,
  status text not null check (status in ('ok', 'error', 'timeout', 'disabled')),
  ms int not null default 0,
  at timestamptz not null default now()
);

-- Files (Excel uploads, comment photos, PDF exports) live in Storage; this is the index.
create table app.files (
  uri text primary key,
  workspace_id text references app.workspaces(id) on delete cascade,
  name text not null,
  mime text not null,
  size bigint not null,
  created_at timestamptz not null default now()
);

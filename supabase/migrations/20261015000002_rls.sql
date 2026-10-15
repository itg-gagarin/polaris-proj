-- Row-level access by workspace and team (PRD §12 security). Requires Supabase's auth.uid().

create or replace function app.current_member(ws text) returns app.members
language sql stable security definer set search_path = app, public as $$
  select m.* from app.members m where m.workspace_id = ws and m.auth_user_id = auth.uid() limit 1
$$;

create or replace function app.is_member(ws text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.members m where m.workspace_id = ws and m.auth_user_id = auth.uid())
$$;

create or replace function app.has_role(ws text, roles text[]) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (select 1 from app.members m where m.workspace_id = ws and m.auth_user_id = auth.uid() and not m.external and m.role = any(roles))
$$;

-- External buyers see only products shared with them.
create or replace function app.can_view_product(pid text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.products p join app.members m on m.workspace_id = p.workspace_id
    where p.id = pid and m.auth_user_id = auth.uid() and (not m.external or p.shared_with_buyer)
  )
$$;

create or replace function app.product_workspace(pid text) returns text
language sql stable security definer set search_path = app, public as $$ select workspace_id from app.products where id = pid $$;

create or replace function app.revision_product(rid text) returns text
language sql stable security definer set search_path = app, public as $$ select product_id from app.revisions where id = rid $$;

create or replace function app.member_id(ws text) returns text
language sql stable security definer set search_path = app, public as $$ select id from app.members where workspace_id = ws and auth_user_id = auth.uid() limit 1 $$;

alter table app.workspaces enable row level security;
alter table app.members enable row level security;
alter table app.std_parts enable row level security;
alter table app.products enable row level security;
alter table app.revisions enable row level security;
alter table app.check_results enable row level security;
alter table app.reviews enable row level security;
alter table app.threads enable row level security;
alter table app.comments enable row level security;
alter table app.notifications enable row level security;
alter table app.boards enable row level security;
alter table app.board_docs enable row level security;
alter table app.meetings enable row level security;
alter table app.meeting_notes enable row level security;
alter table app.decisions enable row level security;
alter table app.recordings enable row level security;
alter table app.audit_events enable row level security;
alter table app.ai_runs enable row level security;
alter table app.files enable row level security;

create policy ws_read on app.workspaces for select using (app.is_member(id));
create policy ws_admin on app.workspaces for update using (app.has_role(id, array['admin']));

create policy members_read on app.members for select using (app.is_member(workspace_id));
create policy members_admin on app.members for all using (app.has_role(workspace_id, array['admin'])) with check (app.has_role(workspace_id, array['admin']));

-- The dictionary is readable by anyone signed in; writes go through the service role (dictionary owner, PRD §14).
create policy std_read on app.std_parts for select using (auth.uid() is not null);

create policy products_read on app.products for select using (app.can_view_product(id));
create policy products_write on app.products for insert with check (app.has_role(workspace_id, array['editor', 'lead', 'admin']));
create policy products_update on app.products for update using (app.has_role(workspace_id, array['editor', 'lead', 'admin']));

create policy revisions_read on app.revisions for select using (app.can_view_product(product_id));
create policy revisions_insert on app.revisions for insert with check (app.has_role(app.product_workspace(product_id), array['editor', 'lead', 'admin']));
-- Editors edit drafts; releasing needs a lead (the state change is also enforced by the API).
create policy revisions_update on app.revisions for update using (app.has_role(app.product_workspace(product_id), array['editor', 'lead', 'admin']))
  with check (state <> 'released' or app.has_role(app.product_workspace(product_id), array['lead', 'admin']));

create policy checks_read on app.check_results for select using (app.can_view_product(app.revision_product(revision_id)));

create policy reviews_read on app.reviews for select using (app.can_view_product(app.revision_product(revision_id)));
-- A reviewer approves only their own team's lane; leads and admins any lane.
create policy reviews_write on app.reviews for update using (
  exists (
    select 1 from app.members m
    where m.workspace_id = app.product_workspace(app.revision_product(revision_id)) and m.auth_user_id = auth.uid() and not m.external
      and (m.role in ('lead', 'admin') or (m.role in ('reviewer', 'editor') and team = any(m.teams)))
  )
);
create policy reviews_insert on app.reviews for insert with check (app.has_role(app.product_workspace(app.revision_product(revision_id)), array['editor', 'lead', 'admin']));

create policy threads_read on app.threads for select using (app.can_view_product(product_id));
create policy threads_write on app.threads for insert with check (app.can_view_product(product_id));
create policy threads_update on app.threads for update using (app.can_view_product(product_id));
create policy comments_read on app.comments for select using (exists (select 1 from app.threads t where t.id = thread_id and app.can_view_product(t.product_id)));
create policy comments_write on app.comments for insert with check (exists (select 1 from app.threads t where t.id = thread_id and app.can_view_product(t.product_id)) and author_id = app.member_id(app.product_workspace((select product_id from app.threads where id = thread_id))));

create policy notifications_own on app.notifications for all using (user_id in (select id from app.members where auth_user_id = auth.uid()));

create policy boards_rw on app.boards for all using (app.is_member(workspace_id)) with check (app.has_role(workspace_id, array['reviewer', 'editor', 'lead', 'admin']));
create policy board_docs_rw on app.board_docs for all using (app.is_member(workspace_id));

create policy meetings_read on app.meetings for select using (app.can_view_product(product_id));
create policy meetings_write on app.meetings for all using (app.has_role(app.product_workspace(product_id), array['editor', 'lead', 'admin']));
-- Private notes are visible to their author only until shared.
create policy notes_read on app.meeting_notes for select using (
  exists (select 1 from app.meetings mt where mt.id = meeting_id and app.can_view_product(mt.product_id))
  and (visibility = 'shared' or author_id in (select id from app.members where auth_user_id = auth.uid()))
);
create policy notes_write on app.meeting_notes for insert with check (author_id in (select id from app.members where auth_user_id = auth.uid()));
create policy notes_update on app.meeting_notes for update using (author_id in (select id from app.members where auth_user_id = auth.uid()));
create policy decisions_read on app.decisions for select using (exists (select 1 from app.meetings mt where mt.id = meeting_id and app.can_view_product(mt.product_id)));
create policy decisions_write on app.decisions for all using (exists (select 1 from app.meetings mt where mt.id = meeting_id and (mt.note_taker_id = app.member_id(app.product_workspace(mt.product_id)) or mt.lead_id = app.member_id(app.product_workspace(mt.product_id)))));
create policy recordings_read on app.recordings for select using (exists (select 1 from app.meetings mt where mt.id = meeting_id and app.can_view_product(mt.product_id)));

create policy audit_read on app.audit_events for select using (app.is_member(workspace_id));
create policy audit_insert on app.audit_events for insert with check (app.is_member(workspace_id));

create policy ai_runs_read on app.ai_runs for select using (app.has_role(workspace_id, array['editor', 'lead', 'admin']));
create policy files_read on app.files for select using (workspace_id is null or app.is_member(workspace_id));

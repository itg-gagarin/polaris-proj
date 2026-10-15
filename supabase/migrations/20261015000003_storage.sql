-- Supabase Storage buckets (Excel uploads, comment photos, PDF / GLB / DXF / STEP exports, recordings).
-- Skipped outside Supabase (no storage schema).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values
      ('imports', 'imports', false),
      ('attachments', 'attachments', false),
      ('exports', 'exports', false),
      ('recordings', 'recordings', false)
    on conflict (id) do nothing;
  end if;
end $$;

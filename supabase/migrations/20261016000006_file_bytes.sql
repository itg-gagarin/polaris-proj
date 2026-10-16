-- Small generated files (exports, import previews, AI suggestions) are kept in the database when no
-- object store is configured, so a single free Postgres is enough to run the app.
alter table app.files add column if not exists bytes bytea;

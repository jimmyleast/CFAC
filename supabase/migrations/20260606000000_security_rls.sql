-- ============================================================
-- CFAC — security hardening: lock down RLS + grants
-- Fixes: "RLS disabled" on a hosted Supabase project still lets the
-- public anon key read/write tables via PostgREST. Enabling RLS with
-- NO policy = deny-all for anon/authenticated; service_role bypasses
-- RLS so all API routes (getAdminClient) keep working unchanged.
-- Idempotent / safe to re-run.
-- ============================================================

-- 1. Enable RLS on every platform table (deny-all to anon/authenticated).
alter table user_profiles enable row level security;
alter table teams         enable row level security;
alter table team_members  enable row level security;
alter table squads        enable row level security;
alter table squad_members enable row level security;
alter table user_roles    enable row level security;
alter table feature_flags enable row level security;
alter table app_events    enable row level security;

-- 2. Data tables already have RLS enabled. Drop the broad "authenticated can
--    read all" policies — nothing in the app reads these via the browser/anon
--    client (all reads go through service-role API routes), so deny-all is
--    safe and closes the exposure. Re-add team-scoped policies later if a
--    client-side dashboard ever needs direct reads.
drop policy if exists "auth read data_sources" on data_sources;
drop policy if exists "auth read metrics" on metrics;
drop policy if exists "auth read import_rows" on import_rows;

-- 3. Defense in depth: revoke default table privileges from the public roles.
--    service_role retains access (it is not affected by these revokes for its
--    own grants and bypasses RLS regardless).
revoke all on user_profiles, teams, team_members, squads, squad_members,
              user_roles, feature_flags, app_events,
              data_sources, metrics, import_rows
  from anon, authenticated;

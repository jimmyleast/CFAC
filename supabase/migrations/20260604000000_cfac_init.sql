-- ============================================================
-- CFAC — initial schema (standalone)
-- Children & Family Advocacy Center · operations & data platform
-- Run this in the Supabase SQL Editor (paste whole file, Run).
-- Safe to re-run: everything is IF NOT EXISTS / idempotent.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- shared helper: updated_at ----------
create or replace function set_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ============================================================
-- PLATFORM: auth, profiles, teams, roles, flags, telemetry
-- (RLS disabled — the app accesses these via the service-role
--  key and enforces authorization in API routes.)
-- ============================================================

-- 1. User profiles (extends auth.users)
create table if not exists user_profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text,
  title         text,
  phone         text,
  active        boolean not null default true,
  is_admin      boolean not null default false,
  default_team_id uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_user_profiles_email on user_profiles(email);

-- 2. Teams (CFAC starts with Executive + Data; add programs/residential/advocacy later)
create table if not exists teams (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  slug         text not null unique,
  description  text,
  lead_user_id uuid references user_profiles(id) on delete set null,
  programs     text[] default '{}',
  color        text default '#C9A84C',
  icon         text,
  active       boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- backfill the FK from user_profiles.default_team_id now that teams exists
do $$ begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'user_profiles_default_team_id_fkey') then
    alter table user_profiles
      add constraint user_profiles_default_team_id_fkey
      foreign key (default_team_id) references teams(id) on delete set null;
  end if;
end $$;

create table if not exists team_members (
  id        uuid primary key default gen_random_uuid(),
  team_id   uuid not null references teams(id) on delete cascade,
  user_id   uuid not null references user_profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('lead','member','viewer')),
  added_by  uuid references user_profiles(id),
  added_at  timestamptz default now(),
  unique(team_id, user_id)
);
create index if not exists idx_team_members_team_id on team_members(team_id);
create index if not exists idx_team_members_user_id on team_members(user_id);

-- 3. Squads (lightweight grouping used by admin/access helpers)
create table if not exists squads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  area        text,
  color       text not null default '#C9A84C',
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists squad_members (
  id        uuid primary key default gen_random_uuid(),
  squad_id  uuid not null references squads(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('lead','member')),
  created_at timestamptz not null default now(),
  unique(squad_id, user_id)
);
create index if not exists idx_squad_members_user_id on squad_members(user_id);
create index if not exists idx_squad_members_squad_id on squad_members(squad_id);

-- 4. Simple role lookup by email (used by getUserRole)
create table if not exists user_roles (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  role       text not null default 'staff' check (role in ('admin','squad_lead','staff')),
  created_at timestamptz not null default now()
);
create unique index if not exists idx_user_roles_email on user_roles(lower(email));

-- 5. Feature flags
create table if not exists feature_flags (
  key             text primary key,
  description     text,
  enabled         boolean not null default false,
  rollout_percent integer not null default 0 check (rollout_percent >= 0 and rollout_percent <= 100),
  target_roles    text[] not null default '{}',
  allowed_user_ids uuid[] not null default '{}',
  conditions      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 6. Telemetry events
create table if not exists app_events (
  id          uuid primary key default gen_random_uuid(),
  event_name  text not null,
  category    text not null,
  user_id     uuid references auth.users(id) on delete set null,
  process_id  uuid,                 -- generic reference id (no FK; kept for telemetry compatibility)
  route       text,
  status      text,
  duration_ms integer,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_app_events_created_at on app_events(created_at desc);
create index if not exists idx_app_events_event_name on app_events(event_name);
create index if not exists idx_app_events_category on app_events(category);
create index if not exists idx_app_events_user_id on app_events(user_id);

-- triggers
drop trigger if exists user_profiles_updated_at on user_profiles;
create trigger user_profiles_updated_at before update on user_profiles
  for each row execute function set_updated_at();
drop trigger if exists teams_updated_at on teams;
create trigger teams_updated_at before update on teams
  for each row execute function set_updated_at();
drop trigger if exists squads_updated_at on squads;
create trigger squads_updated_at before update on squads
  for each row execute function set_updated_at();
drop trigger if exists feature_flags_updated_at on feature_flags;
create trigger feature_flags_updated_at before update on feature_flags
  for each row execute function set_updated_at();

-- platform RLS off (API enforces via service role)
alter table user_profiles disable row level security;
alter table teams         disable row level security;
alter table team_members  disable row level security;
alter table squads        disable row level security;
alter table squad_members disable row level security;
alter table user_roles    disable row level security;
alter table feature_flags disable row level security;
alter table app_events    disable row level security;

-- ============================================================
-- CFAC DATA LAYER
-- Generic, tidy model so we don't need a table per spreadsheet.
-- v1 holds non-PII aggregate metrics only (no client PII yet).
-- ============================================================

-- A source = one spreadsheet / form / connected system / manual feed
create table if not exists data_sources (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  kind         text not null default 'spreadsheet' check (kind in ('spreadsheet','form','system','manual')),
  owner_team_id uuid references teams(id) on delete set null,
  description  text,
  last_imported_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Tidy metric facts: one row per (source, metric, period[, dimension])
create table if not exists metrics (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid references data_sources(id) on delete cascade,
  metric_key   text not null,            -- e.g. 'clients_served', 'services_delivered', 'residential_active'
  label        text,                     -- human label from the sheet's operational-definitions tab
  value        numeric,
  unit         text,                     -- 'count' | 'usd' | 'hours' | 'percent' ...
  period_start date,
  period_end   date,
  period_label text,                     -- 'Jan 2026', 'Q1 2026', 'Week of 2026-06-01'
  dimension    jsonb not null default '{}'::jsonb,  -- breakdowns: {"program":"residential","agency":"DCFS"}
  created_at   timestamptz not null default now()
);
create index if not exists idx_metrics_key on metrics(metric_key);
create index if not exists idx_metrics_source on metrics(source_id);
create index if not exists idx_metrics_period on metrics(period_start);

-- Raw import staging — powers the data-integrity / exceptions view
create table if not exists import_rows (
  id          uuid primary key default gen_random_uuid(),
  source_id   uuid references data_sources(id) on delete cascade,
  imported_by uuid references auth.users(id) on delete set null,
  batch_id    uuid,
  row_index   integer,
  raw         jsonb not null default '{}'::jsonb,
  status      text not null default 'ok' check (status in ('ok','missing','mismatch','error')),
  issues      jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_import_rows_source on import_rows(source_id);
create index if not exists idx_import_rows_status on import_rows(status);
create index if not exists idx_import_rows_batch on import_rows(batch_id);

drop trigger if exists data_sources_updated_at on data_sources;
create trigger data_sources_updated_at before update on data_sources
  for each row execute function set_updated_at();

-- Data layer: RLS ON. Authenticated users may read; writes go through
-- the service-role API. (When client-PII tables arrive in later phases,
-- they get stricter, role-scoped policies — see data-handling rules.)
alter table data_sources enable row level security;
alter table metrics      enable row level security;
alter table import_rows  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='data_sources' and policyname='auth read data_sources') then
    create policy "auth read data_sources" on data_sources for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='metrics' and policyname='auth read metrics') then
    create policy "auth read metrics" on metrics for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='import_rows' and policyname='auth read import_rows') then
    create policy "auth read import_rows" on import_rows for select to authenticated using (true);
  end if;
end $$;

-- ============================================================
-- SEED
-- ============================================================

-- Feature flags the app expects
insert into feature_flags (key, description, enabled, rollout_percent) values
  ('telemetry_events', 'Enable in-app telemetry event writes.', true, 100),
  ('morgan_schema_guard', 'Enable strict coercion/guardrails for agent JSON payloads.', true, 100)
on conflict (key) do nothing;

-- Teams = CFAC's real components (nav starts on Executive + Data; the rest
-- exist so data_sources can be owned/grouped and nav can expand later).
insert into teams (name, slug, description, color, icon) values
  ('Executive',            'executive',  'Org pulse check across programs, services, reach, and financial health.', '#C9A84C', 'LayoutDashboard'),
  ('Data',                 'data',       'Data sources, imports, and integrity.', '#7DD3C7', 'Database'),
  ('Acute',                'acute',      'Acute response: scheduling, transport, initial contact, brief/debrief.', '#C9A84C', 'Siren'),
  ('Advocacy',             'advocacy',   'Family advocacy during/after FI, emergency funds, follow-up, court.', '#C9A84C', 'HeartHandshake'),
  ('Forensic Interviewing','forensic-interviewing', 'Forensic interviews and court testimony.', '#C9A84C', 'Mic'),
  ('Mental Health',        'mental-health', 'Counseling: intake, service delivery, CATS outcomes, crisis.', '#C9A84C', 'Brain'),
  ('Medical',              'medical',    'Medical exams and chart review.', '#C9A84C', 'Stethoscope'),
  ('Residential',          'residential','Residential 4-step program, inquiries/waitlist, rent ledger.', '#C9A84C', 'Home'),
  ('Enrichment',           'enrichment', 'Enrichment activities for clients and community.', '#C9A84C', 'Sparkles'),
  ('Education',            'education',  'Community trainings and prevention education.', '#C9A84C', 'GraduationCap'),
  ('Community Relations',  'community-relations', 'Events, tours, and volunteers.', '#C9A84C', 'Users'),
  ('Development',          'development','Donors, grants, events, in-kind giving.', '#C9A84C', 'Gift'),
  ('Operations',          'operations', 'Facilities, maintenance, fleet, technology.', '#C9A84C', 'Wrench'),
  ('Finance',              'finance',    'Income, purchasing, expenses, payroll.', '#C9A84C', 'DollarSign'),
  ('Human Resources',      'hr',         'Hiring, retention, work culture.', '#C9A84C', 'IdCard'),
  ('Xaya',                 'xaya',       'Therapy dog interactions and scheduling.', '#C9A84C', 'Dog')
on conflict (slug) do nothing;

-- Data sources = CFAC's real spreadsheets / forms / systems (the feeds behind the metrics).
insert into data_sources (name, slug, kind, description, owner_team_id)
select v.name, v.slug, v.kind, v.descr, t.id
from (values
  ('Acute Services Spreadsheet',   'acute-services',     'spreadsheet', 'Day-to-day acute: advocacy, FI, medical, MH consults.', 'acute'),
  ('Mental Health Spreadsheet',    'mental-health-sheet','spreadsheet', 'MH clients through acute/residential; CATS scores, waitlist, touchpoints.', 'mental-health'),
  ('Advocacy (Collaborate)',       'advocacy-collab',    'system',      'Collaborate (CARP) — case demographics, initial report, needs assessment.', 'advocacy'),
  ('Case Review / MDT',            'case-review',        'system',      'MDT case-review agendas (Collaborate downloads → reformatted).', 'advocacy'),
  ('Residential Spreadsheet',      'residential-sheet',  'spreadsheet', 'Residents by phase, inquiries/waitlist, discharge.', 'residential'),
  ('Rent Ledger',                  'rent-ledger',        'spreadsheet', 'Residential rent payments and amount paid to date.', 'residential'),
  ('Enrichment Spreadsheet',       'enrichment-sheet',   'spreadsheet', 'Enrichment activities, audience, location, type.', 'enrichment'),
  ('Xaya Spreadsheet',             'xaya-sheet',         'spreadsheet', 'Therapy dog interactions by service type and location.', 'xaya'),
  ('Education Spreadsheet',        'education-sheet',    'spreadsheet', 'Community trainings: speaker, type, audience, reach.', 'education'),
  ('Community Engagement',         'community-engagement','spreadsheet','Events and tours: attendance, leads, conversions.', 'community-relations'),
  ('Volunteers Spreadsheet',       'volunteers-sheet',   'spreadsheet', 'Individual/group/event volunteers, hours, labor saved.', 'community-relations'),
  ('Medical Spreadsheet',          'medical-sheet',      'spreadsheet', 'Exams by nurse/type, normal/abnormal, charts reviewed.', 'medical'),
  ('Maintenance Request Form',     'maintenance-form',   'form',        'Microsoft Form → Excel: maintenance requests, status, cost.', 'operations'),
  ('Fleet Management Form',        'fleet-form',         'form',        'Microsoft Form → Excel: vehicle use, mileage, issues.', 'operations'),
  ('Development (Bloomerang)',     'development-bloomerang','system',   'Bloomerang donors + QGiv donations; events, grants, in-kind.', 'development'),
  ('Finance (QuickBooks)',         'finance-quickbooks', 'system',      'Income, purchasing, expenses, payroll.', 'finance'),
  ('HR (iSolved)',                 'hr-isolved',         'system',      'Hiring, retention, turnover, work culture.', 'hr'),
  ('Impact Through the Years',     'impact-history',     'spreadsheet', 'Annual reach/served/FI/medical/MH/education/tours/volunteers/residential.', 'executive')
) as v(name, slug, kind, descr, team_slug)
left join teams t on t.slug = v.team_slug
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- ADMIN BOOTSTRAP (run AFTER you first sign in once):
--   update user_profiles set is_admin = true where email = 'YOUR_EMAIL';
--   insert into user_roles (email, role) values ('YOUR_EMAIL','admin')
--     on conflict (lower(email)) do nothing;
-- ------------------------------------------------------------

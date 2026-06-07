-- ============================================================
-- CFAC — Case Review (MDT) schema. Backs the case-review workflow (build-spec
-- Phase 4-5): the three agendas (new / pending / criminal), case-status movement,
-- and MDT agency accountability.
--
-- THIS HOLDS CASE-LEVEL PHI. It ships EMPTY and RLS deny-all. No row may be
-- written until the §5 HIPAA infra gate is satisfied (enforced in the API by
-- PHI_GATE_READY). No seed / no synthetic data — flows operate on real data only.
-- ============================================================

-- MDT partner agencies (law enforcement, DHS, prosecution, …). Reference data,
-- not PHI, but kept here for the accountability views. No fake rows seeded.
create table if not exists agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  type       text not null default 'other'
               check (type in ('law_enforcement','dhs','prosecution','cac','medical','mental_health','other')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- A case = one child-abuse case tracked through the MDT review workflow.
create table if not exists cases (
  id                 uuid primary key default gen_random_uuid(),
  case_number        text,                                  -- external ref (Collaborate)
  status             text not null default 'new'
                       check (status in ('new','pending','criminal','closed')),
  agenda             text                                   -- derived bucket: 'new'|'pending'|'criminal'
                       check (agenda in ('new','pending','criminal')),
  priority           text check (priority in ('P1','P2','P3')),
  assigned_agency_id uuid references agencies(id) on delete set null,
  household_id       text,                                  -- groups family members (de-identified id)
  review_flag        boolean not null default false,        -- needs human review before final
  last_update        date,
  source_id          uuid references data_sources(id) on delete set null,
  summary            text,                                  -- short, redacted summary (PHI-sensitive)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_cases_status on cases(status);
create index if not exists idx_cases_agenda on cases(agenda);
create index if not exists idx_cases_agency on cases(assigned_agency_id);

-- Append-only audit of case-status moves (human-in-the-loop trail).
create table if not exists case_events (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases(id) on delete cascade,
  from_status text,
  to_status   text,
  note        text,
  actor_id    uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_case_events_case on case_events(case_id);

-- RLS: deny-all to anon/authenticated; service-role only (all access via gated API).
alter table agencies    enable row level security;
alter table cases       enable row level security;
alter table case_events enable row level security;
revoke all on agencies, cases, case_events from anon, authenticated;

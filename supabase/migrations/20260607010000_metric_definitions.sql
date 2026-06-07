-- ============================================================
-- CFAC — Operational Definitions library (build-spec §4, §9 Phase 3).
-- The single, enforced source of truth for what every metric MEANS, so teams
-- stop counting differently. Backs the three impact metrics + per-program
-- "client served" rules + service categories. Aggregate/governance metadata
-- only — NO client PII. Idempotent (seed uses ON CONFLICT DO NOTHING so admin
-- edits survive re-runs).
-- ============================================================

create table if not exists metric_definitions (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,         -- 'reach', 'clients_served', 'advocacy_client_served' ...
  display_name    text not null,
  definition      text not null,                -- the operational definition prose
  category        text not null default 'program'
                    check (category in ('impact','program_client','service','program','operational')),
  program_area    text,                          -- 'org','advocacy','residential','mental_health','forensic_interview','medical' ...
  unit            text not null default 'count', -- 'count' | 'usd' | 'hours' | 'percent'
  calc_rule       text,                          -- how it is computed (plain-language, enforced downstream)
  accepted_values jsonb not null default '[]'::jsonb,
  required_fields jsonb not null default '[]'::jsonb,
  parent_key      text,                          -- e.g. per-program client-served rows point to 'clients_served'
  owner           text,                          -- accountable role (from the tech stack)
  source_note     text,                          -- where the number comes from
  is_dedup_rule   boolean not null default false,-- flags the unique-client (no double-count) rule
  sort_order      int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_metric_definitions_category on metric_definitions(category);
create index if not exists idx_metric_definitions_parent on metric_definitions(parent_key);

-- Enforce the unit enum so downstream formatting stays consistent (Integrity).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'metric_definitions_unit_check') then
    alter table metric_definitions
      add constraint metric_definitions_unit_check check (unit in ('count','usd','hours','percent'));
  end if;
end $$;

-- RLS: deny-all to anon/authenticated; service_role (API routes) bypasses.
alter table metric_definitions enable row level security;
revoke all on metric_definitions from anon, authenticated;

-- ============================================================
-- Seed: the org's standardized definitions (build-spec §4).
-- ============================================================

-- The three top-level impact metrics.
insert into metric_definitions (key, display_name, definition, category, program_area, calc_rule, is_dedup_rule, owner, sort_order) values
('reach', 'Reach',
 'Total community impact — the broadest measure. Counts distinct populations: advocacy intakes (households) and inquiries, residents and residential inquiries, outside MH referrals and MH inquiries, donors, tour attendees, event attendees (community/signature/third-party/speaking), volunteers, training attendees, interns, applicant phone screenings, and partnerships (incl. MDT). Org goal: 15% of Benton County (~82,500) by 2040.',
 'impact', 'org',
 'Sum of the distinct §4 Reach populations. A person may appear in more than one population; Reach intentionally sums populations (breadth), unlike Clients Served.',
 false, 'Dir of Development', 10),

('clients_served', 'Clients Served',
 'Unique individuals receiving DIRECT services, each counted once regardless of how many services they receive. Org total = advocacy + residential + external mental-health-referral clients ONLY (per-program counts overlap; the org total deliberately excludes FI/Medical/in-house MH to avoid double-counting). Duplicate prevention is a first-class requirement.',
 'impact', 'org',
 'COUNT(DISTINCT client) WHERE program IN (advocacy, residential, external_mh_referral). Dedup across programs by household/identity before counting.',
 true, 'Dir of Programs', 20),

('services_provided', 'Services Provided',
 'Total individual services/interactions delivered. One client can generate many. Categories: Advocacy, Forensic Interview, Medical, Mental Health, Facility Dog (Xaya), Residential, Enrichment, Training.',
 'impact', 'org',
 'COUNT(service interactions) across all categories. Not deduplicated by client (that is Clients Served).',
 false, 'Dir of Programs', 30)
on conflict (key) do nothing;

-- Per-program "client served" rules (each rolls up under clients_served).
insert into metric_definitions (key, display_name, definition, category, program_area, parent_key, owner, sort_order) values
('advocacy_client_served', 'Advocacy (CARP) — client served',
 'A client with an intake from an MDT referral AND a corresponding Collaborate profile.',
 'program_client', 'advocacy', 'clients_served', 'Dir of Programs', 110),
('residential_client_served', 'Residential — client served',
 'A client housed in the residential program.',
 'program_client', 'residential', 'clients_served', 'Dir of Programs', 120),
('fi_client_served', 'Forensic Interview — client served',
 'A client with a recording of a complete, partial, or attempted forensic interview.',
 'program_client', 'forensic_interview', 'clients_served', 'Dir of Programs', 130),
('medical_client_served', 'Medical — client served',
 'A client with an intake of a complete, partial, or attempted medical exam.',
 'program_client', 'medical', 'clients_served', 'Dir of Programs', 140),
('mh_client_served', 'Mental Health — client served',
 'A client assigned to an in-house mental-health provider.',
 'program_client', 'mental_health', 'clients_served', 'Dir of Programs', 150)
on conflict (key) do nothing;

-- Service categories that roll up under services_provided.
insert into metric_definitions (key, display_name, definition, category, program_area, parent_key, sort_order) values
('svc_advocacy', 'Service — Advocacy', 'An advocacy interaction/service delivered to a client.', 'service', 'advocacy', 'services_provided', 210),
('svc_forensic_interview', 'Service — Forensic Interview', 'A forensic-interview service delivered.', 'service', 'forensic_interview', 'services_provided', 220),
('svc_medical', 'Service — Medical', 'A medical exam/service delivered.', 'service', 'medical', 'services_provided', 230),
('svc_mental_health', 'Service — Mental Health', 'A mental-health service delivered.', 'service', 'mental_health', 'services_provided', 240),
('svc_facility_dog', 'Service — Facility Dog (Xaya)', 'A facility-dog (Xaya) service delivered.', 'service', 'enrichment', 'services_provided', 250),
('svc_residential', 'Service — Residential', 'A residential service delivered.', 'service', 'residential', 'services_provided', 260),
('svc_enrichment', 'Service — Enrichment', 'An enrichment service delivered.', 'service', 'enrichment', 'services_provided', 270),
('svc_training', 'Service — Training', 'A training/education service delivered.', 'service', 'education', 'services_provided', 280)
on conflict (key) do nothing;

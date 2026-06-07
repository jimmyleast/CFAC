-- ============================================================
-- CFAC — Metric Mapping (build-spec §10.4). Wires each operational definition
-- to the source metric_key(s) that feed it + an aggregation rule, so every
-- reported number has explicit lineage (Governance) and the three impact metrics
-- are COMPUTED from mapped sources, never hardcoded (build-spec §8). A definition
-- with no active mapping is "unmapped" and flagged. Aggregate metadata only — no
-- client PII. Idempotent (ON CONFLICT DO NOTHING).
-- ============================================================

create table if not exists metric_mappings (
  id                uuid primary key default gen_random_uuid(),
  definition_key    text not null,                 -- metric_definitions.key (impact/program/service)
  source_metric_key text not null,                 -- metrics.metric_key this reads
  agg               text not null default 'latest' check (agg in ('latest','sum','count','avg')),
  status            text not null default 'active' check (status in ('active','draft')),
  note              text,
  created_at        timestamptz not null default now(),
  unique (definition_key, source_metric_key)
);
create index if not exists idx_metric_mappings_def on metric_mappings(definition_key);

alter table metric_mappings enable row level security;
revoke all on metric_mappings from anon, authenticated;

-- ============================================================
-- Seed the impact-metric lineage from the current annual impact data.
-- These are editable: admins refine mappings as real per-program data lands.
-- ============================================================
insert into metric_mappings (definition_key, source_metric_key, agg, note) values
-- Reach = the org's reach figure (latest period).
('reach', 'reach', 'latest', 'Org reach headline'),
-- Clients Served (v1 proxy): the flagship unique-children-served number. §4 target
-- is advocacy + residential + external-MH; refine to that breakdown when per-program
-- client data lands. Kept as a single mapping today (already a deduped count).
('clients_served', 'children_served', 'latest', 'v1 proxy — refine to advocacy+residential+external-MH'),
-- Services Provided = sum of the delivered-service categories present in the data.
('services_provided', 'forensic_interviews', 'latest', 'FI services'),
('services_provided', 'medical', 'latest', 'Medical services'),
('services_provided', 'mental_health', 'latest', 'Mental-health services'),
('services_provided', 'education', 'latest', 'Training/education services')
on conflict (definition_key, source_metric_key) do nothing;

-- Per-program / service lineage (for the mapping tool's traceability view; not summed
-- into the impact totals, which use their own mappings above).
insert into metric_mappings (definition_key, source_metric_key, agg, note) values
('fi_client_served', 'forensic_interviews', 'latest', null),
('medical_client_served', 'medical', 'latest', null),
('mh_client_served', 'mental_health', 'latest', null),
('residential_client_served', 'res_children', 'latest', 'Residential — children'),
('residential_client_served', 'res_women', 'latest', 'Residential — women'),
('svc_forensic_interview', 'forensic_interviews', 'latest', null),
('svc_medical', 'medical', 'latest', null),
('svc_mental_health', 'mental_health', 'latest', null),
('svc_training', 'education', 'latest', null)
on conflict (definition_key, source_metric_key) do nothing;

-- Transparency: Services Provided lists 8 categories but only those with landed
-- source data are summed today. Flag the v1 subset in the definition (idempotent).
update metric_definitions
  set calc_rule = calc_rule || ' [v1: sums only service categories with landed source data — Forensic Interview, Medical, Mental Health, Training. Advocacy, Facility Dog (Xaya), Residential, and Enrichment are added as their source metrics land.]'
  where key = 'services_provided' and calc_rule not like '%v1: sums only%';

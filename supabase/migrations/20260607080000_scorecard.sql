-- ============================================================
-- CFAC — EOS Scorecard. The small set of weekly leading-indicator numbers the
-- org runs on (build-spec §3 "EOS Scorecard"). Each row defines a measurable:
-- a name, owner, goal, and an optional link to a real metric_key so actuals
-- populate from the data layer. Aggregate/config metadata only — no client PHI.
-- Ships EMPTY (no seed); admins define the measurables. RLS deny-all.
-- ============================================================

create table if not exists scorecard_metrics (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner          text,
  goal_value     numeric,
  goal_direction text not null default 'at_least' check (goal_direction in ('at_least','at_most')),
  unit           text not null default 'count',
  metric_key     text,                                  -- optional link → metrics.metric_key for auto actuals
  component_id   uuid references components(id) on delete set null,
  sort_order     int not null default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_scorecard_component on scorecard_metrics(component_id);

alter table scorecard_metrics enable row level security;
revoke all on scorecard_metrics from anon, authenticated, public;

-- `owner` is the STAFF member accountable for the measurable (EOS owner) — a staff
-- name only. Never store client/victim identifiers here; this table is aggregate-only
-- and lives outside the PHI gate.
comment on column scorecard_metrics.owner is 'Staff owner name only — no client identifiers (aggregate-only table, outside PHI gate)';

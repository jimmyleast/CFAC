-- ============================================================
-- CFAC — Connect invites. An admin generates a one-time, expiring link for a
-- specific system; the staff OWNER of that system (Dir of Development for
-- Bloomerang, Event Coordinator for Qgiv, etc.) opens it and submits their own
-- API key, which is encrypted + stored — the admin never sees the credential.
-- Scoped to API-key, non-PHI providers (OAuth/PHI invites are a later step).
-- RLS deny-all (service-role only). Tokens are high-entropy + single-use.
-- ============================================================

create table if not exists connect_invites (
  token       text primary key,
  provider    text not null,
  label       text,                                   -- who it's for, e.g. "Dir of Development"
  created_by  uuid,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     text,                                   -- optional note/name the connector enters
  created_at  timestamptz not null default now()
);
create index if not exists idx_connect_invites_provider on connect_invites(provider);
create index if not exists idx_connect_invites_expires on connect_invites(expires_at);

alter table connect_invites enable row level security;
revoke all on connect_invites from anon, authenticated;

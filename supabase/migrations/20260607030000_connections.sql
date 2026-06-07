-- ============================================================
-- CFAC — Connector broker (INTEGRATION-ARCHITECTURE.md). Stores per-provider
-- connection state + ENCRYPTED OAuth tokens / API keys (AES-256-GCM at the app
-- layer via CONNECTOR_ENC_KEY; ciphertext only is ever stored here). One
-- connection per provider (org-level). RLS deny-all — service-role only.
--
-- IMPORTANT: tokens here are credentials, NOT client PHI. PHI flows are still
-- gated behind the Supabase HIPAA add-on + BAAs (COMPLIANCE.md §5). Non-BAA
-- providers (QuickBooks, Asana) carry non-PHI data only.
-- ============================================================

create table if not exists connections (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null unique,                 -- 'microsoft','quickbooks','bloomerang','qgiv'
  status            text not null default 'disconnected' check (status in ('connected','disconnected','error')),
  auth_kind         text not null default 'oauth2' check (auth_kind in ('oauth2','apikey')),
  external_label    text,                                   -- account/company/realm label
  scopes            text,
  access_token_enc  text,                                   -- AES-256-GCM ciphertext
  refresh_token_enc text,
  api_key_enc       text,
  token_expires_at  timestamptz,
  last_sync_at      timestamptz,
  last_error        text,
  connected_by      uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table connections enable row level security;
revoke all on connections from anon, authenticated;

-- Ephemeral OAuth handshake state (CSRF + PKCE verifier). Short-lived; cleaned on use.
create table if not exists oauth_states (
  state         text primary key,
  provider      text not null,
  code_verifier text not null,
  redirect_to   text,
  user_id       uuid,
  created_at    timestamptz not null default now()
);
create index if not exists idx_oauth_states_created on oauth_states(created_at);

alter table oauth_states enable row level security;
revoke all on oauth_states from anon, authenticated;

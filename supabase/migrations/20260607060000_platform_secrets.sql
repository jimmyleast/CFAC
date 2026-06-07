-- ============================================================
-- CFAC — platform_secrets. A get-or-create store for the connector encryption
-- key so connecting works with ZERO server config (no CONNECTOR_ENC_KEY env
-- required for a soft launch). Credentials stay encrypted at rest (AES-256-GCM);
-- this just removes the setup blocker.
--
-- SECURITY NOTE (harden later): a DB-stored key sits closer to the ciphertext
-- than an env/KMS key would. This is a deliberate soft-launch tradeoff — set
-- CONNECTOR_ENC_KEY in the server env (which takes precedence) to upgrade, and
-- move to a KMS before PHI. RLS deny-all; service-role only.
-- ============================================================

create table if not exists platform_secrets (
  key        text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

alter table platform_secrets enable row level security;
revoke all on platform_secrets from anon, authenticated, public;

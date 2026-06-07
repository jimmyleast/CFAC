-- ============================================================
-- CFAC — make the connector encryption key WRITE-ONCE at the DB level.
--
-- WHY: lib/connectors/crypto.ts seals every connector credential
-- (connections.*_enc, AES-256-GCM) with the single platform_secrets row
-- key='connector_enc'. The app already refuses to overwrite that row
-- (create-if-absent + read-back-the-winner), because changing OR deleting
-- the value would render ALL previously-sealed ciphertext permanently
-- undecryptable — every stored credential orphaned. But nothing at the DB
-- level enforced that: a future code path or a manual service-role write
-- could still UPDATE/DELETE the row and silently destroy every secret.
--
-- WHAT: a trigger that raises on any UPDATE or DELETE of the connector_enc
-- row, making the key effectively immutable once created. INSERT is still
-- allowed (so the get-or-create path works), and other platform_secrets
-- rows are unaffected.
--
-- NOT ROTATION: this is purely about preventing accidental orphaning. Real
-- key rotation must re-wrap existing ciphertext under a NEW key and is an
-- explicit, documented path — e.g. a versioned key id ('connector_enc_v2')
-- inserted as a NEW row plus a re-encrypt step over connections.*_enc — NOT
-- an in-place mutation of this row. Rotating in place is exactly what this
-- guard exists to prevent.
--
-- OPERATOR NOTE (read before "fixing" a failed write): this guard raises with
-- the DISTINCTIVE SQLSTATE 'WO001' (write-once) and a message naming
-- connector_enc — deliberately NOT the generic check_violation (23514), so the
-- event is unambiguous in the Postgres logs. If you see 'WO001' /
-- "connector_enc is write-once", STOP: do NOT disable this trigger and do NOT
-- ALTER/retry the write. Disabling it and mutating the row orphans every sealed
-- connector credential, permanently and silently. The only sanctioned change is
-- the versioned-key + re-encrypt path above. See docs/SETUP-CONNECTORS.md.
--
-- Safe to re-run: function is create-or-replace; trigger is dropped first.
-- RLS deny-all; service-role only (the guard binds even for service-role).
-- ============================================================

create or replace function platform_secrets_guard_connector_enc()
returns trigger as $$
begin
  -- Guard only the connector_enc key; all other rows behave normally.
  if tg_op = 'DELETE' then
    if old.key = 'connector_enc' then
      -- SQLSTATE 'WO001' (write-once) is a deliberate custom code, NOT generic
      -- check_violation, so this critical event is greppable + unambiguous in logs.
      raise exception
        'platform_secrets.connector_enc is write-once: DELETE is blocked (would orphan all sealed connector credentials). Rotate via a new versioned key + re-encrypt, never by deleting this row.'
        using errcode = 'WO001';
    end if;
    return old;
  end if;

  -- UPDATE: block any change to the connector_enc row. Also block re-keying a
  -- different row INTO connector_enc, which would collide/shadow the canonical key.
  if old.key = 'connector_enc' or new.key = 'connector_enc' then
    raise exception
      'platform_secrets.connector_enc is write-once: UPDATE is blocked (would orphan all sealed connector credentials). Rotate via a new versioned key + re-encrypt, never by mutating this row.'
      using errcode = 'WO001';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists platform_secrets_protect_connector_enc on platform_secrets;
create trigger platform_secrets_protect_connector_enc
  before update or delete on platform_secrets
  for each row execute function platform_secrets_guard_connector_enc();

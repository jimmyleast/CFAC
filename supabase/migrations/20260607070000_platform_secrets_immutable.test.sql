-- ============================================================
-- CFAC — self-test for the connector_enc write-once guard.
-- (Companion to 20260607070000_platform_secrets_immutable.sql.)
--
-- NOT a migration — do NOT run as part of deploy. This is an executable proof
-- you can paste into the Supabase SQL editor AFTER the guard migration is
-- applied, to confirm the trigger actually binds. It runs entirely inside a
-- transaction and ROLLS BACK, so it persists NOTHING: any real connector_enc
-- key already present is left untouched (the guard blocks its mutation anyway),
-- and the throwaway rows it creates are discarded.
--
-- No real secrets: the only value written is an obvious placeholder.
-- Expected result: a single `PASS:` notice. Any `FAIL:` aborts with an error.
-- ============================================================

begin;

do $$
declare
  caught boolean;
begin
  -- Ensure a connector_enc row exists to test against. INSERT is allowed by the
  -- guard; on-conflict-do-nothing leaves any real key intact and unread.
  insert into platform_secrets (key, value)
    values ('connector_enc', 'TEST-PLACEHOLDER-NOT-A-REAL-KEY')
    on conflict (key) do nothing;

  -- 1. UPDATE of connector_enc must raise WO001.
  caught := false;
  begin
    update platform_secrets set value = 'tampered' where key = 'connector_enc';
  exception when sqlstate 'WO001' then caught := true;
  end;
  if not caught then raise exception 'FAIL: UPDATE of connector_enc was NOT blocked'; end if;

  -- 2. DELETE of connector_enc must raise WO001.
  caught := false;
  begin
    delete from platform_secrets where key = 'connector_enc';
  exception when sqlstate 'WO001' then caught := true;
  end;
  if not caught then raise exception 'FAIL: DELETE of connector_enc was NOT blocked'; end if;

  -- 3. Re-keying a DIFFERENT row INTO connector_enc must raise WO001 (shadow guard).
  insert into platform_secrets (key, value) values ('wo_test_other', 'x')
    on conflict (key) do nothing;
  caught := false;
  begin
    update platform_secrets set key = 'connector_enc' where key = 'wo_test_other';
  exception when sqlstate 'WO001' then caught := true;
  end;
  if not caught then raise exception 'FAIL: rename of another row INTO connector_enc was NOT blocked'; end if;

  -- 4. Normal UPDATE of a different row must SUCCEED (guard is not over-broad).
  update platform_secrets set value = 'y' where key = 'wo_test_other';
  if not found then raise exception 'FAIL: UPDATE of an unrelated row did not apply'; end if;

  -- 5. Normal DELETE of a different row must SUCCEED.
  delete from platform_secrets where key = 'wo_test_other';
  if not found then raise exception 'FAIL: DELETE of an unrelated row did not apply'; end if;

  raise notice 'PASS: connector_enc is write-once (UPDATE/DELETE/rename-into blocked); other rows mutate normally.';
end $$;

rollback;

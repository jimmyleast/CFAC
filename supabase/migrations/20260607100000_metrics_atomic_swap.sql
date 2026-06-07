-- ============================================================
-- CFAC — atomic metrics swap for the connector sync engine.
--
-- WHY: lib/connectors/sync.ts replaced a data_source's metrics with a two-step
-- app-side dance — insert the fresh rows, THEN delete the old ones. That is not
-- atomic: a crash (or a sync whose lock lease expired mid-run) BETWEEN the
-- insert and the delete leaves BOTH sets live for the source, doubling every
-- figure on the dashboard until the next clean run. The per-provider sync lock
-- (20260607090000_sync_lock.sql) makes the overlap rare, but does not close the
-- crash-in-the-middle window.
--
-- WHAT: do the delete + insert inside ONE function/transaction. Either both
-- apply or neither does, so the source's metrics are NEVER two live sets (no
-- double-count) and NEVER momentarily empty (no blank-dashboard window); a
-- failed insert rolls the delete back too, preserving the prior data — the same
-- non-destructive guarantee the app code aimed for, now enforced atomically.
-- A transaction-scoped advisory lock keyed on p_source_id serializes concurrent
-- calls for the same source, so doubling is impossible even for a brand-new
-- (zero-row) source where the DELETE has nothing to lock on — and even if the
-- app-level per-provider lock is ever defeated. (The app lock still exists and
-- earns its keep by avoiding redundant provider API pulls; do not remove it.)
--
-- Aggregate metrics only — no client PHI. RLS on `metrics` stays deny-all; this
-- function is SECURITY INVOKER (no privilege escalation), pins search_path, and
-- EXECUTE is revoked from anon/authenticated/public so only the service-role
-- server path calls it. Safe to re-run: create-or-replace.
-- ============================================================

create or replace function replace_source_metrics(p_source_id uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serialize same-source swaps so two concurrent calls can't both insert a full
  -- set on an empty source. Transaction-scoped: auto-released on commit/rollback.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_source_id::text, 0));

  -- One transaction: clear the source's metrics, then load the fresh set.
  delete from public.metrics where source_id = p_source_id;

  insert into public.metrics (source_id, metric_key, label, value, unit, period_label, period_start, dimension)
  select p_source_id, r.metric_key, r.label, r.value, r.unit, r.period_label, r.period_start,
         pg_catalog.coalesce(r.dimension, '{}'::jsonb)
  from pg_catalog.jsonb_to_recordset(p_rows) as r(
    metric_key text, label text, value numeric, unit text,
    period_label text, period_start date, dimension jsonb
  )
  where r.metric_key is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Lock down execution: service-role (which bypasses RLS) only. The deny-all RLS
-- on `metrics` already blanks anon/authenticated, but revoking EXECUTE removes
-- even the ability to call this swap.
revoke all on function replace_source_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function replace_source_metrics(uuid, jsonb) to service_role;

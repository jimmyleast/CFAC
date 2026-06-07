-- ============================================================
-- CFAC — self-test for the atomic metrics swap.
-- (Companion to 20260607100000_metrics_atomic_swap.sql.)
--
-- NOT a migration — do NOT run as part of deploy. Paste into the Supabase SQL
-- editor AFTER the swap migration is applied, to confirm the function actually
-- (a) replaces a source's metrics with exactly one set, (b) is ATOMIC — a failed
-- insert rolls the delete back, preserving prior data — and (c) is EXECUTE-locked
-- to service_role. Runs entirely inside a transaction and ROLLS BACK: persists
-- NOTHING. Uses a throwaway data_source + synthetic aggregate metrics only.
--
-- Expected result: a single `PASS:` notice. Any `FAIL:` aborts with an error.
-- ============================================================

begin;

do $$
declare
  v_src uuid := gen_random_uuid();
  v_count integer;
  caught boolean;
begin
  -- Throwaway source + a pre-existing "old" metric set (2 rows).
  insert into data_sources (id, name, slug, kind) values (v_src, 'TEST swap', 'test-swap-'||v_src, 'system');
  insert into metrics (source_id, metric_key, label, value, unit) values
    (v_src, 'old_a', 'Old A', 1, 'count'),
    (v_src, 'old_b', 'Old B', 2, 'count');

  -- 1. A successful swap REPLACES: old rows gone, exactly the new set remains.
  v_count := replace_source_metrics(v_src, '[
    {"metric_key":"new_x","label":"X","value":10,"unit":"count","period_label":"2026","period_start":null,"dimension":{}},
    {"metric_key":"new_y","label":"Y","value":20,"unit":"count","period_label":"2026","period_start":"2026-03-01","dimension":{}}
  ]'::jsonb);
  if v_count <> 2 then raise exception 'FAIL: swap returned % inserted rows, expected 2', v_count; end if;
  if (select count(*) from metrics where source_id = v_src) <> 2 then
    raise exception 'FAIL: source has % rows after swap, expected exactly one set (2)', (select count(*) from metrics where source_id = v_src);
  end if;
  if exists (select 1 from metrics where source_id = v_src and metric_key like 'old_%') then
    raise exception 'FAIL: old metrics were not deleted by the swap';
  end if;

  -- 2. ATOMICITY: a swap that fails mid-flight (bad date → cast error AFTER the
  --    internal delete) must roll BOTH back, leaving the current set intact.
  caught := false;
  begin
    perform replace_source_metrics(v_src, '[{"metric_key":"boom","value":1,"period_start":"not-a-date"}]'::jsonb);
  exception when others then caught := true;  -- subtransaction rolls back the delete too
  end;
  if not caught then raise exception 'FAIL: a bad-date swap did not raise'; end if;
  if (select count(*) from metrics where source_id = v_src) <> 2
     or exists (select 1 from metrics where source_id = v_src and metric_key not like 'new_%') then
    raise exception 'FAIL: failed swap was NOT rolled back — prior metrics lost or changed';
  end if;

  -- 3. null/absent metric_key rows are dropped (defense matching toMetricRows).
  v_count := replace_source_metrics(v_src, '[
    {"metric_key":"keep","value":5},
    {"metric_key":null,"value":9},
    {"value":7}
  ]'::jsonb);
  if v_count <> 1 then raise exception 'FAIL: null-key rows not dropped (got % inserted, expected 1)', v_count; end if;

  -- 4. EXECUTE is denied to anon/authenticated, granted to service_role.
  if has_function_privilege('anon', 'replace_source_metrics(uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'replace_source_metrics(uuid, jsonb)', 'EXECUTE') then
    raise exception 'FAIL: anon/authenticated can EXECUTE the swap function';
  end if;
  if not has_function_privilege('service_role', 'replace_source_metrics(uuid, jsonb)', 'EXECUTE') then
    raise exception 'FAIL: service_role cannot EXECUTE the swap function';
  end if;

  raise notice 'PASS: atomic swap replaces one set, rolls back on failure (no data loss), drops null keys, EXECUTE locked to service_role.';
end $$;

rollback;

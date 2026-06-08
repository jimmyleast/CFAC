-- Fix replace_source_metrics for Supabase/Postgres: coalesce is not in pg_catalog
-- as a schema-qualified callable function in this context. Keep the same
-- service-role-only contract and aggregate-only behavior.

create or replace function replace_source_metrics(p_source_id uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_source_id::text, 0));

  delete from public.metrics where source_id = p_source_id;

  insert into public.metrics (source_id, metric_key, label, value, unit, period_label, period_start, dimension)
  select p_source_id, r.metric_key, r.label, r.value, r.unit, r.period_label, r.period_start,
         coalesce(r.dimension, '{}'::jsonb)
  from pg_catalog.jsonb_to_recordset(p_rows) as r(
    metric_key text, label text, value numeric, unit text,
    period_label text, period_start date, dimension jsonb
  )
  where r.metric_key is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function replace_source_metrics(uuid, jsonb) from public, anon, authenticated;
grant execute on function replace_source_metrics(uuid, jsonb) to service_role;

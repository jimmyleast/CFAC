-- Align lineage metadata with the source-profile metric keys introduced for the
-- reviewed CFAC workbooks. Metadata only; no raw workbook rows or case data.

insert into metric_mappings (definition_key, source_metric_key, agg, status, note) values
  ('clients_served', 'clients_served', 'latest', 'active', 'Impact workbook canonical Children Served key. Refine to advocacy+residential+external-MH when PHI-safe program data lands.'),
  ('residential_client_served', 'residential_children', 'latest', 'active', 'Residential - children'),
  ('residential_client_served', 'residential_women', 'latest', 'active', 'Residential - women')
on conflict (definition_key, source_metric_key) do update set
  agg = excluded.agg,
  status = excluded.status,
  note = excluded.note;

update metric_mappings
  set status = 'draft',
      note = coalesce(note, '') || ' [superseded by clients_served source_profile key]'
  where definition_key = 'clients_served'
    and source_metric_key = 'children_served'
    and status = 'active';

update metric_mappings
  set status = 'draft',
      note = coalesce(note, '') || ' [superseded by residential_children source_profile key]'
  where definition_key = 'residential_client_served'
    and source_metric_key = 'res_children'
    and status = 'active';

update metric_mappings
  set status = 'draft',
      note = coalesce(note, '') || ' [superseded by residential_women source_profile key]'
  where definition_key = 'residential_client_served'
    and source_metric_key = 'res_women'
    and status = 'active';

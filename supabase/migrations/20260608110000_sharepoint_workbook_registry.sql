-- Connected workbook registry for the non-PHI Microsoft SharePoint Excel wedge.
-- Stores only Graph identifiers and profile/source bindings, not workbook rows.

create table if not exists connected_workbooks (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'microsoft_sharepoint' check (provider in ('microsoft_sharepoint')),
  source_id uuid not null references data_sources(id) on delete cascade,
  source_profile_key text not null references source_profiles(key) on delete restrict,
  display_name text not null,
  drive_id text not null,
  item_id text not null,
  worksheet_name text,
  range_address text,
  table_name text,
  enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connected_workbooks_range_or_table check (
    (table_name is not null and length(trim(table_name)) > 0)
    or
    (worksheet_name is not null and length(trim(worksheet_name)) > 0 and range_address is not null and length(trim(range_address)) > 0)
  )
);

create index if not exists idx_connected_workbooks_provider on connected_workbooks(provider);
create index if not exists idx_connected_workbooks_source_id on connected_workbooks(source_id);
create index if not exists idx_connected_workbooks_enabled on connected_workbooks(enabled);

drop trigger if exists connected_workbooks_updated_at on connected_workbooks;
create trigger connected_workbooks_updated_at before update on connected_workbooks
  for each row execute function set_updated_at();

alter table connected_workbooks enable row level security;
revoke all on connected_workbooks from anon, authenticated;

-- Source profiles define the import contract for CFAC's known workbooks.
-- They are metadata only: no operational rows, no names, no case narratives.

create table if not exists source_profiles (
  key text primary key,
  name text not null,
  mode text not null check (mode in ('aggregate_rows', 'aggregate_from_sensitive_rows', 'design_only')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_profile_fields (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null references source_profiles(key) on delete cascade,
  canonical text not null,
  aliases text[] not null default '{}',
  value_type text not null check (value_type in ('text', 'number', 'date', 'currency', 'boolean')),
  required boolean not null default false,
  classification text not null check (classification in ('aggregate', 'staff_pii', 'client_phi', 'client_adjacent', 'operational_sensitive')),
  created_at timestamptz not null default now(),
  unique(profile_key, canonical)
);

alter table data_sources
  add column if not exists source_profile_key text references source_profiles(key) on delete set null;

create index if not exists idx_data_sources_source_profile_key on data_sources(source_profile_key);
create index if not exists idx_source_profile_fields_profile_key on source_profile_fields(profile_key);

drop trigger if exists source_profiles_updated_at on source_profiles;
create trigger source_profiles_updated_at before update on source_profiles
  for each row execute function set_updated_at();

alter table source_profiles enable row level security;
alter table source_profile_fields enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='source_profiles' and policyname='auth read source_profiles') then
    create policy "auth read source_profiles" on source_profiles for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='source_profile_fields' and policyname='auth read source_profile_fields') then
    create policy "auth read source_profile_fields" on source_profile_fields for select to authenticated using (true);
  end if;
end $$;

insert into source_profiles (key, name, mode, description) values
  ('impact_history', 'Impact Through the Years', 'aggregate_rows', 'Annual aggregate impact workbook. Safe to import as metric rows.'),
  ('maintenance_request_2026', 'Maintenance Request Form 2026', 'aggregate_from_sensitive_rows', 'Maintenance log. Names, emails, locations, and descriptions are excluded from stored raw rows.'),
  ('fleet_management_2026', 'Fleet Management 2026', 'aggregate_from_sensitive_rows', 'Vehicle-use log. Driver names, emails, locations, and narrative fields are excluded from stored raw rows.')
on conflict (key) do update set
  name = excluded.name,
  mode = excluded.mode,
  description = excluded.description,
  updated_at = now();

insert into source_profile_fields (profile_key, canonical, aliases, value_type, required, classification) values
  ('impact_history', 'year', array['Year'], 'number', true, 'aggregate'),
  ('impact_history', 'reach', array['Reach'], 'number', false, 'aggregate'),
  ('impact_history', 'clients_served', array['Children Served','Clients Served'], 'number', false, 'aggregate'),
  ('impact_history', 'forensic_interviews', array['Forensic Interviews'], 'number', false, 'aggregate'),
  ('impact_history', 'medical', array['Medical'], 'number', false, 'aggregate'),
  ('impact_history', 'mental_health', array['Mental Health'], 'number', false, 'aggregate'),
  ('impact_history', 'education', array['Education'], 'number', false, 'aggregate'),
  ('impact_history', 'tours', array['Tours'], 'number', false, 'aggregate'),
  ('impact_history', 'community_events', array['Community Events'], 'number', false, 'aggregate'),
  ('impact_history', 'volunteers', array['Volunteers'], 'number', false, 'aggregate'),
  ('impact_history', 'residential_women', array['Res Women'], 'number', false, 'aggregate'),
  ('impact_history', 'residential_children', array['Res Children'], 'number', false, 'aggregate'),
  ('maintenance_request_2026', 'date', array['Date','Start time'], 'date', true, 'aggregate'),
  ('maintenance_request_2026', 'email', array['Email'], 'text', false, 'staff_pii'),
  ('maintenance_request_2026', 'name', array['Name','Staff Name'], 'text', false, 'staff_pii'),
  ('maintenance_request_2026', 'description', array['Description of Maintenance Request with Detail','Notes'], 'text', false, 'operational_sensitive'),
  ('maintenance_request_2026', 'request_type', array['Request Type'], 'text', false, 'aggregate'),
  ('maintenance_request_2026', 'priority', array['Priority'], 'text', false, 'aggregate'),
  ('maintenance_request_2026', 'status', array['Status'], 'text', false, 'aggregate'),
  ('maintenance_request_2026', 'on_time', array['On Time?'], 'boolean', false, 'aggregate'),
  ('maintenance_request_2026', 'actual_cost', array['Actual Cost'], 'currency', false, 'aggregate'),
  ('fleet_management_2026', 'date', array['Date of Vehicle Use','Start time'], 'date', true, 'aggregate'),
  ('fleet_management_2026', 'email', array['Email'], 'text', false, 'staff_pii'),
  ('fleet_management_2026', 'driver', array['Name of Driver','Name'], 'text', false, 'staff_pii'),
  ('fleet_management_2026', 'vehicle_type', array['Vehicle Type'], 'text', false, 'aggregate'),
  ('fleet_management_2026', 'purpose', array['Purpose of Travel'], 'text', false, 'client_adjacent'),
  ('fleet_management_2026', 'location', array['Location'], 'text', false, 'operational_sensitive'),
  ('fleet_management_2026', 'miles_driven', array['Miles Driven'], 'number', false, 'aggregate'),
  ('fleet_management_2026', 'half_tank', array['1/2 Tank of Fuel?'], 'boolean', false, 'aggregate'),
  ('fleet_management_2026', 'maintenance_issues', array['List and describe any maintenance issues'], 'text', false, 'operational_sensitive')
on conflict (profile_key, canonical) do update set
  aliases = excluded.aliases,
  value_type = excluded.value_type,
  required = excluded.required,
  classification = excluded.classification;

update data_sources set source_profile_key = 'impact_history' where slug = 'impact-history';
update data_sources set source_profile_key = 'maintenance_request_2026' where slug = 'maintenance-form';
update data_sources set source_profile_key = 'fleet_management_2026' where slug = 'fleet-form';

-- Legacy registry id from the pre-split Microsoft entry. The aggregate Excel wedge
-- is the only non-PHI Microsoft connector; mailbox intake remains a separate PHI gate.
do $$ begin
  if exists (select 1 from connections where provider = 'microsoft')
     and not exists (select 1 from connections where provider = 'microsoft_sharepoint') then
    update connections set provider = 'microsoft_sharepoint' where provider = 'microsoft';
  end if;
end $$;
update oauth_states set provider = 'microsoft_sharepoint' where provider = 'microsoft';

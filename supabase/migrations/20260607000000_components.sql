-- ============================================================
-- CFAC — drop UHP "squads"/"team_members" and rename teams -> components.
-- Components are a lightweight grouping for data sources (no membership,
-- no team management). Idempotent-ish; run once.
-- ============================================================

-- 1. Drop squad + team-membership tables (UHP concepts).
drop table if exists squad_members cascade;
drop table if exists squads cascade;
drop table if exists team_members cascade;

-- 2. Rename teams -> components (preserves the 16 seeded rows + data).
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='teams')
     and not exists (select 1 from information_schema.tables where table_schema='public' and table_name='components') then
    alter table teams rename to components;
  end if;
end $$;

-- 3. Rename data_sources.owner_team_id -> component_id.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='data_sources' and column_name='owner_team_id') then
    alter table data_sources rename column owner_team_id to component_id;
  end if;
end $$;

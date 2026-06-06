-- Add columns referenced by the app that post-date the initial apply.
alter table user_profiles add column if not exists phone text;
alter table user_profiles add column if not exists active boolean not null default true;

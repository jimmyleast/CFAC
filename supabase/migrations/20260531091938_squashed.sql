-- Squashed migration: Sun May 31 09:19:38 -03 2026
-- Generated from 68 individual migration files

-- ============================================================
-- SOURCE: 000_processes.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Core Process Tables
-- processes, conversations, and sop_snapshots all predate the
-- migration system and were created manually. They must exist
-- before all other migrations that reference them.
-- ============================================================

CREATE TABLE IF NOT EXISTS processes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT 'Untitled Process',
  owner       TEXT,
  division    TEXT,
  category    TEXT,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'in_progress', 'complete', 'archived')),
  phase       INTEGER NOT NULL DEFAULT 1,
  completion  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processes_created_by ON processes(created_by);
CREATE INDEX IF NOT EXISTS idx_processes_status     ON processes(status);
CREATE INDEX IF NOT EXISTS idx_processes_category   ON processes(category);

-- updated_at trigger (set_updated_at is created in 001_squads.sql;
-- use a local definition here guarded by OR REPLACE so it is safe
-- whether this runs standalone or as part of a full migration chain)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER processes_updated_at
  BEFORE UPDATE ON processes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE processes ENABLE ROW LEVEL SECURITY;

-- Base policy: users can see/manage rows they created.
-- The admin policy (which references user_profiles) is added in
-- 001_squads.sql after user_profiles is created.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'processes' AND policyname = 'Users can manage own processes'
  ) THEN
    CREATE POLICY "Users can manage own processes"
      ON processes FOR ALL
      USING (auth.uid() = created_by);
  END IF;
END $$;

-- ============================================================
-- Chat message history per process
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_process_id ON conversations(process_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- ============================================================
-- Structured SOP snapshot extracted from conversation (one per process)
-- ============================================================
CREATE TABLE IF NOT EXISTS sop_snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  version    BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (process_id)
);

CREATE INDEX IF NOT EXISTS idx_sop_snapshots_process_id ON sop_snapshots(process_id);

CREATE OR REPLACE TRIGGER sop_snapshots_updated_at
  BEFORE UPDATE ON sop_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- SOURCE: 001_squads.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Squad Infrastructure Migration
-- Run this in the Supabase SQL Editor (one time)
-- ============================================================

-- 1. User profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  display_name TEXT,
  is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Squads
CREATE TABLE IF NOT EXISTS squads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  area        TEXT,
  color       TEXT NOT NULL DEFAULT '#C9A84C',
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Squad members
CREATE TABLE IF NOT EXISTS squad_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  squad_id  UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(squad_id, user_id)
);

-- 4. Add squad_id to processes (nullable — unassigned processes visible to creator only)
ALTER TABLE processes ADD COLUMN IF NOT EXISTS squad_id UUID REFERENCES squads(id) ON DELETE SET NULL;

-- 5. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_squad_members_user_id  ON squad_members(user_id);
CREATE INDEX IF NOT EXISTS idx_squad_members_squad_id ON squad_members(squad_id);
CREATE INDEX IF NOT EXISTS idx_processes_squad_id     ON processes(squad_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email    ON user_profiles(email);

-- 6. updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER squads_updated_at
  BEFORE UPDATE ON squads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS: all access goes through our API (service role key),
-- so we disable RLS on these tables — the API enforces auth.
-- If you want Supabase RLS as a second layer, add policies here.
-- ============================================================
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE squads         DISABLE ROW LEVEL SECURITY;
ALTER TABLE squad_members  DISABLE ROW LEVEL SECURITY;

-- Admin policy on processes (user_profiles now exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'processes' AND policyname = 'Admins can manage all processes'
  ) THEN
    CREATE POLICY "Admins can manage all processes"
      ON processes FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM user_profiles
          WHERE id = auth.uid() AND is_admin = TRUE
        )
      );
  END IF;
END $$;

-- ============================================================
-- SOURCE: 002_observability.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — In-house Observability + Feature Flags
-- Run this in the Supabase SQL Editor after 001_squads.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS app_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  category TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  process_id UUID REFERENCES processes(id) ON DELETE SET NULL,
  route TEXT,
  status TEXT,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  allowed_user_ids UUID[] NOT NULL DEFAULT '{}',
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_events_created_at ON app_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_event_name ON app_events(event_name);
CREATE INDEX IF NOT EXISTS idx_app_events_category ON app_events(category);
CREATE INDEX IF NOT EXISTS idx_app_events_process_id ON app_events(process_id);
CREATE INDEX IF NOT EXISTS idx_app_events_user_id ON app_events(user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feature_flags_updated_at ON feature_flags;
CREATE TRIGGER feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO feature_flags (key, description, enabled, rollout_percent)
VALUES
  ('telemetry_events', 'Enable in-app telemetry event writes.', TRUE, 100),
  ('morgan_schema_guard', 'Enable strict coercion/guardrails for Morgan JSON payloads.', TRUE, 100)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SOURCE: 003_documents.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Process Documents + Storage
-- Run this in the Supabase SQL Editor after 001_squads.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS process_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  storage_path TEXT NOT NULL,
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_documents_process_id ON process_documents(process_id);
CREATE INDEX IF NOT EXISTS idx_process_documents_uploaded_by ON process_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_process_documents_created_at ON process_documents(created_at DESC);

ALTER TABLE process_documents DISABLE ROW LEVEL SECURITY;

-- Supabase Storage bucket for process documents (private, 50MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'process-docs',
  'process-docs',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SOURCE: 004_discovery.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Discovery Sessions Schema
-- Run this in the Supabase SQL Editor after 003_documents.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.discovery_sessions (
  id uuid primary key default uuid_generate_v4(),
  name text not null default 'Discovery Session',
  status text default 'active' check (status in ('active', 'paused', 'complete')),
  created_by uuid references auth.users(id) on delete cascade,
  started_at timestamptz default now(),
  ended_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.discovery_transcripts (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references public.discovery_sessions(id) on delete cascade,
  speaker text default 'Room',
  content text not null,
  timestamp_seconds integer default 0,
  extracted_data jsonb default '{}',
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.discovery_outputs (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid references public.discovery_sessions(id) on delete cascade,
  output_type text not null check (output_type in (
    'gap_analysis','action_plan','squad_structure',
    'systems_inventory','student_journey','saas_needs',
    'executive_summary','process_list'
  )),
  data jsonb not null default '{}',
  version integer default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

ALTER TABLE public.discovery_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_outputs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_sessions' AND policyname = 'Users can view own sessions') THEN
    CREATE POLICY "Users can view own sessions" ON public.discovery_sessions
      FOR SELECT USING (auth.uid() = created_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_sessions' AND policyname = 'Users can create sessions') THEN
    CREATE POLICY "Users can create sessions" ON public.discovery_sessions
      FOR INSERT WITH CHECK (auth.uid() = created_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_sessions' AND policyname = 'Users can update own sessions') THEN
    CREATE POLICY "Users can update own sessions" ON public.discovery_sessions
      FOR UPDATE USING (auth.uid() = created_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_sessions' AND policyname = 'Users can delete own sessions') THEN
    CREATE POLICY "Users can delete own sessions" ON public.discovery_sessions
      FOR DELETE USING (auth.uid() = created_by);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_transcripts' AND policyname = 'Users can view own transcripts') THEN
    CREATE POLICY "Users can view own transcripts" ON public.discovery_transcripts
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_transcripts' AND policyname = 'Users can insert own transcripts') THEN
    CREATE POLICY "Users can insert own transcripts" ON public.discovery_transcripts
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_transcripts' AND policyname = 'Users can update own transcripts') THEN
    CREATE POLICY "Users can update own transcripts" ON public.discovery_transcripts
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_transcripts' AND policyname = 'Users can delete own transcripts') THEN
    CREATE POLICY "Users can delete own transcripts" ON public.discovery_transcripts
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_outputs' AND policyname = 'Users can view own outputs') THEN
    CREATE POLICY "Users can view own outputs" ON public.discovery_outputs
      FOR SELECT USING (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_outputs' AND policyname = 'Users can insert own outputs') THEN
    CREATE POLICY "Users can insert own outputs" ON public.discovery_outputs
      FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_outputs' AND policyname = 'Users can update own outputs') THEN
    CREATE POLICY "Users can update own outputs" ON public.discovery_outputs
      FOR UPDATE USING (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_outputs' AND policyname = 'Users can delete own outputs') THEN
    CREATE POLICY "Users can delete own outputs" ON public.discovery_outputs
      FOR DELETE USING (EXISTS (SELECT 1 FROM public.discovery_sessions WHERE id = session_id AND created_by = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_sessions' AND policyname = 'Service role full access sessions') THEN
    CREATE POLICY "Service role full access sessions" ON public.discovery_sessions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_transcripts' AND policyname = 'Service role full access transcripts') THEN
    CREATE POLICY "Service role full access transcripts" ON public.discovery_transcripts
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovery_outputs' AND policyname = 'Service role full access outputs') THEN
    CREATE POLICY "Service role full access outputs" ON public.discovery_outputs
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_discovery_sessions_created_by ON public.discovery_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_discovery_sessions_status ON public.discovery_sessions(status);
CREATE INDEX IF NOT EXISTS idx_discovery_transcripts_session_id ON public.discovery_transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_discovery_outputs_session_id ON public.discovery_outputs(session_id);
CREATE INDEX IF NOT EXISTS idx_discovery_outputs_type ON public.discovery_outputs(output_type);

-- ============================================================
-- SOURCE: 005_requests.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Request Ticketing + RICE Prioritization
-- Run this in the active Supabase SQL editor for the UHP Ops Agent project
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.uhp_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- Submission
  submitted_by text not null,
  submitted_via text default 'web',

  -- Raw input
  raw_input text not null,

  -- AI extracted structure
  title text,
  description text,
  category text,
  affected_roles text[],
  current_pain text,
  desired_outcome text,

  -- RICE inputs
  reach integer default 0,
  impact decimal default 1,
  confidence integer default 80,
  effort decimal default 1,

  -- RICE score (calculated)
  rice_score decimal generated always as (
    case
      when effort > 0 then (reach * impact * confidence::decimal / 100) / effort
      else 0
    end
  ) stored,

  -- Status
  status text default 'new',
  priority_rank integer,
  notes text,
  linked_sop_id text
);

create index if not exists uhp_requests_rice_idx on public.uhp_requests (rice_score desc);
create index if not exists uhp_requests_status_idx on public.uhp_requests (status);

-- ============================================================
-- SOURCE: 006_builder_columns.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Builder feedback loop columns
-- Adds operative-builder tracking to uhp_requests
-- ============================================================

alter table public.uhp_requests
  add column if not exists builder_job_id text,
  add column if not exists builder_status text default null,
  add column if not exists builder_result jsonb default null;

create index if not exists uhp_requests_builder_job_idx
  on public.uhp_requests (builder_job_id)
  where builder_job_id is not null;

-- ============================================================
-- SOURCE: 007_user_roles.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — User role profiles for role-based UX
-- ============================================================

create table if not exists public.uhp_user_roles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff',  -- student | staff | admin | developer
  display_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists uhp_user_roles_email_idx on public.uhp_user_roles (email);
create index if not exists uhp_user_roles_role_idx on public.uhp_user_roles (role);

-- ============================================================
-- SOURCE: 008_super_app.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Super App tables
-- Team directory, notifications, attendance, leads
-- ============================================================

-- Team directory
CREATE TABLE IF NOT EXISTS uhp_team_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  slack_user_id TEXT,
  categories TEXT[] DEFAULT '{}',
  priority_threshold TEXT DEFAULT 'high',
  notify_via TEXT[] DEFAULT ARRAY['slack','email'],
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO uhp_team_directory (name, role, email, categories, priority_threshold, notify_via)
VALUES
  ('Tim Simmons', 'COO', 'tim@uhp.com',
   ARRAY['process','sop','staffing','governance','leadership'],
   'high', ARRAY['slack','email','sms']),
  ('Jimmy Easter', 'SVP Technology', 'jimmyeaster@contentforgeai.io',
   ARRAY['tool','system','tech','developer','integration'],
   'all', ARRAY['slack','email','sms']),
  ('Ben', 'Campus Operations', 'ben@uhp.com',
   ARRAY['equipment','facility','inventory','student_support','schedule','safety'],
   'high', ARRAY['slack','email']),
  ('Brian', 'Culinary', 'brian@uhp.com',
   ARRAY['meal','food','culinary','dining'],
   'high', ARRAY['slack','email']),
  ('Matt Hesse', 'CEO', 'matt@uhp.com',
   ARRAY['staffing','governance','capital','strategic'],
   'critical', ARRAY['email','sms'])
ON CONFLICT DO NOTHING;

-- Assignment fields on uhp_requests
ALTER TABLE uhp_requests
  ADD COLUMN IF NOT EXISTS assigned_to UUID,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- Notification log
CREATE TABLE IF NOT EXISTS uhp_notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID,
  recipient_email TEXT,
  recipient_phone TEXT,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

-- Clock in/out
CREATE TABLE IF NOT EXISTS uhp_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_name TEXT,
  location TEXT,
  clock_type TEXT NOT NULL CHECK (clock_type IN ('in','out')),
  method TEXT DEFAULT 'app',
  clocked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Visitor leads
CREATE TABLE IF NOT EXISTS uhp_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  phone TEXT,
  program_interest TEXT,
  gi_bill BOOLEAN,
  source TEXT DEFAULT 'morgan',
  notes TEXT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SOURCE: 009_discovery_bridge.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Discovery → Downstream Bridge
-- Adds traceability columns so processes and requests
-- created from discovery analysis link back to the session.
-- Safe: all columns are nullable with IF NOT EXISTS guards.
-- ============================================================

-- Link processes back to the discovery session that created them
ALTER TABLE processes
  ADD COLUMN IF NOT EXISTS discovery_session_id UUID REFERENCES public.discovery_sessions(id) ON DELETE SET NULL;

-- Link requests back to the discovery session that created them
ALTER TABLE uhp_requests
  ADD COLUMN IF NOT EXISTS discovery_session_id UUID REFERENCES public.discovery_sessions(id) ON DELETE SET NULL;

-- Index for fast lookups ("what did this session create?")
CREATE INDEX IF NOT EXISTS idx_processes_discovery_session
  ON processes(discovery_session_id) WHERE discovery_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_requests_discovery_session
  ON uhp_requests(discovery_session_id) WHERE discovery_session_id IS NOT NULL;

-- ============================================================
-- SOURCE: 010_discovery_documents.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Discovery Documents + Storage
-- Stores files (PDFs, PPTs, screenshots, etc.) uploaded
-- during discovery sessions for Claude analysis context.
-- ============================================================

CREATE TABLE IF NOT EXISTS discovery_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.discovery_sessions(id) ON DELETE CASCADE,
  uploaded_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name       TEXT NOT NULL,
  file_size       INTEGER,
  mime_type       TEXT,
  storage_path    TEXT NOT NULL,
  ai_summary      TEXT,
  extracted_text  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_docs_session ON discovery_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_discovery_docs_uploaded_by ON discovery_documents(uploaded_by);

ALTER TABLE discovery_documents DISABLE ROW LEVEL SECURITY;

-- Supabase Storage bucket for discovery documents (private, 50MB limit)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'discovery-docs',
  'discovery-docs',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SOURCE: 011_students.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Student Roster
-- Master record of every student through every program track.
-- Drives roster, cohort management, VA seat-hour compliance,
-- Walmart cohort tracking, and Morgan awareness.
-- ============================================================

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  preferred_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  headshot_url TEXT,

  -- Military background
  branch TEXT,
  rank TEXT,
  service_start DATE,
  service_end DATE,
  mos_rate TEXT,
  discharge_status TEXT,

  -- VA / GI Bill
  gi_bill_eligible BOOLEAN DEFAULT FALSE,
  gi_bill_chapter TEXT,

  -- Program / cohort
  program_track TEXT CHECK (program_track IN (
    'HVAC','ELECTRICAL','PLUMBING','CARPENTRY','WELDING',
    'CPT','IHC','CNC','PATRIOT_PATHWAY','LEADERSHIP','CORPORATE'
  )),
  cohort_name TEXT,
  cohort_start_date DATE,
  cohort_end_date DATE,

  -- Walmart partnership
  walmart_cohort BOOLEAN DEFAULT FALSE,
  walmart_manager_name TEXT,
  walmart_manager_email TEXT,

  -- Enrollment lifecycle
  enrollment_status TEXT CHECK (enrollment_status IN (
    'prospect','applied','enrolled','active','graduated','withdrawn'
  )) DEFAULT 'prospect',

  -- Campus / housing
  badge_id TEXT UNIQUE,
  room_assignment TEXT,

  -- VA seat-hour compliance
  required_seat_hours INTEGER DEFAULT 0,
  completed_seat_hours INTEGER DEFAULT 0,

  -- Coaching
  assigned_coach_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_enrollment_status ON students(enrollment_status);
CREATE INDEX IF NOT EXISTS idx_students_program_track ON students(program_track);
CREATE INDEX IF NOT EXISTS idx_students_cohort_name ON students(cohort_name);
CREATE INDEX IF NOT EXISTS idx_students_walmart ON students(walmart_cohort) WHERE walmart_cohort = TRUE;
CREATE INDEX IF NOT EXISTS idx_students_assigned_coach ON students(assigned_coach_id);
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trg_students_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_updated_at ON students;
CREATE TRIGGER students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW
  EXECUTE FUNCTION trg_students_set_updated_at();

-- Auth is enforced in the API layer via checkIsAdmin() and getRequestUser().
-- Matches the existing discovery_documents pattern in this codebase.
ALTER TABLE students DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Storage: student-headshots bucket (public read, 5MB limit)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-headshots',
  'student-headshots',
  TRUE,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SOURCE: 012_squad_leads.sql
-- ============================================================
-- ============================================================
-- Seed two operational squads and assign squad leads
-- ============================================================

-- 1. Upsert squads
INSERT INTO squads (name, description, area, color)
VALUES
  ('Tech', 'Technology, systems, platform engineering, and SOP automation', 'Systems / Pipeline / SOP', '#1AAFA0'),
  ('Graduate & On Campus Living', 'Graduate programs, on-campus housing, student services, and compliance', 'Education / Campus / Governance', '#C9A84C')
ON CONFLICT DO NOTHING;

-- 2. Assign squad leads via email lookup
-- Tech leads: Jimmy Easter (jimmy@uhp.com), Joey Szczepaniak (joey@uhp.com)
INSERT INTO squad_members (squad_id, user_id, role)
SELECT s.id, u.id, 'lead'
FROM squads s, auth.users u
WHERE s.name = 'Tech'
  AND lower(u.email) IN ('jimmy@uhp.com', 'joey@uhp.com')
ON CONFLICT (squad_id, user_id) DO UPDATE SET role = 'lead';

-- Graduate & On Campus Living leads: David Hamrick (david@uhp.com), Misti Cassels (misti@uhp.com)
INSERT INTO squad_members (squad_id, user_id, role)
SELECT s.id, u.id, 'lead'
FROM squads s, auth.users u
WHERE s.name = 'Graduate & On Campus Living'
  AND lower(u.email) IN ('davidhamrick@uhp.com', 'misti@uhp.com')
ON CONFLICT (squad_id, user_id) DO UPDATE SET role = 'lead';

-- Process mapping lead: Jessica (jrsalmon@uark.edu) — sees all squads
INSERT INTO squad_members (squad_id, user_id, role)
SELECT s.id, u.id, 'lead'
FROM squads s, auth.users u
WHERE lower(u.email) = 'jrsalmon@uark.edu'
ON CONFLICT (squad_id, user_id) DO UPDATE SET role = 'lead';

-- 3. Re-tag existing unassigned processes to the new squads based on category
UPDATE processes
SET squad_id = (SELECT id FROM squads WHERE name = 'Tech')
WHERE squad_id IS NULL
  AND category IS NOT NULL
  AND (
    lower(category) LIKE '%tech%'
    OR lower(category) LIKE '%system%'
    OR lower(category) LIKE '%software%'
    OR lower(category) LIKE '%platform%'
    OR lower(category) LIKE '%pipeline%'
    OR lower(category) LIKE '%sop%'
    OR lower(category) LIKE '%infrastructure%'
    OR lower(category) LIKE '%automation%'
    OR lower(category) LIKE '%integration%'
    OR lower(category) LIKE '%engineering%'
  );

UPDATE processes
SET squad_id = (SELECT id FROM squads WHERE name = 'Graduate & On Campus Living')
WHERE squad_id IS NULL
  AND category IS NOT NULL
  AND (
    lower(category) LIKE '%campus%'
    OR lower(category) LIKE '%housing%'
    OR lower(category) LIKE '%graduate%'
    OR lower(category) LIKE '%student%'
    OR lower(category) LIKE '%education%'
    OR lower(category) LIKE '%enrollment%'
    OR lower(category) LIKE '%admissions%'
    OR lower(category) LIKE '%academic%'
    OR lower(category) LIKE '%compliance%'
    OR lower(category) LIKE '%governance%'
    OR lower(category) LIKE '%training%'
    OR lower(category) LIKE '%leadership%'
    OR lower(category) LIKE '%facilities%'
    OR lower(category) LIKE '%residential%'
  );

-- ============================================================
-- SOURCE: 013_process_systems.sql
-- ============================================================
-- ============================================================
-- Normalized systems table — single source of truth for all
-- systems across discovery, processes, and squads
-- ============================================================

CREATE TABLE IF NOT EXISTS process_systems (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'other',
  status              TEXT NOT NULL DEFAULT 'not_started', -- not_started | evaluating | in_progress | live | deferred
  description         TEXT,
  owner               TEXT,
  recommendation      TEXT,
  estimated_cost      TEXT,
  priority            TEXT DEFAULT 'medium',
  -- SaaS decision context (from discovery saasNeeds)
  top_option          TEXT,
  decision_deadline   TEXT,
  next_step           TEXT,
  risk_if_wrong       TEXT,
  must_have_for_pilot BOOLEAN DEFAULT FALSE,
  complexity          TEXT,
  -- Relationships
  process_id          UUID REFERENCES processes(id) ON DELETE CASCADE,
  squad_id            UUID REFERENCES squads(id) ON DELETE SET NULL,
  discovery_session_id UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS process_systems_process_idx ON process_systems (process_id);
CREATE INDEX IF NOT EXISTS process_systems_squad_idx ON process_systems (squad_id);
CREATE INDEX IF NOT EXISTS process_systems_status_idx ON process_systems (status);

-- Add columns that may not exist if table was created by a previous version
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS top_option          TEXT;
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS decision_deadline   TEXT;
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS next_step           TEXT;
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS risk_if_wrong       TEXT;
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS must_have_for_pilot BOOLEAN DEFAULT FALSE;
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS complexity          TEXT;
ALTER TABLE process_systems ADD COLUMN IF NOT EXISTS owner               TEXT;

-- Migrate old status values to new lifecycle statuses
UPDATE process_systems SET status = 'not_started' WHERE status IN ('needed', 'gap');
UPDATE process_systems SET status = 'evaluating'  WHERE status = 'evaluating';
UPDATE process_systems SET status = 'in_progress' WHERE status = 'planned';
UPDATE process_systems SET status = 'live'        WHERE status IN ('active', 'deployed');
ALTER TABLE process_systems ALTER COLUMN status SET DEFAULT 'not_started';

-- Helper: match a category string to a squad via keywords
-- (same logic as the app-side TAB_CATEGORY_MAP)
CREATE OR REPLACE FUNCTION match_squad_id(cat TEXT) RETURNS UUID AS $$
DECLARE
  tech_id UUID;
  grad_id UUID;
  lower_cat TEXT := lower(COALESCE(cat, ''));
BEGIN
  SELECT id INTO tech_id FROM squads WHERE name = 'Tech' LIMIT 1;
  SELECT id INTO grad_id FROM squads WHERE name = 'Graduate & On Campus Living' LIMIT 1;

  IF lower_cat ~ '(tech|system|software|platform|pipeline|sop|infrastructure|automation|integration|engineering|devops)' THEN
    RETURN tech_id;
  END IF;
  IF lower_cat ~ '(campus|housing|residential|graduate|student|education|enrollment|admissions|academic|compliance|governance|training|leadership|facilities|scheduling)' THEN
    RETURN grad_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Backfill: extract systems from existing sop_snapshots
INSERT INTO process_systems (name, type, process_id, squad_id, status, description)
SELECT
  sys->>'name',
  COALESCE(NULLIF(sys->>'type', ''), 'other'),
  ss.process_id,
  COALESCE(p.squad_id, match_squad_id(p.category)),
  'not_started',
  COALESCE(sys->>'description', '')
FROM sop_snapshots ss
JOIN processes p ON p.id = ss.process_id
CROSS JOIN LATERAL jsonb_array_elements(ss.data->'systems') AS sys
WHERE ss.data->'systems' IS NOT NULL
  AND jsonb_array_length(ss.data->'systems') > 0
  AND sys->>'name' IS NOT NULL
  AND trim(sys->>'name') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM process_systems ps
    WHERE ps.process_id = ss.process_id
      AND ps.name = sys->>'name'
  );

-- Backfill: systems from discovery_outputs systemsInventory
INSERT INTO process_systems (name, type, status, description, recommendation, estimated_cost, priority, discovery_session_id, squad_id)
SELECT
  sys->>'name',
  COALESCE(NULLIF(sys->>'category', ''), 'other'),
  CASE
    WHEN lower(sys->>'status') IN ('active', 'deployed', 'in_use', 'live') THEN 'live'
    WHEN lower(sys->>'status') IN ('planned') THEN 'in_progress'
    WHEN lower(sys->>'status') IN ('evaluating') THEN 'evaluating'
    ELSE 'not_started'
  END,
  COALESCE(sys->>'notes', ''),
  COALESCE(sys->>'recommendation', ''),
  COALESCE(sys->>'estimatedCost', ''),
  COALESCE(NULLIF(sys->>'priority', ''), 'medium'),
  do_out.session_id,
  match_squad_id(sys->>'category')
FROM discovery_outputs do_out
CROSS JOIN LATERAL jsonb_array_elements(do_out.data) AS sys
WHERE do_out.output_type = 'systems_inventory'
  AND jsonb_typeof(do_out.data) = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM process_systems ps
    WHERE ps.discovery_session_id = do_out.session_id
      AND ps.name = sys->>'name'
  );

-- Backfill: merge saasNeeds decision context into matching systems
-- Match by system name (saasNeeds.system = process_systems.name)
UPDATE process_systems ps
SET
  top_option          = COALESCE(sn->>'topOption', ps.top_option),
  decision_deadline   = COALESCE(sn->>'decisionDeadline', ps.decision_deadline),
  next_step           = COALESCE(sn->>'nextStep', ps.next_step),
  risk_if_wrong       = COALESCE(sn->>'riskIfWrong', ps.risk_if_wrong),
  must_have_for_pilot = COALESCE((sn->>'mustHaveForPilot')::boolean, ps.must_have_for_pilot),
  complexity          = COALESCE(sn->>'complexity', ps.complexity),
  recommendation      = COALESCE(sn->>'recommendation', ps.recommendation),
  estimated_cost      = COALESCE(sn->>'estimatedCost', ps.estimated_cost),
  owner               = COALESCE(sn->>'owner', ps.owner),
  updated_at          = NOW()
FROM discovery_outputs do_out
CROSS JOIN LATERAL jsonb_array_elements(do_out.data) AS sn
WHERE do_out.output_type = 'saas_needs'
  AND jsonb_typeof(do_out.data) = 'array'
  AND lower(sn->>'system') = lower(ps.name)
  AND (ps.discovery_session_id = do_out.session_id OR ps.discovery_session_id IS NULL);

-- Also insert any saasNeeds systems that don't yet exist in process_systems
INSERT INTO process_systems (name, type, status, description, recommendation, estimated_cost, priority,
  top_option, decision_deadline, next_step, risk_if_wrong, must_have_for_pilot, complexity, owner,
  discovery_session_id, squad_id)
SELECT
  sn->>'system',
  'software',
  CASE WHEN (sn->>'recommendation') = 'defer' THEN 'deferred' ELSE 'not_started' END,
  COALESCE(sn->>'rationale', ''),
  sn->>'recommendation',
  COALESCE(sn->>'estimatedCost', ''),
  CASE WHEN (sn->>'mustHaveForPilot')::boolean THEN 'high' ELSE 'medium' END,
  sn->>'topOption',
  sn->>'decisionDeadline',
  sn->>'nextStep',
  sn->>'riskIfWrong',
  COALESCE((sn->>'mustHaveForPilot')::boolean, false),
  sn->>'complexity',
  sn->>'owner',
  do_out.session_id,
  match_squad_id(sn->>'system')
FROM discovery_outputs do_out
CROSS JOIN LATERAL jsonb_array_elements(do_out.data) AS sn
WHERE do_out.output_type = 'saas_needs'
  AND jsonb_typeof(do_out.data) = 'array'
  AND sn->>'system' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM process_systems ps
    WHERE lower(ps.name) = lower(sn->>'system')
  );

-- ============================================================
-- SOURCE: 014_teams.sql
-- ============================================================
-- ============================================================
-- TEAM + USER MANAGEMENT SCHEMA
-- Teams = org chart (who sees what, notification routing)
-- Squads = process ownership (existing, unchanged)
-- ============================================================

-- 1. Extend user_profiles with phone, title, avatar
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone      TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS title      TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS active     BOOLEAN DEFAULT TRUE;

-- 2. Teams table
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  lead_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  programs    TEXT[] DEFAULT '{}',
  color       TEXT DEFAULT '#374151',
  icon        TEXT,
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Team membership
CREATE TABLE IF NOT EXISTS team_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id   UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member', 'viewer')),
  added_by  UUID REFERENCES user_profiles(id),
  added_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- 4. Notification rules per team per event type
CREATE TABLE IF NOT EXISTS notification_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'all')),
  threshold  TEXT,
  active     BOOLEAN DEFAULT TRUE,
  UNIQUE(team_id, event_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_rules_team ON notification_rules(team_id);

-- 5. Add default_team_id to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS default_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- 6. RLS disabled — API enforces auth via service role
ALTER TABLE teams DISABLE ROW LEVEL SECURITY;
ALTER TABLE team_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- ============================================================

-- Operations: work orders, room arrivals, VIP
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created', 'email', 'P1_ONLY' FROM teams WHERE slug='ops'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created', 'sms', 'P1_ONLY' FROM teams WHERE slug='ops'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'guest_arrival', 'email', 'ALL' FROM teams WHERE slug='ops'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'vip_visit_created', 'sms', 'VVIP_ONLY' FROM teams WHERE slug='ops'
ON CONFLICT DO NOTHING;

-- Health: student flags, attendance
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'student_week2_flagged', 'email', 'ALL' FROM teams WHERE slug='health'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'student_week2_flagged', 'sms', 'ALL' FROM teams WHERE slug='health'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'attendance_below_threshold', 'email', 'ALL' FROM teams WHERE slug='health'
ON CONFLICT DO NOTHING;

-- Culinary: allergen, headcount
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'allergen_alert', 'sms', 'ALL' FROM teams WHERE slug='culinary'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'daily_headcount', 'email', 'ALL' FROM teams WHERE slug='culinary'
ON CONFLICT DO NOTHING;

-- Admissions: applications, cohort fill
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'new_application', 'email', 'ALL' FROM teams WHERE slug='admissions'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'cohort_fill_alert', 'email', 'UNDER_80_PCT' FROM teams WHERE slug='admissions'
ON CONFLICT DO NOTHING;

-- Executive: P1 everything, digest, VA compliance
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'p1_alert', 'sms', 'ALL' FROM teams WHERE slug='executive'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'p1_alert', 'email', 'ALL' FROM teams WHERE slug='executive'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'daily_digest', 'email', 'ALL' FROM teams WHERE slug='executive'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'va_compliance_risk', 'email', 'ALL' FROM teams WHERE slug='executive'
ON CONFLICT DO NOTHING;

-- Technology: system health, deploy failures
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'system_health_alert', 'sms', 'ALL' FROM teams WHERE slug='technology'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'system_health_alert', 'email', 'ALL' FROM teams WHERE slug='technology'
ON CONFLICT DO NOTHING;

-- ============================================================
-- SOURCE: 015_admissions.sql
-- ============================================================
-- ============================================================
-- ADMISSIONS PIPELINE — HubSpot bridge tables
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS prospects (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_contact_id  TEXT UNIQUE,
  name                TEXT,
  email               TEXT,
  phone               TEXT,
  program             TEXT,
  cohort_preference   DATE,
  gi_bill_type        TEXT,
  eligibility_status  TEXT,
  stage               TEXT DEFAULT 'prospect',
  military_branch     TEXT,
  documents_received  TEXT[] DEFAULT '{}',
  notes               TEXT,
  last_synced         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cohorts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program     TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE,
  capacity    INT DEFAULT 20,
  status      TEXT DEFAULT 'upcoming',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prospect_id         UUID REFERENCES prospects(id),
  hubspot_deal_id     TEXT UNIQUE,
  stage               TEXT,
  program             TEXT,
  cohort_id           UUID REFERENCES cohorts(id),
  documents_received  TEXT[] DEFAULT '{}',
  enrolled_at         TIMESTAMPTZ,
  withdrawn_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type       TEXT,
  records_pulled  INT DEFAULT 0,
  records_updated INT DEFAULT 0,
  errors          INT DEFAULT 0,
  error_details   TEXT,
  completed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(stage);
CREATE INDEX IF NOT EXISTS idx_prospects_program ON prospects(program);
CREATE INDEX IF NOT EXISTS idx_prospects_hubspot ON prospects(hubspot_contact_id);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage);
CREATE INDEX IF NOT EXISTS idx_applications_hubspot ON applications(hubspot_deal_id);
CREATE INDEX IF NOT EXISTS idx_cohorts_program ON cohorts(program);

-- RLS — API uses service role so these are a safety net
ALTER TABLE prospects DISABLE ROW LEVEL SECURITY;
ALTER TABLE applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE cohorts DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SOURCE: 016_work_orders.sql
-- ============================================================
-- ============================================================
-- WORK ORDERS + QR REPORTING
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS locations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  building    TEXT,
  area        TEXT,
  qr_code_id  TEXT UNIQUE DEFAULT uuid_generate_v4()::text,
  team_slug   TEXT DEFAULT 'ops',
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_orders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id       UUID REFERENCES locations(id),
  category          TEXT NOT NULL CHECK (category IN ('plumbing','electrical','hvac','facilities','equipment','safety','other')),
  priority          TEXT NOT NULL DEFAULT 'P3' CHECK (priority IN ('P1','P2','P3')),
  description       TEXT NOT NULL,
  photo_url         TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','archived')),
  assigned_to       UUID REFERENCES user_profiles(id),
  submitted_by_name TEXT,
  submitted_by_email TEXT,
  team_visibility   TEXT[] DEFAULT ARRAY['ops','executive','technology'],
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_updates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id     UUID REFERENCES work_orders(id) ON DELETE CASCADE,
  updated_by        UUID REFERENCES user_profiles(id),
  status_changed_to TEXT,
  note              TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority ON work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_work_orders_location ON work_orders(location_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned ON work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_work_order_updates_wo ON work_order_updates(work_order_id);
CREATE INDEX IF NOT EXISTS idx_locations_qr ON locations(qr_code_id);

-- RLS disabled — API uses service role, enforces team access in code
ALTER TABLE work_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_updates DISABLE ROW LEVEL SECURITY;

-- Seed campus locations
INSERT INTO locations (name, building, area, team_slug) VALUES
  ('Main Classroom A', 'Main Building', 'classrooms', 'ops'),
  ('Main Classroom B', 'Main Building', 'classrooms', 'ops'),
  ('Main Classroom C', 'Main Building', 'classrooms', 'ops'),
  ('HVAC Trade Bay', 'Trade Building', 'trade_bays', 'trades'),
  ('Electrical Trade Bay', 'Trade Building', 'trade_bays', 'trades'),
  ('Plumbing Trade Bay', 'Trade Building', 'trade_bays', 'trades'),
  ('Carpentry Trade Bay', 'Trade Building', 'trade_bays', 'trades'),
  ('Welding Trade Bay', 'Trade Building', 'trade_bays', 'trades'),
  ('Main Kitchen', 'Culinary Building', 'culinary', 'culinary'),
  ('Greenhouse', 'Culinary Building', 'culinary', 'culinary'),
  ('Coaching Lab', 'Culinary Building', 'culinary', 'culinary'),
  ('Fieldhouse', 'Fieldhouse', 'fitness', 'health'),
  ('Residential Building A', 'Residential', 'residential', 'ops'),
  ('Residential Building B', 'Residential', 'residential', 'ops'),
  ('Admin Offices', 'Main Building', 'admin', 'ops'),
  ('Conference Room Large', 'Main Building', 'meeting_rooms', 'ops'),
  ('Conference Room Medium', 'Main Building', 'meeting_rooms', 'ops'),
  ('Front Entrance', 'Main Building', 'entrance', 'ops'),
  ('Parking Lot', 'Exterior', 'exterior', 'ops'),
  ('Outdoor Training Area', 'Exterior', 'exterior', 'ops')
ON CONFLICT DO NOTHING;

-- ============================================================
-- SOURCE: 017_scheduling.sql
-- ============================================================
-- ============================================================
-- STAFF SCHEDULING + CLOCK-IN
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS shifts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id          UUID REFERENCES user_profiles(id),
  team_id           UUID REFERENCES teams(id),
  role              TEXT,
  program           TEXT,
  location_id       UUID REFERENCES locations(id),
  location_name     TEXT,
  start_time        TIMESTAMPTZ NOT NULL,
  end_time          TIMESTAMPTZ NOT NULL,
  status            TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','completed')),
  recurring         BOOLEAN DEFAULT FALSE,
  recurring_pattern JSONB,
  notes             TEXT,
  created_by        UUID REFERENCES user_profiles(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clock_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id    UUID REFERENCES user_profiles(id) NOT NULL,
  shift_id    UUID REFERENCES shifts(id),
  event_type  TEXT NOT NULL CHECK (event_type IN ('clock_in','clock_out','late')),
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  note        TEXT
);

CREATE TABLE IF NOT EXISTS schedule_conflicts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conflict_type   TEXT NOT NULL,
  shift_ids       UUID[],
  description     TEXT,
  detected_at     TIMESTAMPTZ DEFAULT NOW(),
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_by     UUID REFERENCES user_profiles(id),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shifts_staff ON shifts(staff_id);
CREATE INDEX IF NOT EXISTS idx_shifts_team ON shifts(team_id);
CREATE INDEX IF NOT EXISTS idx_shifts_start ON shifts(start_time);
CREATE INDEX IF NOT EXISTS idx_shifts_program ON shifts(program);
CREATE INDEX IF NOT EXISTS idx_clock_events_staff ON clock_events(staff_id);
CREATE INDEX IF NOT EXISTS idx_clock_events_shift ON clock_events(shift_id);

-- RLS disabled — API uses service role, enforces team access in code
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE clock_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_conflicts DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SOURCE: 018_notifications.sql
-- ============================================================
-- ============================================================
-- NOTIFICATION CENTER
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES user_profiles(id),
  team_id     UUID REFERENCES teams(id),
  type        TEXT,
  title       TEXT NOT NULL,
  body        TEXT,
  read        BOOLEAN DEFAULT FALSE,
  action_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);

ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SOURCE: 019_fix_jimmy_name.sql
-- ============================================================
-- Fix Jimmy's display name
UPDATE user_profiles
SET display_name = 'Jimmy Easter'
WHERE lower(email) = 'jimmyeaster@contentforgeai.io';

-- ============================================================
-- SOURCE: 020_sis.sql
-- ============================================================
-- ============================================================
-- STUDENT INFORMATION SYSTEM (SIS)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS sis_students (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  military_branch text,
  military_rank text,
  mos text,
  ets_date date,
  gi_bill_type text CHECK (gi_bill_type IN ('Chapter 33','Chapter 31','Chapter 35','Chapter 30','None','Unknown')),
  gi_bill_cert_number text,
  scholarship_type text,
  hubspot_contact_id text,
  photo_url text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sis_enrollments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES sis_students(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES cohorts(id),
  program text NOT NULL CHECK (program IN ('CPT','IHC','CNC','Trades','Patriot','Leadership','Corporate')),
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','active','completed','withdrawn','deferred')),
  start_date date,
  end_date date,
  room_assignment text,
  bunk_assignment text,
  gi_bill_cert_sent_at timestamptz,
  completion_date date,
  withdrawal_date date,
  withdrawal_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sis_attendance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  enrollment_id uuid NOT NULL REFERENCES sis_enrollments(id) ON DELETE CASCADE,
  session_id uuid,
  session_name text,
  session_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  recorded_by uuid REFERENCES user_profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sis_milestones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  enrollment_id uuid NOT NULL REFERENCES sis_enrollments(id) ON DELETE CASCADE,
  milestone_type text NOT NULL,
  milestone_name text NOT NULL,
  program text NOT NULL,
  display_order int DEFAULT 0,
  required bool DEFAULT true,
  passed bool DEFAULT false,
  score numeric,
  max_score numeric,
  signed_off_by uuid REFERENCES user_profiles(id),
  signed_off_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sis_coaching_hours (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  enrollment_id uuid NOT NULL REFERENCES sis_enrollments(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  hours numeric NOT NULL,
  session_type text,
  supervisor_id uuid REFERENCES user_profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sis_milestone_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  program text NOT NULL,
  milestone_type text NOT NULL,
  milestone_name text NOT NULL,
  display_order int,
  required bool DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_sis_students_email ON sis_students(email);
CREATE INDEX IF NOT EXISTS idx_sis_students_hubspot ON sis_students(hubspot_contact_id);
CREATE INDEX IF NOT EXISTS idx_sis_enrollments_student ON sis_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_sis_enrollments_program ON sis_enrollments(program);
CREATE INDEX IF NOT EXISTS idx_sis_enrollments_status ON sis_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_sis_attendance_enrollment ON sis_attendance(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_sis_milestones_enrollment ON sis_milestones(enrollment_id);

-- RLS disabled — API uses service role, enforces team access in code
ALTER TABLE sis_students DISABLE ROW LEVEL SECURITY;
ALTER TABLE sis_enrollments DISABLE ROW LEVEL SECURITY;
ALTER TABLE sis_attendance DISABLE ROW LEVEL SECURITY;
ALTER TABLE sis_milestones DISABLE ROW LEVEL SECURITY;
ALTER TABLE sis_coaching_hours DISABLE ROW LEVEL SECURITY;
ALTER TABLE sis_milestone_templates DISABLE ROW LEVEL SECURITY;

-- Seed milestone templates
INSERT INTO sis_milestone_templates (program, milestone_type, milestone_name, display_order) VALUES
('CPT','module','ISSA Module 1: Anatomy & Physiology',1),
('CPT','module','ISSA Module 2: Nutrition',2),
('CPT','module','ISSA Module 3: Exercise Science',3),
('CPT','module','ISSA Module 4: Program Design',4),
('CPT','module','ISSA Module 5: Special Populations',5),
('CPT','module','ISSA Module 6: Business',6),
('CPT','assessment','Fitness Assessment',7),
('CPT','assessment','Client Consultation',8),
('CPT','practicum','Practical Exam',9),
('IHC','module','IHC Module 1: Health Coaching Foundations',1),
('IHC','module','IHC Module 2: Behavior Change',2),
('IHC','module','IHC Module 3: Nutrition Coaching',3),
('IHC','module','IHC Module 4: Stress & Sleep',4),
('IHC','module','IHC Module 5: Movement & Recovery',5),
('IHC','coaching_hours','Coaching Hours (50hr requirement)',6),
('IHC','practicum','Supervised Practicum',7),
('IHC','assessment','NBHWC Board Eligibility Check',8),
('CNC','culinary','Culinary Technique 1: Knife Skills',1),
('CNC','culinary','Culinary Technique 2: Cooking Methods',2),
('CNC','culinary','Culinary Technique 3: Recipe Development',3),
('CNC','culinary','Culinary Technique 4: Nutrition Labels',4),
('CNC','culinary','Culinary Technique 5: Meal Planning',5),
('CNC','culinary','Culinary Technique 6: Food Safety',6),
('CNC','nutrition','Nutrition Coaching 1: Macronutrients',7),
('CNC','nutrition','Nutrition Coaching 2: Client Assessment',8),
('Trades','hvac','HVAC Competency 1: Safety & Tools',1),
('Trades','hvac','HVAC Competency 2: Refrigeration Basics',2),
('Trades','hvac','HVAC Competency 3: Electrical Systems',3),
('Trades','hvac','HVAC Competency 4: Installation',4),
('Trades','hvac','HVAC Competency 5: Troubleshooting',5),
('Trades','electrical','Electrical Competency 1: Safety & Code',6),
('Trades','electrical','Electrical Competency 2: Wiring',7),
('Trades','electrical','Electrical Competency 3: Panel Work',8),
('Trades','electrical','Electrical Competency 4: Troubleshooting',9),
('Trades','plumbing','Plumbing Competency 1: Pipe Systems',10),
('Trades','plumbing','Plumbing Competency 2: Fixtures',11),
('Trades','plumbing','Plumbing Competency 3: Troubleshooting',12),
('Trades','carpentry','Carpentry Competency 1: Framing',13),
('Trades','carpentry','Carpentry Competency 2: Finishing',14),
('Trades','welding','Welding Competency 1: Safety & Setup',15),
('Trades','welding','Welding Competency 2: MIG/TIG',16),
('Patriot','module','Transition Module 1: Identity',1),
('Patriot','module','Transition Module 2: Purpose Discovery',2),
('Patriot','module','Transition Module 3: Career Mapping',3),
('Patriot','assessment','Strengths Assessment',4),
('Patriot','assessment','Civilian Career Plan',5)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SOURCE: 021_import.sql
-- ============================================================
-- ============================================================
-- IMPORT SYSTEM — Google Sheets + HubSpot data bridge
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS import_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_type text NOT NULL CHECK (import_type IN ('google_sheets','hubspot_headshots','hubspot_contacts','webhook')),
  source_id text,
  records_found int DEFAULT 0,
  records_imported int DEFAULT 0,
  records_skipped int DEFAULT 0,
  records_failed int DEFAULT 0,
  errors jsonb DEFAULT '[]',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS cohort_sheets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES cohorts(id),
  sheet_id text NOT NULL,
  sheet_name text,
  program text,
  cohort_date date,
  last_synced timestamptz,
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_logs_type ON import_logs(import_type);
CREATE INDEX IF NOT EXISTS idx_cohort_sheets_sheet ON cohort_sheets(sheet_id);

ALTER TABLE import_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_sheets DISABLE ROW LEVEL SECURITY;

-- Add dietary and arrival fields to sis_students if not present
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS dietary_flags TEXT;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS health_disclosures TEXT;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS arrival_details TEXT;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS intake_token TEXT UNIQUE;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMPTZ;

-- ============================================================
-- SOURCE: 022_campus_names.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Real UHP campus building names
-- Replaces generic placeholders with the names staff actually use.
-- ============================================================

UPDATE locations SET name = 'Main Building (PLC)' WHERE name = 'Main Building' AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Main Building (PLC)');
UPDATE locations SET name = 'The Dome' WHERE name ILIKE '%conference room%' AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'The Dome');
UPDATE locations SET name = 'Field House' WHERE (name ILIKE '%fieldhouse%' OR name ILIKE '%field house%') AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Field House');
UPDATE locations SET name = 'Residential A (Cabins)' WHERE name ILIKE 'residential a%' AND name NOT ILIKE '%cabins%' AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Residential A (Cabins)');
UPDATE locations SET name = 'Residential B (Cabins)' WHERE name ILIKE 'residential b%' AND name NOT ILIKE '%cabins%' AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Residential B (Cabins)');
UPDATE locations SET name = 'Trade Building' WHERE (name ILIKE '%trades%' OR name ILIKE 'trade%') AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Trade Building');
UPDATE locations SET name = 'Culinary Building' WHERE name ILIKE '%culinary%' AND name NOT ILIKE '%building%' AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Culinary Building');
UPDATE locations SET name = 'Outdoor Training Area' WHERE name ILIKE '%outdoor%' AND NOT EXISTS (SELECT 1 FROM locations WHERE name = 'Outdoor Training Area');

-- ============================================================
-- SOURCE: 023_pre_arrival_sms.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Pre-Arrival SMS + Push Subscriptions
-- Session 7A: Twilio drip from enrollment to arrival day.
-- Note: references sis_enrollments / sis_students / cohorts.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pre_arrival_sms_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  enrollment_id uuid REFERENCES public.sis_enrollments(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.sis_students(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN (
    'enrollment_confirmed',
    'countdown_7_days',
    'countdown_3_days',
    'day_before',
    'flight_day',
    'arrived_on_campus'
  )),
  message_text text NOT NULL,
  sent_at timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  twilio_sid text,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prearrival_sms_cohort ON public.pre_arrival_sms_events(cohort_id);
CREATE INDEX IF NOT EXISTS idx_prearrival_sms_enrollment ON public.pre_arrival_sms_events(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_prearrival_sms_status ON public.pre_arrival_sms_events(status);
CREATE INDEX IF NOT EXISTS idx_prearrival_sms_trigger ON public.pre_arrival_sms_events(trigger_type);

ALTER TABLE public.pre_arrival_sms_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pre_arrival_sms_events' AND policyname = 'Service role full access prearrival') THEN
    CREATE POLICY "Service role full access prearrival" ON public.pre_arrival_sms_events
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- Push subscriptions for student PWA
-- ============================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id) ON DELETE CASCADE,
  subscription_json text NOT NULL,
  endpoint text,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(student_id)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_student ON public.push_subscriptions(student_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_subscriptions' AND policyname = 'Service role full access pushsubs') THEN
    CREATE POLICY "Service role full access pushsubs" ON public.push_subscriptions
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- SOURCE: 024_student_intake.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Student Intake + Bunk Assignments
-- Session 7: Pre-arrival intake form + cohort brief
-- References sis_students / sis_enrollments / cohorts / user_profiles.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.student_intake (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.sis_students(id),
  enrollment_id uuid REFERENCES public.sis_enrollments(id),

  student_name text NOT NULL,
  email text NOT NULL,
  phone text,

  photo_url text,

  military_background jsonb DEFAULT '{}'::jsonb,
  emergency_contact jsonb DEFAULT '{}'::jsonb,
  dietary_flags jsonb DEFAULT '{}'::jsonb,
  gear_sizes jsonb DEFAULT '{}'::jsonb,

  sleep_preference text CHECK (sleep_preference IN ('early_riser','night_owl','no_preference')),
  snoring text CHECK (snoring IN ('yes','no','sometimes')),
  roommate_preference text,

  health_disclosures text,

  arrival_details jsonb DEFAULT '{}'::jsonb,
  readiness_flags jsonb DEFAULT '{}'::jsonb,

  intake_link_token text UNIQUE,
  token_expires_at timestamptz,
  completed_at timestamptz,
  last_updated_at timestamptz DEFAULT now(),

  hubspot_deal_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_cohort ON public.student_intake(cohort_id);
CREATE INDEX IF NOT EXISTS idx_intake_email ON public.student_intake(email);
CREATE INDEX IF NOT EXISTS idx_intake_token ON public.student_intake(intake_link_token);
CREATE INDEX IF NOT EXISTS idx_intake_completed ON public.student_intake(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_hubspot ON public.student_intake(hubspot_deal_id);

ALTER TABLE public.student_intake ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'student_intake' AND policyname = 'Service role full access intake') THEN
    CREATE POLICY "Service role full access intake" ON public.student_intake
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- Bunk assignments (algorithm later; schema now)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bunk_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id),
  student_id uuid REFERENCES public.sis_students(id),
  intake_id uuid REFERENCES public.student_intake(id),
  bunk_label text,
  building text,
  roommate_student_id uuid REFERENCES public.sis_students(id),
  conflict_score int DEFAULT 0,
  override_by uuid REFERENCES public.user_profiles(id),
  override_at timestamptz,
  assigned_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bunk_cohort ON public.bunk_assignments(cohort_id);
CREATE INDEX IF NOT EXISTS idx_bunk_student ON public.bunk_assignments(student_id);

ALTER TABLE public.bunk_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bunk_assignments' AND policyname = 'Service role full access bunks') THEN
    CREATE POLICY "Service role full access bunks" ON public.bunk_assignments
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- Storage bucket: intake-photos (run once; idempotent)
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'intake-photos',
  'intake-photos',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Service role full access intake-photos') THEN
    CREATE POLICY "Service role full access intake-photos"
      ON storage.objects FOR ALL
      USING (bucket_id = 'intake-photos' AND auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- SOURCE: 025_full_scheduling.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Session 10: Full Campus Scheduling
-- program_sessions, facility_blocks, schedule_change_log
-- + extends locations with capacity/location_type
-- + seeds real UHP facilities
-- ============================================================

-- Extend locations for scheduling metadata
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS capacity int;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS location_type text;

-- Idempotent seed helper (locations.name isn't unique — use NOT EXISTS guard)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('PLC — Main Room', 'Operations Building (PLC)', 60, 'classroom'),
      ('PLC — Room A', 'Operations Building (PLC)', 20, 'classroom'),
      ('PLC — Room B', 'Operations Building (PLC)', 20, 'classroom'),
      ('The Dome', 'Field House', 120, 'large_space'),
      ('Field House — Main Floor', 'Field House', 80, 'training'),
      ('Field House — Upper Deck', 'Field House', 40, 'classroom'),
      ('Culinary Building — Kitchen', 'Culinary Building', 30, 'culinary'),
      ('Culinary Building — Classroom', 'Culinary Building', 40, 'classroom'),
      ('Electrical Laboratory', 'Trade Building', 20, 'lab'),
      ('Welding Laboratory', 'Trade Building', 16, 'lab'),
      ('HVAC/Mech Laboratory', 'Trade Building', 20, 'lab'),
      ('Plumbing Laboratory', 'Trade Building', 20, 'lab'),
      ('Carpentry Laboratory', 'Trade Building', 20, 'lab'),
      ('Outdoor Training Area', 'Campus Grounds', 100, 'outdoor'),
      ('Pond Boardwalk', 'Campus Grounds', 40, 'outdoor'),
      ('Social Terraces', 'Campus Grounds', 60, 'outdoor'),
      ('Residential A — Common Area', 'Residential A (Cabins)', 30, 'residential'),
      ('Residential B — Common Area', 'Residential B (Cabins)', 30, 'residential')
    ) AS t(name, building, capacity, location_type)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.name = r.name) THEN
      INSERT INTO public.locations (name, building, capacity, location_type, team_slug)
      VALUES (r.name, r.building, r.capacity, r.location_type, 'ops');
    ELSE
      UPDATE public.locations
        SET capacity = COALESCE(l.capacity, r.capacity),
            location_type = COALESCE(l.location_type, r.location_type)
      FROM public.locations l
      WHERE l.name = r.name AND public.locations.id = l.id;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- program_sessions: scheduled events per cohort/location
-- ============================================================

CREATE TABLE IF NOT EXISTS public.program_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  session_type text NOT NULL CHECK (session_type IN (
    'classroom','physical_training','lab','culinary','field_work',
    'orientation','assessment','graduation','arrival','departure',
    'free_time','meal','guest_speaker','field_trip','ceremony'
  )),
  location_id uuid REFERENCES public.locations(id),
  location_name text,
  instructor_ids uuid[],
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  day_number int,
  program_day_label text,
  capacity int,
  is_mandatory boolean DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.user_profiles(id),
  last_modified_by uuid REFERENCES public.user_profiles(id),
  last_modified_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  cancelled_at timestamptz,
  cancel_reason text
);

CREATE INDEX IF NOT EXISTS idx_sessions_cohort ON public.program_sessions(cohort_id);
CREATE INDEX IF NOT EXISTS idx_sessions_location ON public.program_sessions(location_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON public.program_sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON public.program_sessions(cohort_id, day_number);

ALTER TABLE public.program_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'program_sessions' AND policyname = 'Service role full program_sessions') THEN
    CREATE POLICY "Service role full program_sessions" ON public.program_sessions FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- facility_blocks: non-program facility reservations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.facility_blocks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id uuid REFERENCES public.locations(id),
  title text NOT NULL,
  block_type text CHECK (block_type IN ('maintenance','vip_visit','external_event','reserved','cleaning')),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  notes text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blocks_location ON public.facility_blocks(location_id);
CREATE INDEX IF NOT EXISTS idx_blocks_time ON public.facility_blocks(start_time, end_time);

ALTER TABLE public.facility_blocks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'facility_blocks' AND policyname = 'Service role full facility_blocks') THEN
    CREATE POLICY "Service role full facility_blocks" ON public.facility_blocks FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- schedule_change_log: audit trail
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schedule_change_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES public.program_sessions(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES public.user_profiles(id),
  change_type text CHECK (change_type IN (
    'created','location_changed','time_changed','cancelled','restored','instructor_changed','edited'
  )),
  old_value jsonb,
  new_value jsonb,
  notification_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_log_session ON public.schedule_change_log(session_id);

ALTER TABLE public.schedule_change_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schedule_change_log' AND policyname = 'Service role full schedule_change_log') THEN
    CREATE POLICY "Service role full schedule_change_log" ON public.schedule_change_log FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- SOURCE: 026_systems_crosswalk.sql
-- ============================================================
-- ============================================================
-- Session 10+ — reconcile the 8 discovery-session systems with
-- what's actually built in the platform.
-- Adds deployment_url + implementation_notes columns and upserts
-- a status line for each of the 8 systems from Jimmy's discovery.
-- ============================================================

ALTER TABLE public.process_systems ADD COLUMN IF NOT EXISTS deployment_url text;
ALTER TABLE public.process_systems ADD COLUMN IF NOT EXISTS implementation_notes text;
ALTER TABLE public.process_systems ADD COLUMN IF NOT EXISTS external_vendor text;

-- Upsert-by-name helper (name is not unique — use IF EXISTS guards)
DO $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- 1. Student Information System — LIVE
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%student info%') THEN
    UPDATE process_systems SET
      status = 'live',
      deployment_url = '/students',
      implementation_notes = 'Built in Session 5 (migration 020_sis). Tables: sis_students, sis_enrollments, sis_attendance, sis_milestones (44 templates), sis_coaching_hours. API: /api/sis/*. VA CSV export: /api/sis/export/va. Morgan SIS domain handles enroll / attendance / milestone sign-off / withdraw.',
      updated_at = v_now
    WHERE name ILIKE '%student info%';
  ELSE
    INSERT INTO process_systems (name, type, status, deployment_url, implementation_notes)
    VALUES ('Student Information System', 'internal', 'live', '/students',
      'Built in Session 5 (migration 020_sis). Tables: sis_students, sis_enrollments, sis_attendance, sis_milestones (44 templates), sis_coaching_hours. API: /api/sis/*. VA CSV export: /api/sis/export/va. Morgan SIS domain handles enroll / attendance / milestone sign-off / withdraw.');
  END IF;

  -- 2. Inventory Management — EXTERNAL (VaultIQAI)
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%inventory%') THEN
    UPDATE process_systems SET
      status = 'live',
      external_vendor = 'VaultIQAI',
      deployment_url = NULL,
      implementation_notes = 'EXTERNAL SaaS — VaultIQAI. Not building in-house. Covers supplies, equipment, restock tracking. Future option: pull stock levels into Morgan answers via VaultIQAI API.',
      updated_at = v_now
    WHERE name ILIKE '%inventory%';
  ELSE
    INSERT INTO process_systems (name, type, status, external_vendor, implementation_notes)
    VALUES ('Inventory Management System', 'external', 'live', 'VaultIQAI',
      'EXTERNAL SaaS — VaultIQAI. Not building in-house. Covers supplies, equipment, restock tracking.');
  END IF;

  -- 3. Scheduling Tool — LIVE
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%scheduling%') THEN
    UPDATE process_systems SET
      status = 'live',
      deployment_url = '/admin/scheduling/full',
      implementation_notes = 'Session 10 (migration 025). program_sessions + facility_blocks + schedule_change_log. Master grid at /admin/scheduling/full (rows=facilities, cols=30-min slots). Cohort builder at /admin/scheduling/cohort/[id] with 19-day CPT/IHC/CNC/Trades templates. Conflict detection + audit log + Morgan scheduling-full domain.',
      updated_at = v_now
    WHERE name ILIKE '%scheduling%';
  ELSE
    INSERT INTO process_systems (name, type, status, deployment_url, implementation_notes)
    VALUES ('Scheduling Tool', 'internal', 'live', '/admin/scheduling/full',
      'Session 10. program_sessions + facility_blocks + schedule_change_log. Master grid at /admin/scheduling/full with conflict detection + audit log + Morgan domain.');
  END IF;

  -- 4. SOP / Process Tracking — LIVE
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%sop%' OR name ILIKE '%process track%') THEN
    UPDATE process_systems SET
      status = 'live',
      deployment_url = '/processes',
      implementation_notes = 'Pre-existing. Routes: /processes, /process/[id], /discovery/[id]. Phase 1-6 lifecycle. Morgan critique + chat with process context (fixed in commit 4a6899d — Morgan now sees process name + steps, no longer asks to restart).',
      updated_at = v_now
    WHERE name ILIKE '%sop%' OR name ILIKE '%process track%';
  ELSE
    INSERT INTO process_systems (name, type, status, deployment_url, implementation_notes)
    VALUES ('SOP / Process Tracking', 'internal', 'live', '/processes',
      'Pre-existing. /processes + /process/[id] + /discovery/[id]. Phase 1-6 lifecycle, Morgan critique + chat with process context.');
  END IF;

  -- 5. Learning Management System — PARTIAL
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%learning management%' OR name ILIKE '%lms%') THEN
    UPDATE process_systems SET
      status = 'in_progress',
      deployment_url = '/students',
      implementation_notes = 'PARTIAL — milestone templates (sis_milestones, 44 seeded) provide pass/fail curriculum tracking. Missing: lesson content player, assessments/quizzes, media hosting, grade book. Skeleton exists; full LMS features still to build.',
      updated_at = v_now
    WHERE name ILIKE '%learning management%' OR name ILIKE '%lms%';
  ELSE
    INSERT INTO process_systems (name, type, status, deployment_url, implementation_notes)
    VALUES ('Learning Management System', 'internal', 'in_progress', '/students',
      'PARTIAL — milestone templates only. Missing lesson player, assessments, grade book.');
  END IF;

  -- 6. HR System — PARTIAL
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%hr system%' OR name ILIKE 'hr') THEN
    UPDATE process_systems SET
      status = 'in_progress',
      deployment_url = '/admin/teams',
      implementation_notes = 'PARTIAL — user_profiles + teams + team_members + notification_rules exist (9 teams seeded). Covers staff records, roles, team membership, routing. Missing: PTO / time off, offer letters, performance reviews, onboarding workflows. Teams schema is the foundation for those.',
      updated_at = v_now
    WHERE name ILIKE '%hr system%' OR name ILIKE 'hr';
  ELSE
    INSERT INTO process_systems (name, type, status, deployment_url, implementation_notes)
    VALUES ('HR System', 'internal', 'in_progress', '/admin/teams',
      'PARTIAL — teams + user_profiles + notification_rules only. Missing PTO, reviews, onboarding workflows.');
  END IF;

  -- 7. Ticketing / Maintenance — LIVE
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%ticket%' OR name ILIKE '%maintenance%') THEN
    UPDATE process_systems SET
      status = 'live',
      deployment_url = '/admin/work-orders',
      implementation_notes = 'Session 2. work_orders + work_order_updates tables. /admin/work-orders dashboard with QR reporting via /work-orders/submit/[qrCodeId]. 20 campus locations seeded. P1/P2/P3 priority + team routing. Morgan work-orders domain handles create + read. Missing: preventive maintenance schedules (reactive-only today).',
      updated_at = v_now
    WHERE name ILIKE '%ticket%' OR name ILIKE '%maintenance%';
  ELSE
    INSERT INTO process_systems (name, type, status, deployment_url, implementation_notes)
    VALUES ('Ticketing / Maintenance System', 'internal', 'live', '/admin/work-orders',
      'Session 2. work_orders + QR reporting + P1/P2/P3 priority + team routing.');
  END IF;

  -- 8. Student / Alumni Community Platform — DEFERRED
  IF EXISTS (SELECT 1 FROM process_systems WHERE name ILIKE '%community%' OR name ILIKE '%alumni%') THEN
    UPDATE process_systems SET
      status = 'deferred',
      implementation_notes = 'DEFERRED — out of scope until first cohort graduates. Related student-facing pieces that ARE built: intake form (/intake/[token]), pre-arrival SMS drip, push subscription API, QR work-order submission. Dedicated student PWA not yet built.',
      updated_at = v_now
    WHERE name ILIKE '%community%' OR name ILIKE '%alumni%';
  ELSE
    INSERT INTO process_systems (name, type, status, implementation_notes)
    VALUES ('Student / Alumni Community Platform', 'internal', 'deferred',
      'DEFERRED until first cohort graduates. Related student touchpoints built: intake form, SMS drip, push API, QR work-order submission.');
  END IF;
END $$;

-- ============================================================
-- SOURCE: 027_onboarding.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Session 11: Onboarding Tool
-- onboarding templates, per-student progress, documents,
-- arrival-day stations. Uses sis_students / sis_enrollments / cohorts.
-- NOTE: migration numbered 027; 026 was the systems crosswalk.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.onboarding_templates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  program text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_template_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id uuid REFERENCES public.onboarding_templates(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  item_type text NOT NULL CHECK (item_type IN ('document','action','acknowledgment','gear','info')),
  is_required boolean DEFAULT true,
  due_days_before int DEFAULT 7,
  sort_order int DEFAULT 0,
  phase text CHECK (phase IN ('pre_arrival','arrival_day','orientation','offboarding')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_items_template ON public.onboarding_template_items(template_id);

CREATE TABLE IF NOT EXISTS public.student_onboarding (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES public.sis_enrollments(id),
  cohort_id uuid REFERENCES public.cohorts(id),
  template_id uuid REFERENCES public.onboarding_templates(id),
  overall_status text DEFAULT 'not_started' CHECK (overall_status IN (
    'not_started','in_progress','ready','arrived','oriented','complete'
  )),
  completion_percentage int DEFAULT 0,
  ready_for_arrival boolean DEFAULT false,
  arrived_at timestamptz,
  oriented_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_student ON public.student_onboarding(student_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_cohort ON public.student_onboarding(cohort_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON public.student_onboarding(overall_status);

CREATE TABLE IF NOT EXISTS public.onboarding_item_completions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  onboarding_id uuid REFERENCES public.student_onboarding(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES public.onboarding_template_items(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending','completed','waived','overdue')),
  completed_at timestamptz,
  completed_by text,
  notes text,
  file_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_completions_onboarding ON public.onboarding_item_completions(onboarding_id);
CREATE INDEX IF NOT EXISTS idx_item_completions_status ON public.onboarding_item_completions(status);

CREATE TABLE IF NOT EXISTS public.onboarding_documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id),
  enrollment_id uuid REFERENCES public.sis_enrollments(id),
  document_type text NOT NULL CHECK (document_type IN (
    'dd214','coe','va_letter','photo_id','medical','waiver','other'
  )),
  file_url text NOT NULL,
  file_name text,
  verified boolean DEFAULT false,
  verified_by uuid REFERENCES public.user_profiles(id),
  verified_at timestamptz,
  uploaded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docs_student ON public.onboarding_documents(student_id);
CREATE INDEX IF NOT EXISTS idx_docs_enrollment ON public.onboarding_documents(enrollment_id);

CREATE TABLE IF NOT EXISTS public.orientation_stations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id),
  station_number int NOT NULL,
  title text NOT NULL,
  description text,
  location_name text,
  assigned_staff_id uuid REFERENCES public.user_profiles(id),
  estimated_minutes int DEFAULT 10,
  is_complete boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stations_cohort ON public.orientation_stations(cohort_id);

-- Per-student station completion (who went through which station)
CREATE TABLE IF NOT EXISTS public.orientation_station_completions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id uuid REFERENCES public.orientation_stations(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.sis_students(id),
  completed_at timestamptz DEFAULT now(),
  completed_by uuid REFERENCES public.user_profiles(id),
  UNIQUE(station_id, student_id)
);

-- Orientation content (sections with editable markdown)
CREATE TABLE IF NOT EXISTS public.orientation_content (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN (
    'welcome','philosophy','your_19_days','community_norms','daily_rhythm','who_to_ask'
  )),
  body text,
  published boolean DEFAULT false,
  updated_by uuid REFERENCES public.user_profiles(id),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(cohort_id, section)
);

-- RLS: service role full access
ALTER TABLE public.onboarding_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_item_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orientation_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orientation_station_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orientation_content ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'onboarding_templates','onboarding_template_items','student_onboarding',
    'onboarding_item_completions','onboarding_documents','orientation_stations',
    'orientation_station_completions','orientation_content'
  ]) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'Service role full '||t) THEN
      EXECUTE format('CREATE POLICY "Service role full %s" ON public.%I FOR ALL USING (auth.role() = ''service_role'')', t, t);
    END IF;
  END LOOP;
END $$;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('onboarding-documents', 'onboarding-documents', false, 20971520,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Service role full onboarding-documents') THEN
    CREATE POLICY "Service role full onboarding-documents"
      ON storage.objects FOR ALL
      USING (bucket_id = 'onboarding-documents' AND auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- Seed templates for each program
-- ============================================================

INSERT INTO public.onboarding_templates (program, name, description) VALUES
  ('CPT', 'CPT Pre-Arrival Checklist', 'Standard checklist for Certified Personal Trainer program'),
  ('IHC', 'IHC Pre-Arrival Checklist', 'Standard checklist for Integrative Health Coach program'),
  ('CNC', 'CNC Pre-Arrival Checklist', 'Standard checklist for Culinary Nutrition Coach program'),
  ('Trades', 'Trades Pre-Arrival Checklist', 'Standard checklist for Industrial Trades program'),
  ('Patriot Pathway', 'Patriot Pathway Pre-Arrival Checklist', 'Checklist for Patriot Pathway participants')
ON CONFLICT DO NOTHING;

-- Seed CPT items (other programs inherit the same item set)
DO $$
DECLARE template_rec RECORD;
BEGIN
  FOR template_rec IN SELECT id FROM public.onboarding_templates LOOP
    -- Pre-arrival items
    IF NOT EXISTS (SELECT 1 FROM public.onboarding_template_items WHERE template_id = template_rec.id AND phase = 'pre_arrival') THEN
      INSERT INTO public.onboarding_template_items (template_id, title, description, item_type, is_required, due_days_before, sort_order, phase)
      VALUES
        (template_rec.id, 'Upload DD-214', 'Your Certificate of Release or Discharge from Active Duty. Required for GI Bill verification.', 'document', true, 14, 1, 'pre_arrival'),
        (template_rec.id, 'Upload Certificate of Eligibility', 'Your VA Certificate of Eligibility for GI Bill benefits.', 'document', true, 14, 2, 'pre_arrival'),
        (template_rec.id, 'Book your travel', 'Book your flight or confirm your drive. Arrive at XNA or drive directly to campus. Staff will meet you at baggage claim or the entry gate.', 'action', true, 10, 3, 'pre_arrival'),
        (template_rec.id, 'Complete pre-arrival intake form', 'Fill out your pre-arrival intake — gear sizes, dietary needs, emergency contact, arrival details. You received a link via email.', 'action', true, 7, 4, 'pre_arrival'),
        (template_rec.id, 'Review community norms', 'Read and acknowledge the UHP community standards. This sets the tone for your 19 days.', 'acknowledgment', true, 5, 5, 'pre_arrival'),
        (template_rec.id, 'Pack your gear', 'Athletic clothing for PT. Casual clothing for class. Weather-appropriate layers. Toiletries. UHP apparel provided on arrival.', 'gear', true, 3, 6, 'pre_arrival'),
        (template_rec.id, 'Upload a recent photo', 'A clear headshot for your student profile. Already done if you completed your intake form.', 'document', false, 7, 7, 'pre_arrival'),
        (template_rec.id, 'Confirm arrival details', 'Reply to your admissions contact with your final flight number and arrival time, or confirm your driving ETA.', 'action', true, 3, 8, 'pre_arrival'),
        (template_rec.id, 'Review your Day 1 schedule', 'Your Day 1 schedule is now available. Know where to go when you arrive.', 'info', false, 1, 9, 'pre_arrival');
    END IF;

    -- Arrival day stations
    IF NOT EXISTS (SELECT 1 FROM public.onboarding_template_items WHERE template_id = template_rec.id AND phase = 'arrival_day') THEN
      INSERT INTO public.onboarding_template_items (template_id, title, description, item_type, is_required, due_days_before, sort_order, phase)
      VALUES
        (template_rec.id, 'Check in at the Field House', 'Station 1: Welcome check-in. Get your name badge and cohort packet.', 'action', true, 0, 1, 'arrival_day'),
        (template_rec.id, 'Bunk assignment + cabin walkthrough', 'Station 2: Get your bunk assignment and walk to your cabin with a GA.', 'action', true, 0, 2, 'arrival_day'),
        (template_rec.id, 'Apparel fitting at the Dome', 'Station 3: Try on your UHP apparel and confirm sizes. Replacements handled here.', 'action', true, 0, 3, 'arrival_day'),
        (template_rec.id, 'Medical check-in with health team', 'Station 4: Brief check-in with the health team. Voluntary disclosure of any medical needs.', 'action', false, 0, 4, 'arrival_day'),
        (template_rec.id, 'Campus orientation tour', 'Station 5: Side-by-side tour of campus — PLC, Dome, Field House, Culinary, Trade Building.', 'action', true, 0, 5, 'arrival_day'),
        (template_rec.id, 'Welcome session at the Dome', 'Station 6: Full cohort welcome — program overview, philosophy, what to expect.', 'action', true, 0, 6, 'arrival_day'),
        (template_rec.id, 'Welcome dinner', 'Station 7: First meal together. Culinary Building.', 'action', true, 0, 7, 'arrival_day');
    END IF;

    -- Offboarding items
    IF NOT EXISTS (SELECT 1 FROM public.onboarding_template_items WHERE template_id = template_rec.id AND phase = 'offboarding') THEN
      INSERT INTO public.onboarding_template_items (template_id, title, description, item_type, is_required, due_days_before, sort_order, phase)
      VALUES
        (template_rec.id, 'Return all loaned equipment', 'Return any equipment checked out during the program.', 'action', true, 0, 1, 'offboarding'),
        (template_rec.id, 'Clear your bunk', 'Strip your bunk, bag your bedding, leave the cabin clean for the next cohort.', 'action', true, 0, 2, 'offboarding'),
        (template_rec.id, 'Certification authorization letter', 'Your certification authorization letter is ready for download.', 'document', false, 0, 3, 'offboarding'),
        (template_rec.id, 'Alumni network access', 'Join the UHP alumni community. Your alumni account has been created.', 'info', false, 0, 4, 'offboarding'),
        (template_rec.id, '30-day check-in scheduled', 'Your 30-day post-program check-in has been scheduled.', 'info', false, 0, 5, 'offboarding'),
        (template_rec.id, 'Program feedback survey', 'Complete your program feedback survey.', 'action', true, 0, 6, 'offboarding');
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- SOURCE: 028_rooms.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Room & Board (Session 12)
-- Physical residential inventory, stays, maintenance, laundry, guests.
-- Sits on top of sis_students / sis_enrollments / cohorts / bunk_assignments.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.residential_buildings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  building_type text DEFAULT 'cabin',
  total_bunks int NOT NULL,
  total_cabins int NOT NULL,
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cabins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  building_id uuid REFERENCES public.residential_buildings(id),
  cabin_number text NOT NULL,
  capacity int NOT NULL DEFAULT 10,
  cabin_type text DEFAULT 'standard' CHECK (cabin_type IN ('standard', 'accessible', 'vip', 'staff')),
  notes text,
  active boolean DEFAULT true,
  hostfully_property_id text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(building_id, cabin_number)
);
CREATE INDEX IF NOT EXISTS idx_cabins_building ON public.cabins(building_id);

CREATE TABLE IF NOT EXISTS public.bunks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cabin_id uuid REFERENCES public.cabins(id),
  bunk_label text NOT NULL,
  bunk_position text CHECK (bunk_position IN ('top', 'bottom', 'single')),
  is_accessible boolean DEFAULT false,
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cabin_id, bunk_label)
);
CREATE INDEX IF NOT EXISTS idx_bunks_cabin ON public.bunks(cabin_id);

CREATE TABLE IF NOT EXISTS public.residential_stays (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id),
  enrollment_id uuid REFERENCES public.sis_enrollments(id),
  cohort_id uuid REFERENCES public.cohorts(id),
  bunk_id uuid REFERENCES public.bunks(id),
  cabin_id uuid REFERENCES public.cabins(id),
  building_id uuid REFERENCES public.residential_buildings(id),
  check_in_date date,
  check_out_date date,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  checked_in_by uuid REFERENCES public.user_profiles(id),
  checked_out_by uuid REFERENCES public.user_profiles(id),
  status text DEFAULT 'pending' CHECK (status IN ('pending','checked_in','checked_out','no_show','early_departure')),
  special_accommodations text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_student ON public.residential_stays(student_id);
CREATE INDEX IF NOT EXISTS idx_stays_cohort ON public.residential_stays(cohort_id);
CREATE INDEX IF NOT EXISTS idx_stays_bunk ON public.residential_stays(bunk_id);
CREATE INDEX IF NOT EXISTS idx_stays_status ON public.residential_stays(status);

CREATE TABLE IF NOT EXISTS public.cabin_maintenance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cabin_id uuid REFERENCES public.cabins(id),
  bunk_id uuid REFERENCES public.bunks(id),
  reported_by uuid REFERENCES public.user_profiles(id),
  reported_by_student_id uuid REFERENCES public.sis_students(id),
  issue_type text CHECK (issue_type IN ('bedding','plumbing','electrical','hvac','cleaning','laundry','furniture','pest','safety','other')),
  priority text DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  description text NOT NULL,
  photo_url text,
  status text DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','wont_fix')),
  work_order_id uuid REFERENCES public.work_orders(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.user_profiles(id),
  resolution_notes text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cabin_maintenance_cabin ON public.cabin_maintenance(cabin_id);
CREATE INDEX IF NOT EXISTS idx_cabin_maintenance_status ON public.cabin_maintenance(status);

CREATE TABLE IF NOT EXISTS public.laundry_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id),
  event_type text CHECK (event_type IN ('pickup','dropoff','in_progress','ready')),
  cabin_id uuid REFERENCES public.cabins(id),
  notes text,
  handled_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_laundry_cabin ON public.laundry_events(cabin_id);
CREATE INDEX IF NOT EXISTS idx_laundry_cohort ON public.laundry_events(cohort_id);

CREATE TABLE IF NOT EXISTS public.guest_stays (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  guest_name text NOT NULL,
  guest_email text,
  guest_type text CHECK (guest_type IN ('vip','corporate','staff','family','partner')),
  tier text DEFAULT 'standard' CHECK (tier IN ('standard','vip','vvip')),
  cabin_id uuid REFERENCES public.cabins(id),
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  special_requests text,
  hostfully_booking_id text,
  status text DEFAULT 'upcoming' CHECK (status IN ('upcoming','checked_in','checked_out','cancelled')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guest_stays_dates ON public.guest_stays(check_in_date, check_out_date);

-- RLS — service role only (auth enforced in API layer)
ALTER TABLE public.residential_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cabins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residential_stays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cabin_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laundry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_stays ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'residential_buildings' AND policyname = 'Service role full access rbuildings') THEN
    CREATE POLICY "Service role full access rbuildings" ON public.residential_buildings FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cabins' AND policyname = 'Service role full access cabins') THEN
    CREATE POLICY "Service role full access cabins" ON public.cabins FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bunks' AND policyname = 'Service role full access bunks_inv') THEN
    CREATE POLICY "Service role full access bunks_inv" ON public.bunks FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'residential_stays' AND policyname = 'Service role full access rstays') THEN
    CREATE POLICY "Service role full access rstays" ON public.residential_stays FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'cabin_maintenance' AND policyname = 'Service role full access cmaint') THEN
    CREATE POLICY "Service role full access cmaint" ON public.cabin_maintenance FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'laundry_events' AND policyname = 'Service role full access laundry') THEN
    CREATE POLICY "Service role full access laundry" ON public.laundry_events FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guest_stays' AND policyname = 'Service role full access guests') THEN
    CREATE POLICY "Service role full access guests" ON public.guest_stays FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================
-- Seed: Residential A + B, 8 cabins, 80 bunks total
-- ============================================================

INSERT INTO public.residential_buildings (name, building_type, total_bunks, total_cabins) VALUES
  ('Residential A (Cabins)', 'cabin', 40, 4),
  ('Residential B (Cabins)', 'cabin', 40, 4)
ON CONFLICT DO NOTHING;

WITH bldg_a AS (SELECT id FROM public.residential_buildings WHERE name = 'Residential A (Cabins)' LIMIT 1),
     bldg_b AS (SELECT id FROM public.residential_buildings WHERE name = 'Residential B (Cabins)' LIMIT 1)
INSERT INTO public.cabins (building_id, cabin_number, capacity)
SELECT bldg_a.id, 'Cabin ' || n, 10 FROM bldg_a, generate_series(1,4) AS n
UNION ALL
SELECT bldg_b.id, 'Cabin ' || n, 10 FROM bldg_b, generate_series(5,8) AS n
ON CONFLICT DO NOTHING;

-- 10 bunks per cabin, labels A-J, alternating bottom/top
INSERT INTO public.bunks (cabin_id, bunk_label, bunk_position)
SELECT
  c.id,
  chr(64 + s.n) AS bunk_label,
  CASE WHEN s.n % 2 = 1 THEN 'bottom' ELSE 'top' END
FROM public.cabins c
CROSS JOIN generate_series(1,10) AS s(n)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SOURCE: 029_week2_spaces_badges.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Week 2 Check-in + Space Reservation + Badge System (Session 13)
-- Uses sis_students / sis_enrollments / sis_attendance (SIS schema from 020).
-- ============================================================

-- Week 2 check-in responses
CREATE TABLE IF NOT EXISTS public.week2_checkins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id),
  enrollment_id uuid REFERENCES public.sis_enrollments(id),
  cohort_id uuid REFERENCES public.cohorts(id),
  check_in_date date NOT NULL DEFAULT CURRENT_DATE,
  day_number int,

  overall_score int CHECK (overall_score BETWEEN 1 AND 5),
  energy_score int CHECK (energy_score BETWEEN 1 AND 5),
  motivation_score int CHECK (motivation_score BETWEEN 1 AND 5),
  connection_score int CHECK (connection_score BETWEEN 1 AND 5),

  highlight text,
  challenge text,
  needs text,

  flagged boolean DEFAULT false,
  flag_reason text,
  flag_severity text CHECK (flag_severity IN ('low','medium','high','critical')),

  follow_up_required boolean DEFAULT false,
  followed_up_by uuid REFERENCES public.user_profiles(id),
  followed_up_at timestamptz,
  follow_up_notes text,

  submitted_via text DEFAULT 'student_app' CHECK (submitted_via IN ('student_app','staff_entry','morgan')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkin_student ON public.week2_checkins(student_id);
CREATE INDEX IF NOT EXISTS idx_checkin_cohort ON public.week2_checkins(cohort_id);
CREATE INDEX IF NOT EXISTS idx_checkin_flagged ON public.week2_checkins(flagged) WHERE flagged = true;
CREATE INDEX IF NOT EXISTS idx_checkin_date ON public.week2_checkins(check_in_date);

-- Space reservations
CREATE TABLE IF NOT EXISTS public.space_reservations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id uuid REFERENCES public.locations(id),
  reserved_by uuid REFERENCES public.user_profiles(id),
  reserved_for_student_id uuid REFERENCES public.sis_students(id),
  title text NOT NULL,
  reservation_type text CHECK (reservation_type IN (
    'coaching_session','group_session','disciplinary','study',
    'interview','meeting','personal','other'
  )),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  attendee_count int DEFAULT 1,
  notes text,
  status text DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_location ON public.space_reservations(location_id);
CREATE INDEX IF NOT EXISTS idx_reservations_time ON public.space_reservations(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON public.space_reservations(reserved_by);

-- Badge events
CREATE TABLE IF NOT EXISTS public.badge_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id),
  user_id uuid REFERENCES public.user_profiles(id),
  location_id uuid REFERENCES public.locations(id),
  event_type text CHECK (event_type IN ('entry','exit','denied','manual_override')),
  badge_id text,
  reader_id text,
  session_id uuid REFERENCES public.program_sessions(id),
  raw_event_data jsonb,
  source text DEFAULT 'badge_reader' CHECK (source IN ('badge_reader','qr_scan','manual','nfc')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_badge_student ON public.badge_events(student_id);
CREATE INDEX IF NOT EXISTS idx_badge_location ON public.badge_events(location_id);
CREATE INDEX IF NOT EXISTS idx_badge_time ON public.badge_events(created_at);
CREATE INDEX IF NOT EXISTS idx_badge_session ON public.badge_events(session_id);

-- Badge assignments
CREATE TABLE IF NOT EXISTS public.badge_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  badge_id text UNIQUE NOT NULL,
  student_id uuid REFERENCES public.sis_students(id),
  user_id uuid REFERENCES public.user_profiles(id),
  enrollment_id uuid REFERENCES public.sis_enrollments(id),
  issued_at timestamptz DEFAULT now(),
  returned_at timestamptz,
  is_active boolean DEFAULT true,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_badge_assignments_badge ON public.badge_assignments(badge_id);
CREATE INDEX IF NOT EXISTS idx_badge_assignments_student ON public.badge_assignments(student_id);

-- Badge readers
CREATE TABLE IF NOT EXISTS public.badge_readers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  reader_id text UNIQUE NOT NULL,
  location_id uuid REFERENCES public.locations(id),
  location_name text,
  reader_name text NOT NULL,
  reader_type text DEFAULT 'entry_exit' CHECK (reader_type IN ('entry_exit','entry_only','exit_only')),
  vendor text,
  is_online boolean DEFAULT false,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_badge_readers_location ON public.badge_readers(location_id);

-- RLS — service role only
ALTER TABLE public.week2_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_readers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'week2_checkins' AND policyname = 'Service role full access week2') THEN
    CREATE POLICY "Service role full access week2" ON public.week2_checkins FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'space_reservations' AND policyname = 'Service role full access sreserve') THEN
    CREATE POLICY "Service role full access sreserve" ON public.space_reservations FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'badge_events' AND policyname = 'Service role full access bevents') THEN
    CREATE POLICY "Service role full access bevents" ON public.badge_events FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'badge_assignments' AND policyname = 'Service role full access bassign') THEN
    CREATE POLICY "Service role full access bassign" ON public.badge_assignments FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'badge_readers' AND policyname = 'Service role full access breaders') THEN
    CREATE POLICY "Service role full access breaders" ON public.badge_readers FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Seed mock badge readers for classroom/lab/training/large_space/culinary locations
INSERT INTO public.badge_readers (reader_id, location_id, location_name, reader_name, vendor, is_online)
SELECT
  'READER_' || upper(regexp_replace(l.name, '[^A-Za-z0-9]+', '_', 'g')),
  l.id,
  l.name,
  l.name || ' — Entry',
  'mock',
  false
FROM public.locations l
WHERE l.location_type IN ('classroom','lab','training','large_space','culinary')
ON CONFLICT (reader_id) DO NOTHING;

-- ============================================================
-- SOURCE: 030_kitchen.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Kitchen & Meal System (Session 14)
-- Meal plans, meals, requests, inventory, shopping, headcount.
-- Uses sis_students / student_intake (dietary_flags) from prior sessions.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meal_plans (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id),
  week_number int NOT NULL,
  week_start_date date NOT NULL,
  created_by uuid REFERENCES public.user_profiles(id),
  approved_by uuid REFERENCES public.user_profiles(id),
  approved_at timestamptz,
  status text DEFAULT 'draft' CHECK (status IN ('draft','approved','published')),
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cohort_id, week_number)
);

CREATE TABLE IF NOT EXISTS public.meals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  meal_plan_id uuid REFERENCES public.meal_plans(id) ON DELETE CASCADE,
  cohort_id uuid REFERENCES public.cohorts(id),
  meal_date date NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  title text NOT NULL,
  description text,
  protein text,
  carbs text,
  fats text,
  calories_approx int,
  allergens text[] DEFAULT '{}',
  is_vegetarian boolean DEFAULT false,
  is_vegan boolean DEFAULT false,
  is_gluten_free boolean DEFAULT false,
  is_halal boolean DEFAULT false,
  is_kosher boolean DEFAULT false,
  prep_notes text,
  estimated_headcount int,
  extracted_ingredients jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meals_plan ON public.meals(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_meals_date ON public.meals(meal_date, meal_type);
CREATE INDEX IF NOT EXISTS idx_meals_cohort ON public.meals(cohort_id);

CREATE TABLE IF NOT EXISTS public.meal_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id),
  cohort_id uuid REFERENCES public.cohorts(id),
  meal_id uuid REFERENCES public.meals(id),
  request_type text CHECK (request_type IN ('substitution','extra_serving','dietary_accommodation','allergy_concern','other')),
  description text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','fulfilled')),
  handled_by uuid REFERENCES public.user_profiles(id),
  handled_at timestamptz,
  response_notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meal_requests_cohort ON public.meal_requests(cohort_id);
CREATE INDEX IF NOT EXISTS idx_meal_requests_status ON public.meal_requests(status);

CREATE TABLE IF NOT EXISTS public.kitchen_inventory (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_name text NOT NULL,
  category text CHECK (category IN ('protein','produce','dairy','grains','pantry','beverages','supplements','other')),
  unit text NOT NULL,
  current_quantity decimal(10,2) DEFAULT 0,
  reorder_threshold decimal(10,2),
  preferred_vendor text,
  notes text,
  last_updated_at timestamptz DEFAULT now(),
  last_updated_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_category ON public.kitchen_inventory(category);

CREATE TABLE IF NOT EXISTS public.shopping_lists (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id),
  meal_plan_id uuid REFERENCES public.meal_plans(id),
  generated_at timestamptz DEFAULT now(),
  generated_by uuid REFERENCES public.user_profiles(id),
  status text DEFAULT 'draft' CHECK (status IN ('draft','submitted','ordered','received')),
  notes text,
  items jsonb DEFAULT '[]'::jsonb,
  total_estimated_cost decimal(10,2),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_headcount (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id),
  meal_date date NOT NULL,
  meal_type text NOT NULL,
  expected_count int,
  actual_count int,
  dietary_breakdown jsonb,
  recorded_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(cohort_id, meal_date, meal_type)
);

CREATE TABLE IF NOT EXISTS public.bloom_inventory (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_name text NOT NULL,
  sku text,
  location text,
  current_stock int DEFAULT 0,
  reorder_threshold int DEFAULT 10,
  supplier_contact text DEFAULT 'Lindsey McGovern',
  last_restocked_at timestamptz,
  last_restocked_by uuid REFERENCES public.user_profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_headcount ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloom_inventory ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='meal_plans' AND policyname='svc meal_plans') THEN
    CREATE POLICY "svc meal_plans" ON public.meal_plans FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='meals' AND policyname='svc meals') THEN
    CREATE POLICY "svc meals" ON public.meals FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='meal_requests' AND policyname='svc meal_requests') THEN
    CREATE POLICY "svc meal_requests" ON public.meal_requests FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kitchen_inventory' AND policyname='svc kitchen_inv') THEN
    CREATE POLICY "svc kitchen_inv" ON public.kitchen_inventory FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='shopping_lists' AND policyname='svc shopping') THEN
    CREATE POLICY "svc shopping" ON public.shopping_lists FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_headcount' AND policyname='svc headcount') THEN
    CREATE POLICY "svc headcount" ON public.daily_headcount FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bloom_inventory' AND policyname='svc bloom') THEN
    CREATE POLICY "svc bloom" ON public.bloom_inventory FOR ALL USING (auth.role()='service_role');
  END IF;
END $$;

-- Seed Bloom products
INSERT INTO public.bloom_inventory (product_name, sku, location, current_stock, reorder_threshold) VALUES
  ('Bloom Greens & Superfoods', 'BLOOM-GS-001', 'Main Cooler — Field House', 24, 10),
  ('Bloom Collagen', 'BLOOM-COL-001', 'Main Cooler — Field House', 24, 10),
  ('Bloom Pre-Workout', 'BLOOM-PRE-001', 'Main Cooler — Field House', 24, 10),
  ('Bloom Protein', 'BLOOM-PRO-001', 'Main Cooler — Field House', 24, 10),
  ('Bloom Hydration', 'BLOOM-HYD-001', 'Main Cooler — PLC', 24, 10)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SOURCE: 031_graduation.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Graduation Experience Module (Session 15)
-- Graduation readiness, certificates, alumni, employer packets.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.graduation_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id),
  enrollment_id uuid REFERENCES public.sis_enrollments(id),
  cohort_id uuid REFERENCES public.cohorts(id),
  program text NOT NULL,
  milestones_complete boolean DEFAULT false,
  attendance_percentage decimal(5,2),
  attendance_meets_threshold boolean DEFAULT false,
  coaching_hours_complete boolean DEFAULT false,
  ready_to_graduate boolean DEFAULT false,
  readiness_checked_at timestamptz,
  readiness_override boolean DEFAULT false,
  readiness_override_by uuid REFERENCES public.user_profiles(id),
  readiness_override_notes text,
  ceremony_date date,
  ceremony_location text,
  livestream_url text,
  graduated_at timestamptz,
  graduation_status text DEFAULT 'pending' CHECK (graduation_status IN ('pending','ready','graduated','incomplete','withdrawn')),
  certificate_number text UNIQUE,
  certificate_url text,
  certificate_generated_at timestamptz,
  student_letter text,
  letter_submitted_at timestamptz,
  employer_name text,
  employer_contact_name text,
  employer_contact_email text,
  employer_packet_sent_at timestamptz,
  alumni_number text UNIQUE,
  alumni_record_created_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grad_student ON public.graduation_records(student_id);
CREATE INDEX IF NOT EXISTS idx_grad_cohort ON public.graduation_records(cohort_id);
CREATE INDEX IF NOT EXISTS idx_grad_status ON public.graduation_records(graduation_status);
CREATE INDEX IF NOT EXISTS idx_grad_ready ON public.graduation_records(ready_to_graduate) WHERE ready_to_graduate = true;

CREATE TABLE IF NOT EXISTS public.graduation_letters (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  graduation_record_id uuid REFERENCES public.graduation_records(id),
  student_id uuid REFERENCES public.sis_students(id),
  letter_type text CHECK (letter_type IN ('student_to_family','student_reflection','staff_to_student')),
  content text NOT NULL,
  submitted_at timestamptz DEFAULT now(),
  is_shared boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.graduation_employers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  graduation_record_id uuid REFERENCES public.graduation_records(id),
  employer_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  position_title text,
  start_date date,
  packet_sent_at timestamptz,
  packet_opened_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alumni (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id) UNIQUE,
  graduation_record_id uuid REFERENCES public.graduation_records(id),
  alumni_number text UNIQUE NOT NULL,
  program text NOT NULL,
  graduation_date date,
  certification_type text,
  certification_number text,
  current_employer text,
  current_job_title text,
  location_city text,
  location_state text,
  email text,
  phone text,
  linkedin_url text,
  follow_on_program text,
  is_mentor boolean DEFAULT false,
  regional_chapter text,
  last_checkin_at timestamptz,
  opt_out_communications boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alumni_program ON public.alumni(program);
CREATE INDEX IF NOT EXISTS idx_alumni_region ON public.alumni(location_state);

-- RLS
ALTER TABLE public.graduation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graduation_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.graduation_employers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alumni ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='graduation_records' AND policyname='svc grad_records') THEN
    CREATE POLICY "svc grad_records" ON public.graduation_records FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='graduation_letters' AND policyname='svc grad_letters') THEN
    CREATE POLICY "svc grad_letters" ON public.graduation_letters FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='graduation_employers' AND policyname='svc grad_employers') THEN
    CREATE POLICY "svc grad_employers" ON public.graduation_employers FOR ALL USING (auth.role()='service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alumni' AND policyname='svc alumni') THEN
    CREATE POLICY "svc alumni" ON public.alumni FOR ALL USING (auth.role()='service_role');
  END IF;
END $$;

-- ============================================================
-- SOURCE: 032_sync_log_status.sql
-- ============================================================
-- ============================================================
-- sync_log: add status + started_at so the UI can poll a specific
-- sync run by id instead of comparing client/server timestamps.
--
-- Root cause: the previous sync_log schema only had completed_at
-- (set via DEFAULT NOW() at insert time, at the *end* of a sync).
-- If the sync threw before reaching the insert, no row was ever
-- written and the UI's "has a new row landed?" polling spun forever.
-- ============================================================

ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed'
  CHECK (status IN ('running','completed','failed'));

ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- completed_at was NOT NULL via DEFAULT; allow NULL while a sync is running.
ALTER TABLE public.sync_log
  ALTER COLUMN completed_at DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_sync_log_status ON public.sync_log(status);
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at ON public.sync_log(started_at DESC);

-- ============================================================
-- SOURCE: 033_hubspot_admissions_enrichment.sql
-- ============================================================
-- ============================================================
-- HubSpot admissions enrichment (read-only ingest)
-- Adds storage for owner/operations fields pulled from HubSpot.
-- ============================================================

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS hubspot_owner_id text,
  ADD COLUMN IF NOT EXISTS admissions_owner_email text;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS hubspot_owner_id text,
  ADD COLUMN IF NOT EXISTS owner_email text,
  ADD COLUMN IF NOT EXISTS expected_start_date date,
  ADD COLUMN IF NOT EXISTS interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_outcome text,
  ADD COLUMN IF NOT EXISTS funding_status text,
  ADD COLUMN IF NOT EXISTS travel_readiness text,
  ADD COLUMN IF NOT EXISTS packet_status text,
  ADD COLUMN IF NOT EXISTS lead_source text,
  ADD COLUMN IF NOT EXISTS source_campaign text,
  ADD COLUMN IF NOT EXISTS source_detail text;

CREATE INDEX IF NOT EXISTS idx_prospects_hubspot_owner_id ON public.prospects(hubspot_owner_id);
CREATE INDEX IF NOT EXISTS idx_applications_hubspot_owner_id ON public.applications(hubspot_owner_id);
CREATE INDEX IF NOT EXISTS idx_applications_expected_start_date ON public.applications(expected_start_date);

-- ============================================================
-- SOURCE: 034_org_chart_reference.sql
-- ============================================================
-- ============================================================
-- ORG CHART REFERENCE + SUBTEAM HIERARCHY
-- Source: UHP Org Chart Table (April 2026)
-- ============================================================
-- Adds:
--   1. parent_team_id on teams (subteam support)
--   2. Subteams under ops (security, grounds, maintenance, housekeeping)
--   3. Subteams under health (cpt, ihc, cnc, performance_strategy)
--   4. staff_directory reference table (org chart snapshot)
--   5. Updated locations with security/grounds area coverage
--   6. Subteam notification routing for work orders
-- ============================================================

-- ── 1. Add parent_team_id to teams ─────────────────────────
ALTER TABLE teams ADD COLUMN IF NOT EXISTS parent_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_teams_parent ON teams(parent_team_id);

-- ── 4. Staff Directory reference table ─────────────────────
CREATE TABLE IF NOT EXISTS staff_directory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name      TEXT NOT NULL,
  last_name       TEXT,
  full_name       TEXT GENERATED ALWAYS AS (first_name || COALESCE(' ' || last_name, '')) STORED,
  department      TEXT,
  role_title      TEXT,
  manager_first   TEXT,
  manager_last    TEXT,
  manager_title   TEXT,
  team_slug       TEXT REFERENCES teams(slug) ON DELETE SET NULL,
  active          BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_directory_team ON staff_directory(team_slug);
CREATE INDEX IF NOT EXISTS idx_staff_directory_name ON staff_directory(last_name, first_name);
ALTER TABLE staff_directory DISABLE ROW LEVEL SECURITY;

-- ── 5. Seed staff directory from org chart (April 2026) ────

-- EXECUTIVE / LEADERSHIP
SET session_replication_role = replica; -- bypass team_slug FK for local dev
INSERT INTO staff_directory (first_name, last_name, department, role_title, manager_first, manager_last, manager_title, team_slug) VALUES
  ('Matt',      'Hesse',          'Executive',                          'CEO',                                  NULL,        NULL,         NULL,                               'executive'),
  ('Timothy',   'Simmons',        'Operations',                         'COO',                                  'Matt',      'Hesse',      'CEO',                              'executive'),
  ('Matthew',   'Egan',           'Finance, Accounting & Compliance',   'CFO',                                  'Matt',      'Hesse',      'CEO',                              'executive'),
  ('Michael',   'Shea',           'Brand & Marketing',                  'CMO / GM',                             'Matt',      'Hesse',      'CEO',                              'executive'),

-- OPERATIONS
  ('Luke',      'Rayfield',       'Campus Operations',                  'SVP, Operations',                      'Timothy',   'Simmons',    'COO',                              'ops'),
  ('Ben',       'Durham',         'Campus Operations',                  'VP, Operations',                       'Luke',      'Rayfield',   'SVP, Operations',                  'ops'),
  ('Joaquin',   'Rodriguez',      'General Operations',                 'General Ops Mgr',                      'Ben',       'Durham',     'VP, Operations',                   'gen-ops'),
  ('Kevin',     'Berneburg',      'General Operations',                 'Operations Generalist',                'Joaquin',   'Rodriguez',  'General Ops Mgr',                  'gen-ops'),
  ('Eric',      'Corvin',         'General Operations',                 'Facilities Manager',                   'Kevin',     'Berneburg',  'Operations Generalist',            'gen-ops'),

-- CAMPUS SECURITY
  ('Michael',   'Brown',          'Campus Security',                    'Head of Security',                     'Ben',       'Durham',     'VP, Operations',                   'security'),
  ('Nathan',    'Drebenstedt',    'Campus Security',                    'Security Officer',                     'Michael',   'Brown',      'Head of Security',                 'security'),

-- GROUNDS & MAINTENANCE
  ('Dominic',   'Silva',          'Campus Grounds & Maintenance',       'Head of Grounds',                      'Luke',      'Rayfield',   'SVP, Operations',                  'grounds'),
  ('Kyle',      'Peak',           'Campus Grounds & Maintenance',       'Grounds',                              'Dominic',   'Silva',      'Head of Grounds',                  'grounds'),
  ('Jason',     'Tutor',          'Campus Grounds & Maintenance',       'Grounds',                              'Kyle',      'Peak',       'Grounds',                          'grounds'),

-- CONSTRUCTION & FACILITIES
  ('Tom',       'Byland',         'Construction & Facilities',          'Owner''s Representative',              'Luke',      'Rayfield',   'SVP, Operations',                  'construction'),
  ('Trent',     'Ackerman',       'Construction & Facilities',          'Project Manager, Construction',        'Tom',       'Byland',     'Owner''s Representative',          'construction'),

-- HOUSEKEEPING
  ('Megan',     'Smith',          'Housekeeping',                       'Director of Experience & Hospitality', 'Luke',      'Rayfield',   'SVP, Operations',                  'housekeeping'),
  ('Vicky',     'Wilkins',        'Housekeeping',                       'Hospitality - Housekeeping',           'Megan',     'Smith',      'Director of Experience & Hospitality', 'housekeeping'),
  ('Carlena',   'Webb',           'Housekeeping',                       'Hospitality - Housekeeping',           'Megan',     'Smith',      'Director of Experience & Hospitality', 'housekeeping'),
  ('Whitney',   'Rurak',          'Housekeeping',                       'Hospitality - Housekeeping',           'Vicky',     'Wilkins',    'Hospitality - Housekeeping',       'housekeeping'),

-- CULINARY
  ('Brian',     'Busker',         'Culinary',                           'Dir, Culinary',                        'Luke',      'Rayfield',   'SVP, Operations',                  'culinary'),
  ('Josh',      'Smith',          'Culinary',                           'Lead Line Cook',                       'Brian',     'Busker',     'Dir, Culinary',                    'culinary'),
  ('Michael',   'Moore',          'Culinary',                           'Line Cook',                            'Josh',      'Smith',      'Lead Line Cook',                   'culinary'),
  ('Alisha',    'Hernandez',      'Culinary',                           'Dishwasher',                           'Brian',     'Busker',     'Dir, Culinary',                    'culinary'),
  ('Susan',     'Lopez',          'Culinary',                           'Dishwasher',                           'Alisha',    'Hernandez',  'Dishwasher',                       'culinary'),
  ('David',     'Guerra',         'Culinary',                           'Dishwasher',                           'Susan',     'Lopez',      'Dishwasher',                       'culinary'),
  ('Arturo',    'Alfaro Jr',      'Culinary',                           'Dishwasher',                           'David',     'Guerra',     'Dishwasher',                       'culinary'),
  ('Jeanette',  'Aguilar',        'Culinary',                           'Dishwasher',                           'Arturo',    'Alfaro Jr',  'Dishwasher',                       'culinary'),
  ('Edward',    'Alfaro',         'Culinary',                           'Dishwasher',                           'Arturo',    'Alfaro Jr',  'Dishwasher',                       'culinary'),

-- HUMAN PERFORMANCE (SVP level)
  ('Hunter',    'Schurrer',       'Human Performance',                  'SVP, Performance',                     'Timothy',   'Simmons',    'COO',                              'health'),
  ('Mark',      'Dreusicke',      'IHC',                                'VP of Coaching & Development',         'Hunter',    'Schurrer',   'SVP, Performance',                 'ihc'),
  ('Kelly',     'Howard',         'Human Performance',                  'VP of Education',                      'Hunter',    'Schurrer',   'SVP, Performance',                 'health'),

-- CPT
  ('Candice',   'Storley',        'CPT',                                'Dir, Performance',                     'Hunter',    'Schurrer',   'SVP, Performance',                 'cpt'),
  ('David',     'Hamrick',        'CPT',                                'Performance Coach',                    'Candice',   'Storley',    'Dir, Performance',                 'cpt'),
  ('Kenneth',   'Stone',          'CPT',                                'Performance Coach',                    'Candice',   'Storley',    'Dir, Performance',                 'cpt'),
  ('Andrew',    'Reid',           'CPT',                                'Asst Performance Coach',               'Blair',     'Wagner',     'Sr Dir, Prf Strategy',             'cpt'),
  ('Clifton',   'Arnold',         'CPT',                                'Asst Performance Coach',               'Candice',   'Storley',    'Dir, Performance',                 'cpt'),

-- IHC
  ('Laura',     'Lovell',         'IHC',                                'Dir, IHC',                             'Mark',      'Dreusicke',  'VP of Coaching & Development',     'ihc'),
  ('Mistil',    'Cassels',        'IHC',                                'IHC Instructor',                       'Laura',     'Lovell',     'Dir, IHC',                         'ihc'),
  ('Tyrone',    'Gowans',         'IHC',                                'IHC Instructor',                       'Laura',     'Lovell',     'Dir, IHC',                         'ihc'),
  ('Amanda',    'Garcia',         'IHC',                                'IHC Instructor',                       'Laura',     'Lovell',     'Dir, IHC',                         'ihc'),
  ('Colleen',   'Cronin',         'IHC',                                'IHC Guest Instructor',                 'Laura',     'Lovell',     'Dir, IHC',                         'ihc'),

-- CNC
  ('Riley',     'Arnold',         'CNC',                                'Farmer / Greenhouse Manager',          'Hunter',    'Schurrer',   'SVP, Performance',                 'cnc'),

-- PERFORMANCE STRATEGY
  ('Blair',     'Wagner',         'Performance Strategy',               'Sr Dir, Performance Strategy',         'Hunter',    'Schurrer',   'SVP, Performance',                 'performance-strategy'),

-- IGNITE TRADE SCHOOL
  ('Ray',       'Taylor',         'Ignite Trade School',                'VP, Ignite Trade School',              'Hunter',    'Schurrer',   'SVP, Performance',                 'ignite'),

-- ADMISSIONS
  ('Joseph',    'Szczepaniak',    'Admissions',                         'VP, Admissions',                       'Michael',   'Shea',       'CMO / GM',                         'admissions'),
  ('Kenneth',   'Welch',          'Admissions',                         'Admissions Manager',                   'Joseph',    'Szczepaniak','VP, Admissions',                   'admissions'),
  ('Mickey',    'Gamonal',        'Admissions',                         'Admissions',                           'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Jason',     'Strickland',     'Admissions',                         'Admissions Advisor',                   'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Joshua',    'Capleton',       'Admissions',                         'Admissions Advisor',                   'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Curtis',    'Josenberger Jr', 'Admissions',                         'Admissions Advisor',                   'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Cody',      'Montemayer',     'Admissions',                         'Admissions Advisor',                   'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Peter',     'Russo',          'Admissions',                         'Admissions Specialist',                'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Scead',     'Saxton',         'Admissions',                         'Admissions Advisor',                   'Kenneth',   'Welch',      'Admissions Manager',               'admissions'),
  ('Halle',     'Haas',           'Enrollment',                         'Enrollment Coordinator',               'Joseph',    'Szczepaniak','VP, Admissions',                   'admissions'),

-- MARKETING / BRAND
  ('Carson',    'Graham',         'Media',                              'Dir, Photography',                     NULL,        NULL,         'Marketing Director',               'marketing'),
  ('Shane',     'Gray',           'Media',                              'Media Editor',                         'Carson',    'Graham',     'Dir, Photography',                 'marketing'),
  ('David',     'Maccar',         'Media',                              'Media Manager',                        'Michael',   'Shea',       'CMO / GM',                         'marketing'),
  ('Hattie',    'Douglas',        'People',                             'Dir, People',                          'Michael',   'Shea',       'CMO / GM',                         'marketing'),

-- FINANCE / ACCOUNTING
  ('Katelin',   'Petersen',       'Accounting',                         'Sr Accountant',                        'Matthew',   'Egan',       'CFO',                              'executive'),

-- LEADERSHIP DEVELOPMENT
  ('Sean',      'Murphy',         'Leadership Development',             'VP, Leadership Development & Pathways','Timothy',   'Simmons',    'COO',                              'executive'),
  ('Wesley',    'Northey IV',     'Leadership Development',             'Director, Leadership Development',     'Sean',      'Murphy',     'VP, Leadership Development',       'executive'),

-- STUDENT CONCIERGE
  ('Lavone',    NULL,             'Student Concierge',                  'CPT Concierge',                        NULL,        NULL,         'Director of Experience & Hospitality', 'housekeeping')
ON CONFLICT DO NOTHING;

SET session_replication_role = DEFAULT; -- restore FK enforcement

-- ── 6. Update location areas for security/grounds coverage ─

-- Exterior / entrance areas map to security + grounds
UPDATE locations SET team_slug = 'security'
WHERE area IN ('entrance', 'security') AND team_slug = 'ops';

UPDATE locations SET area = 'exterior'
WHERE name IN ('Parking Lot', 'Outdoor Training Area') AND area IS NULL;

-- Ensure outdoor and exterior map to grounds
INSERT INTO locations (name, building, area, team_slug) VALUES
  ('Vehicle Maintenance Bay',  'Exterior',          'vehicle_fleet',   'grounds'),
  ('Greenhouse',               'CNC Building',      'cnc',             'cnc'),
  ('CPT Performance Lab',      'Fieldhouse',        'cpt',             'cpt'),
  ('IHC Coaching Room A',      'Coaching Building', 'ihc',             'ihc'),
  ('IHC Coaching Room B',      'Coaching Building', 'ihc',             'ihc'),
  ('Security Office',          'Main Building',     'security',        'security'),
  ('Residential Common Area',  'Residential',       'residential',     'housekeeping'),
  ('Laundry Room',             'Residential',       'residential',     'housekeeping')
ON CONFLICT DO NOTHING;

-- ── 7. Notification rules for subteams ─────────────────────

-- Security: security incidents, access alerts, P1 campus
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'email', 'P1_P2'  FROM teams WHERE slug = 'security'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'sms',   'P1_ONLY' FROM teams WHERE slug = 'security'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'security_incident',   'sms',   'ALL'     FROM teams WHERE slug = 'security'
ON CONFLICT DO NOTHING;

-- Grounds: exterior work orders, vehicle fleet
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'email', 'ALL'     FROM teams WHERE slug = 'grounds'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'sms',   'P1_P2'   FROM teams WHERE slug = 'grounds'
ON CONFLICT DO NOTHING;

-- Housekeeping: room readiness, residential issues
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'email', 'ALL'     FROM teams WHERE slug = 'housekeeping'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'guest_arrival',       'email', 'ALL'     FROM teams WHERE slug = 'housekeeping'
ON CONFLICT DO NOTHING;

-- Gen-ops: all campus facilities
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'email', 'ALL'     FROM teams WHERE slug = 'gen-ops'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'work_order_created',  'sms',   'P1_ONLY' FROM teams WHERE slug = 'gen-ops'
ON CONFLICT DO NOTHING;

-- CPT: student performance flags, coaching attendance
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'student_week2_flagged',       'email', 'ALL'  FROM teams WHERE slug = 'cpt'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'attendance_below_threshold',  'email', 'ALL'  FROM teams WHERE slug = 'cpt'
ON CONFLICT DO NOTHING;

-- IHC: student health flags
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'student_week2_flagged',       'email', 'ALL'  FROM teams WHERE slug = 'ihc'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'attendance_below_threshold',  'email', 'ALL'  FROM teams WHERE slug = 'ihc'
ON CONFLICT DO NOTHING;

-- CNC: allergen alerts, headcount (culinary overlap)
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'allergen_alert',   'sms',   'ALL'  FROM teams WHERE slug = 'cnc'
ON CONFLICT DO NOTHING;
INSERT INTO notification_rules (team_id, event_type, channel, threshold)
SELECT id, 'daily_headcount',  'email', 'ALL'  FROM teams WHERE slug = 'cnc'
ON CONFLICT DO NOTHING;

-- ── 8. Helper view: team hierarchy ─────────────────────────
CREATE OR REPLACE VIEW team_hierarchy AS
SELECT
  c.id,
  c.name,
  c.slug,
  c.description,
  c.color,
  c.icon,
  c.active,
  p.name  AS parent_name,
  p.slug  AS parent_slug
FROM teams c
LEFT JOIN teams p ON c.parent_team_id = p.id;

-- ============================================================
-- SOURCE: 035_ops_workflow_pilot.sql
-- ============================================================
-- ============================================================
-- OPS WORKFLOW PILOT
-- Extends work_orders into an Operations command-center workflow:
-- work areas, facilities, vendors, assets, attachments, timeline,
-- blockers, verification, and richer closeout controls.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Remove older narrow checks so the pilot can use real Ops lifecycle values.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.work_orders'::regclass
      AND contype = 'c'
      AND conname IN ('work_orders_status_check', 'work_orders_priority_check', 'work_orders_category_check')
  LOOP
    EXECUTE format('ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.ops_work_areas (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  team_slug text NOT NULL DEFAULT 'ops',
  lead_user_id uuid REFERENCES public.user_profiles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_facilities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  facility_type text,
  location_id uuid REFERENCES public.locations(id),
  work_area_id uuid REFERENCES public.ops_work_areas(id),
  status text NOT NULL DEFAULT 'operational',
  risk_level text NOT NULL DEFAULT 'normal',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_vendors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  vendor_type text,
  contact_name text,
  phone text,
  email text,
  agreement_status text,
  next_follow_up_at timestamptz,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  asset_type text,
  facility_id uuid REFERENCES public.ops_facilities(id),
  location_id uuid REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'operational',
  serial_number text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS work_type text NOT NULL DEFAULT 'work_order',
  ADD COLUMN IF NOT EXISTS work_area_id uuid REFERENCES public.ops_work_areas(id),
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES public.ops_facilities(id),
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.ops_vendors(id),
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.ops_assets(id),
  ADD COLUMN IF NOT EXISTS assigned_team_slug text,
  ADD COLUMN IF NOT EXISTS assigned_vendor_id uuid REFERENCES public.ops_vendors(id),
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocker_reason text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS safety_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_summary text,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS actual_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

UPDATE public.work_orders
SET title = left(coalesce(title, nullif(description, ''), category, 'Work order'), 120)
WHERE title IS NULL;

UPDATE public.work_orders
SET assigned_team_slug = coalesce(assigned_team_slug, team_visibility[1], 'ops')
WHERE assigned_team_slug IS NULL;

CREATE TABLE IF NOT EXISTS public.work_order_tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES public.user_profiles(id),
  due_at timestamptz,
  completed_by uuid REFERENCES public.user_profiles(id),
  completed_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_order_attachments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.user_profiles(id),
  file_name text NOT NULL,
  file_type text,
  attachment_type text NOT NULL DEFAULT 'other',
  storage_bucket text NOT NULL DEFAULT 'work-order-attachments',
  storage_path text NOT NULL,
  public_url text,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.work_order_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.user_profiles(id),
  assigned_to uuid REFERENCES public.user_profiles(id),
  assigned_team_slug text,
  work_area_id uuid REFERENCES public.ops_work_areas(id),
  vendor_id uuid REFERENCES public.ops_vendors(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_recurring_maintenance (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  work_area_id uuid REFERENCES public.ops_work_areas(id),
  facility_id uuid REFERENCES public.ops_facilities(id),
  asset_id uuid REFERENCES public.ops_assets(id),
  cadence text NOT NULL,
  next_due_at timestamptz,
  priority text NOT NULL DEFAULT 'P3',
  instructions text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_inventory_deliveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_name text NOT NULL,
  quantity text,
  status text NOT NULL DEFAULT 'received',
  storage_location text,
  facility_id uuid REFERENCES public.ops_facilities(id),
  received_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_work_area ON public.work_orders(work_area_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_facility ON public.work_orders(facility_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vendor ON public.work_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_due_at ON public.work_orders(due_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_safety ON public.work_orders(safety_flag);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_team ON public.work_orders(assigned_team_slug);
CREATE INDEX IF NOT EXISTS idx_work_order_tasks_work_order ON public.work_order_tasks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_attachments_work_order ON public.work_order_attachments(work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_assignments_work_order ON public.work_order_assignments(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ops_facilities_work_area ON public.ops_facilities(work_area_id);
CREATE INDEX IF NOT EXISTS idx_ops_assets_facility ON public.ops_assets(facility_id);
CREATE INDEX IF NOT EXISTS idx_ops_recurring_next_due ON public.ops_recurring_maintenance(next_due_at);

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_priority_check CHECK (priority IN ('P0','P1','P2','P3','P4'));

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_status_check CHECK (status IN (
    'new',
    'triaged',
    'assigned',
    'in_progress',
    'blocked',
    'waiting_on_vendor',
    'waiting_on_approval',
    'scheduled',
    'ready_for_verification',
    'closed',
    'monitoring',
    'canceled',
    'open',
    'resolved',
    'archived'
  ));

ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_work_type_check CHECK (work_type IN (
    'work_order',
    'task',
    'inspection',
    'preventive',
    'vendor_followup',
    'inventory',
    'asset'
  ));

ALTER TABLE public.work_order_tasks
  ADD CONSTRAINT work_order_tasks_status_check CHECK (status IN ('open','in_progress','blocked','complete','canceled'));

-- API uses service role and enforces access in code. These tables are not for direct anonymous use.
ALTER TABLE public.ops_work_areas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_facilities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_vendors DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_recurring_maintenance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_inventory_deliveries DISABLE ROW LEVEL SECURITY;

INSERT INTO public.ops_work_areas (slug, name, description, team_slug) VALUES
  ('maintenance', 'Maintenance', 'Facilities repairs, HVAC, plumbing, electrical, general repairs.', 'ops'),
  ('grounds', 'Grounds', 'Exterior grounds, landscaping, roads, drainage, mailbox, outdoor work.', 'grounds'),
  ('safety', 'Safety', 'Fire inspections, red tags, life-safety corrective actions.', 'ops'),
  ('housekeeping', 'Housekeeping', 'Cabins, laundry, guest readiness, recurring room checks.', 'housekeeping'),
  ('comms', 'Communications', 'Radios, repeaters, coverage tests, personnel radio assignments.', 'ops'),
  ('vehicles', 'Vehicles & Equipment', 'Ranger, trailers, fleet, equipment diagnostics.', 'grounds'),
  ('vendors', 'Vendors & Sponsors', 'Vendor outreach, sponsor upkeep, quotes, follow-ups.', 'ops'),
  ('water', 'Water & Septic', 'Septic, well, sulfur treatment, pressure and water quality.', 'ops')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  team_slug = EXCLUDED.team_slug,
  active = true;

INSERT INTO public.ops_facilities (slug, name, facility_type, work_area_id, status, risk_level) VALUES
  ('dome', 'Dome', 'gym_recovery_classroom', (SELECT id FROM public.ops_work_areas WHERE slug='maintenance'), 'watch', 'high'),
  ('plc', 'PLC Kitchen & Dining Hall', 'kitchen_dining', (SELECT id FROM public.ops_work_areas WHERE slug='safety'), 'watch', 'critical'),
  ('barracks-cabins', 'Barracks Cabins', 'residential', (SELECT id FROM public.ops_work_areas WHERE slug='housekeeping'), 'watch', 'normal'),
  ('op-cabins', 'OP Cabins VIP', 'residential_vip', (SELECT id FROM public.ops_work_areas WHERE slug='water'), 'watch', 'high'),
  ('homefront', 'Homefront Apartments', 'apartments', (SELECT id FROM public.ops_work_areas WHERE slug='safety'), 'watch', 'critical'),
  ('cafe-ops-office', 'Cafe Ops Office', 'operations_office', (SELECT id FROM public.ops_work_areas WHERE slug='maintenance'), 'operational', 'normal'),
  ('cabin-5-laundry', 'Cabin 5 Laundry & Maid Services', 'support_services', (SELECT id FROM public.ops_work_areas WHERE slug='housekeeping'), 'operational', 'normal')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  facility_type = EXCLUDED.facility_type,
  work_area_id = EXCLUDED.work_area_id,
  status = EXCLUDED.status,
  risk_level = EXCLUDED.risk_level,
  active = true;

INSERT INTO public.ops_vendors (name, vendor_type, phone, notes) VALUES
  ('Summers Well Drilling', 'well_contractor', '479-736-2089', 'Closest well contractor in Colcord OK. Ask for Mason.'),
  ('Holman Pump & Well', 'well_contractor', '918-479-7867', 'Backup well contractor in Locust Grove.'),
  ('RAW', 'sponsor', NULL, 'Confirm product upkeep, restocking, signage, and contact.'),
  ('Oakley', 'sponsor', NULL, 'Confirm display maintenance, branding, and contact.'),
  ('Red Bull', 'sponsor', NULL, 'Confirm active sponsorship and restocking schedule.'),
  ('C4', 'sponsor', NULL, 'Confirm decal artwork, branding scope, and upkeep contact.')
ON CONFLICT DO NOTHING;

INSERT INTO public.ops_assets (name, asset_type, facility_id, status, notes) VALUES
  ('Ranger 1500', 'vehicle', NULL, 'needs_diagnostic', 'Suspected transmission issue.'),
  ('Radio Repeater System', 'communications', NULL, 'pending_install', 'Lift and coverage test required.'),
  ('Dome Cold Plunges', 'recovery', (SELECT id FROM public.ops_facilities WHERE slug='dome'), 'operational', 'Drain, clean, refill, and treatment logs required.'),
  ('PLC HVAC Unit', 'hvac', (SELECT id FROM public.ops_facilities WHERE slug='plc'), 'watch', 'Correct 2-inch filter and monitoring schedule needed.')
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('work-order-attachments', 'work-order-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SOURCE: 037_department_navigation_hierarchy.sql
-- ============================================================
-- ============================================================
-- DEPARTMENT NAVIGATION HIERARCHY
-- Adds department metadata and seeds parent/child teams that
-- drive department-based menus and starter dashboards.
-- ============================================================

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS team_type TEXT DEFAULT 'subteam';
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS dashboard_href TEXT;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100;

ALTER TABLE public.teams ALTER COLUMN team_type SET DEFAULT 'subteam';
UPDATE public.teams SET team_type = 'subteam' WHERE team_type IS NULL OR team_type = 'team';

DO $$
BEGIN
  ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_team_type_check;
  ALTER TABLE public.teams
    ADD CONSTRAINT teams_team_type_check
    CHECK (team_type IN ('department', 'subteam', 'system', 'audience'));
END $$;

CREATE INDEX IF NOT EXISTS idx_teams_team_type ON public.teams(team_type);
CREATE INDEX IF NOT EXISTS idx_teams_sort_order ON public.teams(sort_order);

-- Teams data with canonical UUIDs is inserted in the FOUNDATIONAL ORG DATA section at the bottom of this file.
-- Skipping anonymous-UUID inserts here to avoid name/slug conflicts.


-- SOURCE: 038_ops_operating_model.sql
-- ============================================================
-- ============================================================
-- OPS OPERATING MODEL
-- Adds the operational source-of-truth layer for assets,
-- preventive maintenance, grounds routines, projects/milestones,
-- and source document/import tracking.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.ops_assets
  ADD COLUMN IF NOT EXISTS make text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS year int,
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS meter_label text,
  ADD COLUMN IF NOT EXISTS meter_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS meter_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_service_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_service_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_team_slug text,
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS service_interval_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS service_interval_unit text;

CREATE TABLE IF NOT EXISTS public.ops_asset_service_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id uuid NOT NULL REFERENCES public.ops_assets(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  service_type text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  meter_value numeric(12,2),
  performed_by uuid REFERENCES public.user_profiles(id),
  vendor_id uuid REFERENCES public.ops_vendors(id),
  cost numeric(12,2),
  notes text,
  next_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_projects (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  project_type text NOT NULL DEFAULT 'construction',
  work_area_id uuid REFERENCES public.ops_work_areas(id),
  facility_id uuid REFERENCES public.ops_facilities(id),
  vendor_id uuid REFERENCES public.ops_vendors(id),
  owner_team_slug text NOT NULL DEFAULT 'ops',
  lead_user_id uuid REFERENCES public.user_profiles(id),
  status text NOT NULL DEFAULT 'planning',
  priority text NOT NULL DEFAULT 'P2',
  start_date date,
  target_date date,
  actual_completion_date date,
  budget_estimate numeric(12,2),
  actual_cost numeric(12,2),
  scope text,
  blocker_reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_project_milestones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES public.ops_projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open',
  due_date date,
  completed_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_grounds_zones (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  zone_type text NOT NULL DEFAULT 'grounds',
  facility_id uuid REFERENCES public.ops_facilities(id),
  location_id uuid REFERENCES public.locations(id),
  priority text NOT NULL DEFAULT 'P3',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_grounds_routines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id uuid NOT NULL REFERENCES public.ops_grounds_zones(id) ON DELETE CASCADE,
  title text NOT NULL,
  routine_type text NOT NULL,
  cadence text NOT NULL,
  season text,
  next_due_at timestamptz,
  assigned_team_slug text NOT NULL DEFAULT 'grounds',
  instructions text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_import_batches (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_name text NOT NULL,
  source_type text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  uploaded_by uuid REFERENCES public.user_profiles(id),
  file_name text,
  storage_bucket text,
  storage_path text,
  extracted_summary text,
  created_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ops_document_links (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type text NOT NULL,
  entity_id uuid,
  file_name text NOT NULL,
  file_type text,
  storage_bucket text,
  storage_path text,
  public_url text,
  source_import_id uuid REFERENCES public.ops_import_batches(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES public.user_profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_assets_owner_team ON public.ops_assets(owner_team_slug);
CREATE INDEX IF NOT EXISTS idx_ops_assets_next_service ON public.ops_assets(next_service_at);
CREATE INDEX IF NOT EXISTS idx_ops_asset_service_logs_asset ON public.ops_asset_service_logs(asset_id);
CREATE INDEX IF NOT EXISTS idx_ops_asset_service_logs_next_due ON public.ops_asset_service_logs(next_due_at);
CREATE INDEX IF NOT EXISTS idx_ops_projects_status ON public.ops_projects(status);
CREATE INDEX IF NOT EXISTS idx_ops_projects_owner_team ON public.ops_projects(owner_team_slug);
CREATE INDEX IF NOT EXISTS idx_ops_project_milestones_project ON public.ops_project_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_ops_grounds_routines_next_due ON public.ops_grounds_routines(next_due_at);
CREATE INDEX IF NOT EXISTS idx_ops_document_links_entity ON public.ops_document_links(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ops_import_batches_status ON public.ops_import_batches(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_recurring_title_unique ON public.ops_recurring_maintenance(title);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_project_milestone_unique ON public.ops_project_milestones(project_id, title);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_grounds_routine_unique ON public.ops_grounds_routines(zone_id, title);

ALTER TABLE public.ops_asset_service_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_project_milestones DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_grounds_zones DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_grounds_routines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_import_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_document_links DISABLE ROW LEVEL SECURITY;

UPDATE public.ops_assets
SET owner_team_slug = CASE
  WHEN asset_type IN ('vehicle', 'fleet', 'trailer') THEN 'transportation'
  WHEN asset_type IN ('communications') THEN 'security'
  WHEN asset_type IN ('hvac', 'recovery') THEN 'maintenance'
  ELSE coalesce(owner_team_slug, 'ops')
END
WHERE owner_team_slug IS NULL;

UPDATE public.ops_assets
SET meter_label = 'hours'
WHERE meter_label IS NULL
  AND name ILIKE '%ranger%';

UPDATE public.ops_assets
SET next_service_at = now() + interval '30 days'
WHERE next_service_at IS NULL
  AND name ILIKE '%ranger%';

INSERT INTO public.ops_recurring_maintenance (title, work_area_id, facility_id, asset_id, cadence, next_due_at, priority, instructions)
VALUES
  (
    'Ranger 1500 diagnostic and service check',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'vehicles'),
    NULL,
    (SELECT id FROM public.ops_assets WHERE name = 'Ranger 1500' LIMIT 1),
    'Every 30 days or when symptoms appear',
    now() + interval '7 days',
    'P1',
    'Check transmission behavior, fluids, tires, brakes, and document meter reading.'
  ),
  (
    'PLC HVAC filter and wiring inspection',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'),
    (SELECT id FROM public.ops_facilities WHERE slug = 'plc'),
    (SELECT id FROM public.ops_assets WHERE name = 'PLC HVAC Unit' LIMIT 1),
    'Monthly',
    now() + interval '14 days',
    'P2',
    'Verify correct 2-inch filter size, inspect wiring, and log service notes.'
  ),
  (
    'Dome cold plunge drain, clean, refill, and treatment',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'),
    (SELECT id FROM public.ops_facilities WHERE slug = 'dome'),
    (SELECT id FROM public.ops_assets WHERE name = 'Dome Cold Plunges' LIMIT 1),
    'Weekly',
    now() + interval '7 days',
    'P2',
    'Drain, clean, refill, add treatment, and confirm water condition.'
  ),
  (
    'Radio repeater battery and coverage check',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'comms'),
    NULL,
    (SELECT id FROM public.ops_assets WHERE name = 'Radio Repeater System' LIMIT 1),
    'Weekly',
    now() + interval '7 days',
    'P2',
    'Confirm repeater health, battery condition, and field radio coverage.'
  )
ON CONFLICT DO NOTHING;

INSERT INTO public.ops_grounds_zones (slug, name, zone_type, facility_id, priority, notes)
VALUES
  ('front-entrance', 'Front Entrance', 'landscape', NULL, 'P2', 'First impression area, signage, flagpole, and mailbox approach.'),
  ('campus-roads', 'Campus Roads', 'roads', NULL, 'P1', 'Low road, parking hill, cabin road, drainage, grading, gravel, and culverts.'),
  ('dome-exterior', 'Dome Exterior', 'facility_exterior', (SELECT id FROM public.ops_facilities WHERE slug = 'dome'), 'P2', 'Dome tarp, exterior cleanup, and recovery area grounds.'),
  ('cabin-grounds', 'Cabin Grounds', 'residential_exterior', (SELECT id FROM public.ops_facilities WHERE slug = 'barracks-cabins'), 'P2', 'Mowing, weed eating, drainage, and cabin exterior readiness.'),
  ('op-cabins-grounds', 'OP Cabin Grounds', 'residential_exterior', (SELECT id FROM public.ops_facilities WHERE slug = 'op-cabins'), 'P2', 'VIP cabin exterior, water issues, and guest readiness.')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  zone_type = EXCLUDED.zone_type,
  facility_id = EXCLUDED.facility_id,
  priority = EXCLUDED.priority,
  notes = EXCLUDED.notes,
  active = true;

INSERT INTO public.ops_grounds_routines (zone_id, title, routine_type, cadence, season, next_due_at, instructions)
VALUES
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'front-entrance'), 'Mow and edge front entrance', 'mowing', 'Weekly', 'Growing season', now() + interval '7 days', 'Mow, edge, clear debris, and inspect sign/flag area.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'front-entrance'), 'Mailbox and signage check', 'inspection', 'Weekly', 'All year', now() + interval '7 days', 'Confirm mailbox is secure, visible, and accessible.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'campus-roads'), 'Road grading and washout check', 'grading', 'Monthly and after heavy rain', 'All year', now() + interval '30 days', 'Inspect low road, parking hill, cabin road, culverts, and gravel needs.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'campus-roads'), 'Culvert and drainage check', 'drainage', 'After heavy rain', 'All year', now() + interval '14 days', 'Check flow paths, blocked culverts, standing water, and erosion.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'dome-exterior'), 'Dome exterior weed eating and debris removal', 'weed_eating', 'Weekly', 'Growing season', now() + interval '7 days', 'Trim exterior, remove debris, and report tarp/electrical hazards.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'cabin-grounds'), 'Cabin grounds mowing and weed eating', 'mowing', 'Weekly', 'Growing season', now() + interval '7 days', 'Prioritize student-facing walkways and cabin entrances.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'op-cabins-grounds'), 'OP cabin exterior readiness check', 'inspection', 'Weekly', 'All year', now() + interval '7 days', 'Inspect water/sulfur issues, walkways, guest approach, and exterior cleanliness.')
ON CONFLICT DO NOTHING;

INSERT INTO public.ops_projects (slug, name, project_type, work_area_id, facility_id, owner_team_slug, status, priority, target_date, budget_estimate, scope)
VALUES
  ('dome-electrical-tarp-cold-plunge', 'Dome electrical, tarp, and cold plunge readiness', 'facility_project', (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'), (SELECT id FROM public.ops_facilities WHERE slug = 'dome'), 'maintenance', 'active', 'P1', current_date + 14, NULL, 'Remove tarp, confirm electrical scope, and keep cold plunges clean and operational.'),
  ('radio-repeater-install', 'Radio repeater install and coverage validation', 'communications', (SELECT id FROM public.ops_work_areas WHERE slug = 'comms'), NULL, 'security', 'planning', 'P1', current_date + 14, NULL, 'Lift, install, assign personnel radios, and test coverage across campus.'),
  ('fire-red-tag-corrections', 'Fire inspection red tag corrections', 'safety', (SELECT id FROM public.ops_work_areas WHERE slug = 'safety'), (SELECT id FROM public.ops_facilities WHERE slug = 'plc'), 'ops', 'active', 'P0', current_date + 7, NULL, 'Resolve PLC and Homefront fire inspection red tags and document verification.'),
  ('water-sulfur-treatment', 'Water sulfur treatment and well contractor path', 'infrastructure', (SELECT id FROM public.ops_work_areas WHERE slug = 'water'), (SELECT id FROM public.ops_facilities WHERE slug = 'op-cabins'), 'maintenance', 'planning', 'P1', current_date + 21, NULL, 'Confirm treatment approach, vendor path, and recurring water quality checks.')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  project_type = EXCLUDED.project_type,
  work_area_id = EXCLUDED.work_area_id,
  facility_id = EXCLUDED.facility_id,
  owner_team_slug = EXCLUDED.owner_team_slug,
  status = EXCLUDED.status,
  priority = EXCLUDED.priority,
  target_date = EXCLUDED.target_date,
  scope = EXCLUDED.scope,
  active = true;

INSERT INTO public.ops_project_milestones (project_id, title, description, status, due_date, sort_order)
VALUES
  ((SELECT id FROM public.ops_projects WHERE slug = 'dome-electrical-tarp-cold-plunge'), 'Confirm electrical scope', 'Identify vendor or internal owner and required materials.', 'open', current_date + 5, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'dome-electrical-tarp-cold-plunge'), 'Remove tarp and clear exterior hazards', 'Remove tarp, inspect exterior, and create work orders for hazards.', 'open', current_date + 7, 20),
  ((SELECT id FROM public.ops_projects WHERE slug = 'radio-repeater-install'), 'Schedule lift and install window', 'Coordinate lift, install crew, and downtime window.', 'open', current_date + 5, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'radio-repeater-install'), 'Coverage test and radio assignments', 'Test campus coverage and document assigned radios.', 'open', current_date + 10, 20),
  ((SELECT id FROM public.ops_projects WHERE slug = 'fire-red-tag-corrections'), 'Collect inspection findings', 'Attach red tag photos and inspection notes.', 'open', current_date + 2, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'fire-red-tag-corrections'), 'Verify corrective actions', 'Safety lead verifies before closeout.', 'open', current_date + 7, 20),
  ((SELECT id FROM public.ops_projects WHERE slug = 'water-sulfur-treatment'), 'Choose vendor path', 'Call listed well vendors and capture recommendation.', 'open', current_date + 7, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'water-sulfur-treatment'), 'Create recurring water quality check', 'Turn treatment decision into recurring PM.', 'open', current_date + 14, 20)
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('ops-source-documents', 'ops-source-documents', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SOURCE: 039_instructor_pin.sql
-- ============================================================
-- Instructor PIN columns for user_profiles
-- These existed on staging without a migration; codifying them here.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS instructor_pin      TEXT,
  ADD COLUMN IF NOT EXISTS instructor_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS instructor_pin_set_at TIMESTAMPTZ;

-- ============================================================
-- SOURCE: 039_ops_full_operating_model_combined.sql
-- ============================================================
-- ============================================================
-- UHP OPS FULL OPERATING MODEL - COMBINED SQL
-- Run this when the Ops foundation tables do not exist yet.
--
-- Includes:
-- 1. Ops work areas, facilities, vendors, assets
-- 2. Work order extensions, tasks, attachments, assignments
-- 3. Preventive maintenance and inventory deliveries
-- 4. Asset service logs
-- 5. Projects and milestones
-- 6. Grounds zones and routines
-- 7. Ops import batches and document links
-- 8. Initial seed data from the Ops tactical tracker
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Remove older narrow work_order checks so real Ops lifecycle values can be used.
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.work_orders') IS NOT NULL THEN
    FOR c IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.work_orders'::regclass
        AND contype = 'c'
        AND conname IN (
          'work_orders_status_check',
          'work_orders_priority_check',
          'work_orders_category_check',
          'work_orders_work_type_check'
        )
    LOOP
      EXECUTE format('ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS %I', c.conname);
    END LOOP;
  END IF;
END $$;

ALTER TABLE public.ops_assets
  ADD COLUMN IF NOT EXISTS make text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS year int,
  ADD COLUMN IF NOT EXISTS vin text,
  ADD COLUMN IF NOT EXISTS meter_label text,
  ADD COLUMN IF NOT EXISTS meter_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS meter_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_service_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_service_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_team_slug text,
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS service_interval_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS service_interval_unit text;

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS work_type text NOT NULL DEFAULT 'work_order',
  ADD COLUMN IF NOT EXISTS work_area_id uuid REFERENCES public.ops_work_areas(id),
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES public.ops_facilities(id),
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.ops_vendors(id),
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.ops_assets(id),
  ADD COLUMN IF NOT EXISTS assigned_team_slug text,
  ADD COLUMN IF NOT EXISTS assigned_vendor_id uuid REFERENCES public.ops_vendors(id),
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocker_reason text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS safety_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_summary text,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS actual_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

UPDATE public.work_orders
SET title = left(coalesce(title, nullif(description, ''), category, 'Work order'), 120)
WHERE title IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_orders'
      AND column_name = 'team_visibility'
  ) THEN
    UPDATE public.work_orders
    SET assigned_team_slug = coalesce(assigned_team_slug, team_visibility[1], 'ops')
    WHERE assigned_team_slug IS NULL;
  ELSE
    UPDATE public.work_orders
    SET assigned_team_slug = coalesce(assigned_team_slug, 'ops')
    WHERE assigned_team_slug IS NULL;
  END IF;
END $$;





CREATE INDEX IF NOT EXISTS idx_ops_recurring_title
  ON public.ops_recurring_maintenance (title);





CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_project_milestone_unique
  ON public.ops_project_milestones (project_id, title);



CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_grounds_routine_unique
  ON public.ops_grounds_routines (zone_id, title);



CREATE INDEX IF NOT EXISTS idx_work_orders_work_area ON public.work_orders(work_area_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_facility ON public.work_orders(facility_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_vendor ON public.work_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_due_at ON public.work_orders(due_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_safety ON public.work_orders(safety_flag);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_team ON public.work_orders(assigned_team_slug);
CREATE INDEX IF NOT EXISTS idx_ops_recurring_next_due ON public.ops_recurring_maintenance(next_due_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_orders_priority_check'
      AND conrelid = 'public.work_orders'::regclass
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_priority_check CHECK (priority IN ('P0','P1','P2','P3','P4'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_orders_status_check'
      AND conrelid = 'public.work_orders'::regclass
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_status_check CHECK (status IN (
        'new',
        'triaged',
        'assigned',
        'in_progress',
        'blocked',
        'waiting_on_vendor',
        'waiting_on_approval',
        'scheduled',
        'ready_for_verification',
        'closed',
        'monitoring',
        'canceled',
        'open',
        'resolved',
        'archived'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_orders_work_type_check'
      AND conrelid = 'public.work_orders'::regclass
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_work_type_check CHECK (work_type IN (
        'work_order',
        'task',
        'inspection',
        'preventive',
        'vendor_followup',
        'inventory',
        'asset'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_order_tasks_status_check'
      AND conrelid = 'public.work_order_tasks'::regclass
  ) THEN
    ALTER TABLE public.work_order_tasks
      ADD CONSTRAINT work_order_tasks_status_check CHECK (status IN ('open','in_progress','blocked','complete','canceled'));
  END IF;
END $$;

-- API uses service role and enforces access in code.
ALTER TABLE public.ops_work_areas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_facilities DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_vendors DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_assets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_tasks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_recurring_maintenance DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_inventory_deliveries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_asset_service_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_project_milestones DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_grounds_zones DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_grounds_routines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_import_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_document_links DISABLE ROW LEVEL SECURITY;

INSERT INTO public.ops_work_areas (slug, name, description, team_slug) VALUES
  ('maintenance', 'Maintenance', 'Facilities repairs, HVAC, plumbing, electrical, general repairs.', 'ops'),
  ('grounds', 'Grounds', 'Exterior grounds, landscaping, roads, drainage, mailbox, outdoor work.', 'grounds'),
  ('safety', 'Safety', 'Fire inspections, red tags, life-safety corrective actions.', 'ops'),
  ('housekeeping', 'Housekeeping', 'Cabins, laundry, guest readiness, recurring room checks.', 'housekeeping'),
  ('comms', 'Communications', 'Radios, repeaters, coverage tests, personnel radio assignments.', 'ops'),
  ('vehicles', 'Vehicles & Equipment', 'Ranger, trailers, fleet, equipment diagnostics.', 'grounds'),
  ('vendors', 'Vendors & Sponsors', 'Vendor outreach, sponsor upkeep, quotes, follow-ups.', 'ops'),
  ('water', 'Water & Septic', 'Septic, well, sulfur treatment, pressure and water quality.', 'ops')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  team_slug = EXCLUDED.team_slug,
  active = true;

INSERT INTO public.ops_facilities (slug, name, facility_type, work_area_id, status, risk_level) VALUES
  ('dome', 'Dome', 'gym_recovery_classroom', (SELECT id FROM public.ops_work_areas WHERE slug='maintenance'), 'watch', 'high'),
  ('plc', 'PLC Kitchen & Dining Hall', 'kitchen_dining', (SELECT id FROM public.ops_work_areas WHERE slug='safety'), 'watch', 'critical'),
  ('barracks-cabins', 'Barracks Cabins', 'residential', (SELECT id FROM public.ops_work_areas WHERE slug='housekeeping'), 'watch', 'normal'),
  ('op-cabins', 'OP Cabins VIP', 'residential_vip', (SELECT id FROM public.ops_work_areas WHERE slug='water'), 'watch', 'high'),
  ('homefront', 'Homefront Apartments', 'apartments', (SELECT id FROM public.ops_work_areas WHERE slug='safety'), 'watch', 'critical'),
  ('cafe-ops-office', 'Cafe Ops Office', 'operations_office', (SELECT id FROM public.ops_work_areas WHERE slug='maintenance'), 'operational', 'normal'),
  ('cabin-5-laundry', 'Cabin 5 Laundry & Maid Services', 'support_services', (SELECT id FROM public.ops_work_areas WHERE slug='housekeeping'), 'operational', 'normal')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  facility_type = EXCLUDED.facility_type,
  work_area_id = EXCLUDED.work_area_id,
  status = EXCLUDED.status,
  risk_level = EXCLUDED.risk_level,
  active = true;

INSERT INTO public.ops_vendors (name, vendor_type, phone, notes)
SELECT v.name, v.vendor_type, v.phone, v.notes
FROM (VALUES
  ('Summers Well Drilling', 'well_contractor', '479-736-2089', 'Closest well contractor in Colcord OK. Ask for Mason.'),
  ('Holman Pump & Well', 'well_contractor', '918-479-7867', 'Backup well contractor in Locust Grove.'),
  ('RAW', 'sponsor', NULL, 'Confirm product upkeep, restocking, signage, and contact.'),
  ('Oakley', 'sponsor', NULL, 'Confirm display maintenance, branding, and contact.'),
  ('Red Bull', 'sponsor', NULL, 'Confirm active sponsorship and restocking schedule.'),
  ('C4', 'sponsor', NULL, 'Confirm decal artwork, branding scope, and upkeep contact.')
) AS v(name, vendor_type, phone, notes)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ops_vendors existing
  WHERE lower(existing.name) = lower(v.name)
    AND coalesce(existing.vendor_type, '') = coalesce(v.vendor_type, '')
);

UPDATE public.ops_vendors existing
SET phone = coalesce(existing.phone, v.phone),
    notes = coalesce(existing.notes, v.notes),
    active = true
FROM (VALUES
  ('Summers Well Drilling', 'well_contractor', '479-736-2089', 'Closest well contractor in Colcord OK. Ask for Mason.'),
  ('Holman Pump & Well', 'well_contractor', '918-479-7867', 'Backup well contractor in Locust Grove.'),
  ('RAW', 'sponsor', NULL, 'Confirm product upkeep, restocking, signage, and contact.'),
  ('Oakley', 'sponsor', NULL, 'Confirm display maintenance, branding, and contact.'),
  ('Red Bull', 'sponsor', NULL, 'Confirm active sponsorship and restocking schedule.'),
  ('C4', 'sponsor', NULL, 'Confirm decal artwork, branding scope, and upkeep contact.')
) AS v(name, vendor_type, phone, notes)
WHERE lower(existing.name) = lower(v.name)
  AND coalesce(existing.vendor_type, '') = coalesce(v.vendor_type, '');

INSERT INTO public.ops_assets (name, asset_type, facility_id, status, notes, owner_team_slug, meter_label, next_service_at)
SELECT a.name, a.asset_type, a.facility_id, a.status, a.notes, a.owner_team_slug, a.meter_label, a.next_service_at
FROM (VALUES
  ('Ranger 1500', 'vehicle', NULL::uuid, 'needs_diagnostic', 'Suspected transmission issue.', 'transportation', 'hours', now() + interval '30 days'),
  ('Radio Repeater System', 'communications', NULL::uuid, 'pending_install', 'Lift and coverage test required.', 'security', NULL, now() + interval '7 days'),
  ('Dome Cold Plunges', 'recovery', (SELECT id FROM public.ops_facilities WHERE slug='dome'), 'operational', 'Drain, clean, refill, and treatment logs required.', 'maintenance', NULL, now() + interval '7 days'),
  ('PLC HVAC Unit', 'hvac', (SELECT id FROM public.ops_facilities WHERE slug='plc'), 'watch', 'Correct 2-inch filter and monitoring schedule needed.', 'maintenance', NULL, now() + interval '14 days')
) AS a(name, asset_type, facility_id, status, notes, owner_team_slug, meter_label, next_service_at)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ops_assets existing
  WHERE lower(existing.name) = lower(a.name)
    AND coalesce(existing.asset_type, '') = coalesce(a.asset_type, '')
);

UPDATE public.ops_assets existing
SET facility_id = coalesce(existing.facility_id, a.facility_id),
    status = a.status,
    notes = coalesce(existing.notes, a.notes),
    owner_team_slug = coalesce(existing.owner_team_slug, a.owner_team_slug),
    meter_label = coalesce(existing.meter_label, a.meter_label),
    next_service_at = coalesce(existing.next_service_at, a.next_service_at),
    active = true
FROM (VALUES
  ('Ranger 1500', 'vehicle', NULL::uuid, 'needs_diagnostic', 'Suspected transmission issue.', 'transportation', 'hours', now() + interval '30 days'),
  ('Radio Repeater System', 'communications', NULL::uuid, 'pending_install', 'Lift and coverage test required.', 'security', NULL, now() + interval '7 days'),
  ('Dome Cold Plunges', 'recovery', (SELECT id FROM public.ops_facilities WHERE slug='dome'), 'operational', 'Drain, clean, refill, and treatment logs required.', 'maintenance', NULL, now() + interval '7 days'),
  ('PLC HVAC Unit', 'hvac', (SELECT id FROM public.ops_facilities WHERE slug='plc'), 'watch', 'Correct 2-inch filter and monitoring schedule needed.', 'maintenance', NULL, now() + interval '14 days')
) AS a(name, asset_type, facility_id, status, notes, owner_team_slug, meter_label, next_service_at)
WHERE lower(existing.name) = lower(a.name)
  AND coalesce(existing.asset_type, '') = coalesce(a.asset_type, '');

INSERT INTO public.ops_recurring_maintenance (title, work_area_id, facility_id, asset_id, cadence, next_due_at, priority, instructions)
SELECT pm.title, pm.work_area_id, pm.facility_id, pm.asset_id, pm.cadence, pm.next_due_at, pm.priority, pm.instructions
FROM (VALUES
  (
    'Ranger 1500 diagnostic and service check',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'vehicles'),
    NULL::uuid,
    (SELECT id FROM public.ops_assets WHERE name = 'Ranger 1500' LIMIT 1),
    'Every 30 days or when symptoms appear',
    now() + interval '7 days',
    'P1',
    'Check transmission behavior, fluids, tires, brakes, and document meter reading.'
  ),
  (
    'PLC HVAC filter and wiring inspection',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'),
    (SELECT id FROM public.ops_facilities WHERE slug = 'plc'),
    (SELECT id FROM public.ops_assets WHERE name = 'PLC HVAC Unit' LIMIT 1),
    'Monthly',
    now() + interval '14 days',
    'P2',
    'Verify correct 2-inch filter size, inspect wiring, and log service notes.'
  ),
  (
    'Dome cold plunge drain, clean, refill, and treatment',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'),
    (SELECT id FROM public.ops_facilities WHERE slug = 'dome'),
    (SELECT id FROM public.ops_assets WHERE name = 'Dome Cold Plunges' LIMIT 1),
    'Weekly',
    now() + interval '7 days',
    'P2',
    'Drain, clean, refill, add treatment, and confirm water condition.'
  ),
  (
    'Radio repeater battery and coverage check',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'comms'),
    NULL::uuid,
    (SELECT id FROM public.ops_assets WHERE name = 'Radio Repeater System' LIMIT 1),
    'Weekly',
    now() + interval '7 days',
    'P2',
    'Confirm repeater health, battery condition, and field radio coverage.'
  )
) AS pm(title, work_area_id, facility_id, asset_id, cadence, next_due_at, priority, instructions)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ops_recurring_maintenance existing
  WHERE existing.title = pm.title
);

UPDATE public.ops_recurring_maintenance existing
SET work_area_id = pm.work_area_id,
    facility_id = pm.facility_id,
    asset_id = pm.asset_id,
    cadence = pm.cadence,
    next_due_at = coalesce(existing.next_due_at, pm.next_due_at),
    priority = pm.priority,
    instructions = pm.instructions,
    active = true
FROM (VALUES
  (
    'Ranger 1500 diagnostic and service check',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'vehicles'),
    NULL::uuid,
    (SELECT id FROM public.ops_assets WHERE name = 'Ranger 1500' LIMIT 1),
    'Every 30 days or when symptoms appear',
    now() + interval '7 days',
    'P1',
    'Check transmission behavior, fluids, tires, brakes, and document meter reading.'
  ),
  (
    'PLC HVAC filter and wiring inspection',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'),
    (SELECT id FROM public.ops_facilities WHERE slug = 'plc'),
    (SELECT id FROM public.ops_assets WHERE name = 'PLC HVAC Unit' LIMIT 1),
    'Monthly',
    now() + interval '14 days',
    'P2',
    'Verify correct 2-inch filter size, inspect wiring, and log service notes.'
  ),
  (
    'Dome cold plunge drain, clean, refill, and treatment',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'),
    (SELECT id FROM public.ops_facilities WHERE slug = 'dome'),
    (SELECT id FROM public.ops_assets WHERE name = 'Dome Cold Plunges' LIMIT 1),
    'Weekly',
    now() + interval '7 days',
    'P2',
    'Drain, clean, refill, add treatment, and confirm water condition.'
  ),
  (
    'Radio repeater battery and coverage check',
    (SELECT id FROM public.ops_work_areas WHERE slug = 'comms'),
    NULL::uuid,
    (SELECT id FROM public.ops_assets WHERE name = 'Radio Repeater System' LIMIT 1),
    'Weekly',
    now() + interval '7 days',
    'P2',
    'Confirm repeater health, battery condition, and field radio coverage.'
  )
) AS pm(title, work_area_id, facility_id, asset_id, cadence, next_due_at, priority, instructions)
WHERE existing.title = pm.title;

INSERT INTO public.ops_grounds_zones (slug, name, zone_type, facility_id, priority, notes)
VALUES
  ('front-entrance', 'Front Entrance', 'landscape', NULL, 'P2', 'First impression area, signage, flagpole, and mailbox approach.'),
  ('campus-roads', 'Campus Roads', 'roads', NULL, 'P1', 'Low road, parking hill, cabin road, drainage, grading, gravel, and culverts.'),
  ('dome-exterior', 'Dome Exterior', 'facility_exterior', (SELECT id FROM public.ops_facilities WHERE slug = 'dome'), 'P2', 'Dome tarp, exterior cleanup, and recovery area grounds.'),
  ('cabin-grounds', 'Cabin Grounds', 'residential_exterior', (SELECT id FROM public.ops_facilities WHERE slug = 'barracks-cabins'), 'P2', 'Mowing, weed eating, drainage, and cabin exterior readiness.'),
  ('op-cabins-grounds', 'OP Cabin Grounds', 'residential_exterior', (SELECT id FROM public.ops_facilities WHERE slug = 'op-cabins'), 'P2', 'VIP cabin exterior, water issues, and guest readiness.')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  zone_type = EXCLUDED.zone_type,
  facility_id = EXCLUDED.facility_id,
  priority = EXCLUDED.priority,
  notes = EXCLUDED.notes,
  active = true;

INSERT INTO public.ops_grounds_routines (zone_id, title, routine_type, cadence, season, next_due_at, instructions)
VALUES
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'front-entrance'), 'Mow and edge front entrance', 'mowing', 'Weekly', 'Growing season', now() + interval '7 days', 'Mow, edge, clear debris, and inspect sign/flag area.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'front-entrance'), 'Mailbox and signage check', 'inspection', 'Weekly', 'All year', now() + interval '7 days', 'Confirm mailbox is secure, visible, and accessible.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'campus-roads'), 'Road grading and washout check', 'grading', 'Monthly and after heavy rain', 'All year', now() + interval '30 days', 'Inspect low road, parking hill, cabin road, culverts, and gravel needs.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'campus-roads'), 'Culvert and drainage check', 'drainage', 'After heavy rain', 'All year', now() + interval '14 days', 'Check flow paths, blocked culverts, standing water, and erosion.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'dome-exterior'), 'Dome exterior weed eating and debris removal', 'weed_eating', 'Weekly', 'Growing season', now() + interval '7 days', 'Trim exterior, remove debris, and report tarp/electrical hazards.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'cabin-grounds'), 'Cabin grounds mowing and weed eating', 'mowing', 'Weekly', 'Growing season', now() + interval '7 days', 'Prioritize student-facing walkways and cabin entrances.'),
  ((SELECT id FROM public.ops_grounds_zones WHERE slug = 'op-cabins-grounds'), 'OP cabin exterior readiness check', 'inspection', 'Weekly', 'All year', now() + interval '7 days', 'Inspect water/sulfur issues, walkways, guest approach, and exterior cleanliness.')
ON CONFLICT (zone_id, title) DO UPDATE SET
  routine_type = EXCLUDED.routine_type,
  cadence = EXCLUDED.cadence,
  season = EXCLUDED.season,
  next_due_at = coalesce(public.ops_grounds_routines.next_due_at, EXCLUDED.next_due_at),
  instructions = EXCLUDED.instructions,
  active = true;

INSERT INTO public.ops_projects (slug, name, project_type, work_area_id, facility_id, owner_team_slug, status, priority, target_date, budget_estimate, scope)
VALUES
  ('dome-electrical-tarp-cold-plunge', 'Dome electrical, tarp, and cold plunge readiness', 'facility_project', (SELECT id FROM public.ops_work_areas WHERE slug = 'maintenance'), (SELECT id FROM public.ops_facilities WHERE slug = 'dome'), 'maintenance', 'active', 'P1', current_date + 14, NULL, 'Remove tarp, confirm electrical scope, and keep cold plunges clean and operational.'),
  ('radio-repeater-install', 'Radio repeater install and coverage validation', 'communications', (SELECT id FROM public.ops_work_areas WHERE slug = 'comms'), NULL, 'security', 'planning', 'P1', current_date + 14, NULL, 'Lift, install, assign personnel radios, and test coverage across campus.'),
  ('fire-red-tag-corrections', 'Fire inspection red tag corrections', 'safety', (SELECT id FROM public.ops_work_areas WHERE slug = 'safety'), (SELECT id FROM public.ops_facilities WHERE slug = 'plc'), 'ops', 'active', 'P0', current_date + 7, NULL, 'Resolve PLC and Homefront fire inspection red tags and document verification.'),
  ('water-sulfur-treatment', 'Water sulfur treatment and well contractor path', 'infrastructure', (SELECT id FROM public.ops_work_areas WHERE slug = 'water'), (SELECT id FROM public.ops_facilities WHERE slug = 'op-cabins'), 'maintenance', 'planning', 'P1', current_date + 21, NULL, 'Confirm treatment approach, vendor path, and recurring water quality checks.')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  project_type = EXCLUDED.project_type,
  work_area_id = EXCLUDED.work_area_id,
  facility_id = EXCLUDED.facility_id,
  owner_team_slug = EXCLUDED.owner_team_slug,
  status = EXCLUDED.status,
  priority = EXCLUDED.priority,
  target_date = EXCLUDED.target_date,
  scope = EXCLUDED.scope,
  active = true;

INSERT INTO public.ops_project_milestones (project_id, title, description, status, due_date, sort_order)
VALUES
  ((SELECT id FROM public.ops_projects WHERE slug = 'dome-electrical-tarp-cold-plunge'), 'Confirm electrical scope', 'Identify vendor or internal owner and required materials.', 'open', current_date + 5, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'dome-electrical-tarp-cold-plunge'), 'Remove tarp and clear exterior hazards', 'Remove tarp, inspect exterior, and create work orders for hazards.', 'open', current_date + 7, 20),
  ((SELECT id FROM public.ops_projects WHERE slug = 'radio-repeater-install'), 'Schedule lift and install window', 'Coordinate lift, install crew, and downtime window.', 'open', current_date + 5, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'radio-repeater-install'), 'Coverage test and radio assignments', 'Test campus coverage and document assigned radios.', 'open', current_date + 10, 20),
  ((SELECT id FROM public.ops_projects WHERE slug = 'fire-red-tag-corrections'), 'Collect inspection findings', 'Attach red tag photos and inspection notes.', 'open', current_date + 2, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'fire-red-tag-corrections'), 'Verify corrective actions', 'Safety lead verifies before closeout.', 'open', current_date + 7, 20),
  ((SELECT id FROM public.ops_projects WHERE slug = 'water-sulfur-treatment'), 'Choose vendor path', 'Call listed well vendors and capture recommendation.', 'open', current_date + 7, 10),
  ((SELECT id FROM public.ops_projects WHERE slug = 'water-sulfur-treatment'), 'Create recurring water quality check', 'Turn treatment decision into recurring PM.', 'open', current_date + 14, 20)
ON CONFLICT (project_id, title) DO UPDATE SET
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  due_date = EXCLUDED.due_date,
  sort_order = EXCLUDED.sort_order;

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('work-order-attachments', 'work-order-attachments', true),
  ('ops-source-documents', 'ops-source-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Quick verification output.
SELECT
  to_regclass('public.ops_assets') AS ops_assets_table,
  to_regclass('public.ops_recurring_maintenance') AS ops_pm_table,
  to_regclass('public.ops_projects') AS ops_projects_table,
  to_regclass('public.ops_grounds_routines') AS ops_grounds_routines_table;

-- ============================================================
-- SOURCE: 041_walmart_skillbridge_pilot.sql
-- ============================================================
-- Walmart SkillBridge pilot contracts for UHP-OPS staff controls and student-app consumption.
-- HubSpot remains read-only; these tables are written only by UHP-OPS/Supabase.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.sis_students
  ADD COLUMN IF NOT EXISTS uhp_student_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sis_students_uhp_student_id
  ON public.sis_students(uhp_student_id)
  WHERE uhp_student_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_uhp_student_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.uhp_student_id IS NULL OR NEW.uhp_student_id = '' THEN
    NEW.uhp_student_id := 'UHP-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_uhp_student_id ON public.sis_students;
CREATE TRIGGER trg_assign_uhp_student_id
BEFORE INSERT OR UPDATE ON public.sis_students
FOR EACH ROW EXECUTE FUNCTION public.assign_uhp_student_id();

UPDATE public.sis_students
SET uhp_student_id = 'UHP-' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE uhp_student_id IS NULL OR uhp_student_id = '';

CREATE TABLE IF NOT EXISTS public.student_identity_links (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES public.sis_students(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  external_email text,
  link_type text NOT NULL DEFAULT 'walmart_skillbridge',
  verified boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(provider, external_id)
);

CREATE TABLE IF NOT EXISTS public.walmart_candidates (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid REFERENCES public.sis_students(id) ON DELETE SET NULL,
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  onboarding_email text NOT NULL UNIQUE,
  hubspot_contact_id text,
  hubspot_deal_id text,
  full_name text,
  status text NOT NULL DEFAULT 'identified' CHECK (status IN ('identified','linked','active','blocked','completed','withdrawn')),
  readiness_blockers jsonb DEFAULT '[]'::jsonb,
  hubspot_snapshot jsonb DEFAULT '{}'::jsonb,
  linked_by uuid REFERENCES public.user_profiles(id),
  linked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walmart_schedule_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cohort_id uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,
  program_session_id uuid REFERENCES public.program_sessions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  notes text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  location_name text,
  building text,
  room text,
  facilitator_name text,
  instructor_name text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled','archived')),
  cancelled_at timestamptz,
  what_to_bring text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walmart_quizzes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  pass_threshold numeric NOT NULL DEFAULT 80,
  max_attempts int NOT NULL DEFAULT 2,
  retake_wait_hours int NOT NULL DEFAULT 24,
  trades_competency text NOT NULL DEFAULT 'General',
  source_format text,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walmart_quiz_questions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES public.walmart_quizzes(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'short_answer',
  choices jsonb DEFAULT '[]'::jsonb,
  answer_key text,
  points numeric DEFAULT 1,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walmart_quiz_imports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid REFERENCES public.walmart_quizzes(id) ON DELETE SET NULL,
  source_name text,
  source_format text,
  raw_text text,
  parsed_count int DEFAULT 0,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','parsed','needs_review','failed')),
  errors jsonb DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.user_profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.walmart_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES public.walmart_quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.sis_students(id) ON DELETE CASCADE,
  score numeric,
  best_score numeric,
  passed boolean,
  attempt_number int NOT NULL DEFAULT 1,
  max_attempts_snapshot int NOT NULL DEFAULT 2,
  retakes_remaining int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  submitted_at timestamptz DEFAULT now(),
  answers jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.walmart_quiz_attempt_controls (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  quiz_id uuid NOT NULL REFERENCES public.walmart_quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.sis_students(id) ON DELETE CASCADE,
  retake_unlocked_until timestamptz,
  staff_override boolean DEFAULT false,
  override_reason text,
  updated_by uuid REFERENCES public.user_profiles(id),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(student_id, quiz_id)
);

CREATE TABLE IF NOT EXISTS public.walmart_nccer_documents (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id uuid REFERENCES public.walmart_candidates(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.sis_students(id) ON DELETE SET NULL,
  document_type text NOT NULL DEFAULT 'NCCER/testing document',
  file_name text NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','pending_review','approved','rejected','replacement_requested')),
  notes text,
  uploaded_by uuid REFERENCES public.user_profiles(id),
  reviewed_by uuid REFERENCES public.user_profiles(id),
  uploaded_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('walmart-nccer-docs', 'walmart-nccer-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_walmart_candidates_student ON public.walmart_candidates(student_id);
CREATE INDEX IF NOT EXISTS idx_walmart_schedule_cohort_start ON public.walmart_schedule_sessions(cohort_id, start_time);
CREATE INDEX IF NOT EXISTS idx_walmart_quizzes_status ON public.walmart_quizzes(status);
CREATE INDEX IF NOT EXISTS idx_walmart_questions_quiz ON public.walmart_quiz_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_walmart_attempts_student_quiz ON public.walmart_quiz_attempts(student_id, quiz_id);
CREATE INDEX IF NOT EXISTS idx_walmart_docs_student ON public.walmart_nccer_documents(student_id);

ALTER TABLE public.student_identity_links DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_candidates DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_schedule_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_quizzes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_quiz_questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_quiz_imports DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_quiz_attempts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_quiz_attempt_controls DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.walmart_nccer_documents DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- SOURCE: 042_walmart_trade_school_fields.sql
-- ============================================================
-- Walmart SkillBridge trade-school fields sourced from HubSpot read-only data.

ALTER TABLE public.walmart_candidates
  ADD COLUMN IF NOT EXISTS trade_school text,
  ADD COLUMN IF NOT EXISTS trade_track text;

CREATE INDEX IF NOT EXISTS idx_walmart_candidates_trade_track
  ON public.walmart_candidates(trade_track);

-- ============================================================
-- SOURCE: 043_morgan_ops_command_center.sql
-- ============================================================
-- ============================================================
-- MORGAN OPS COMMAND CENTER
-- Staff tasks, action previews, and assignment audit trail.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','blocked','completed','cancelled')),
  priority text NOT NULL DEFAULT 'P3' CHECK (priority IN ('P0','P1','P2','P3','P4')),
  assigned_to uuid REFERENCES public.user_profiles(id),
  assigned_team_slug text,
  requested_by uuid REFERENCES public.user_profiles(id),
  created_by uuid REFERENCES public.user_profiles(id),
  source_type text NOT NULL DEFAULT 'morgan',
  source_id uuid,
  source_ref text,
  due_at timestamptz,
  completed_by uuid REFERENCES public.user_profiles(id),
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.morgan_action_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_by uuid REFERENCES public.user_profiles(id),
  actor text,
  staff_email text,
  team_slug text,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','needs_clarification','confirmed','cancelled','failed','expired')),
  source_text text NOT NULL,
  preview_summary text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_response jsonb,
  error text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ops_grounds_routines
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_completed_at timestamptz;

ALTER TABLE public.ops_recurring_maintenance
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES public.user_profiles(id),
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.ops_assets
  ADD COLUMN IF NOT EXISTS vaultiq_product_id text,
  ADD COLUMN IF NOT EXISTS external_ref text;

CREATE INDEX IF NOT EXISTS idx_staff_tasks_assigned_to ON public.staff_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_assigned_team ON public.staff_tasks(assigned_team_slug);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_status_due ON public.staff_tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_staff_tasks_source ON public.staff_tasks(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_morgan_action_requests_status ON public.morgan_action_requests(status);
CREATE INDEX IF NOT EXISTS idx_morgan_action_requests_requested ON public.morgan_action_requests(requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_grounds_routines_assigned_user ON public.ops_grounds_routines(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_ops_pm_assigned_user ON public.ops_recurring_maintenance(assigned_user_id);

ALTER TABLE public.staff_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.morgan_action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_tasks_service_role_all" ON public.staff_tasks;
CREATE POLICY "staff_tasks_service_role_all"
  ON public.staff_tasks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "morgan_action_requests_service_role_all" ON public.morgan_action_requests;
CREATE POLICY "morgan_action_requests_service_role_all"
  ON public.morgan_action_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- SOURCE: 044_sync_intake_fields.sql
-- ============================================================
-- ============================================================
-- 041 — Sync intake fields onto sis_students
-- Adds the records-only columns the HubSpot sync needs to land
-- each accepted student's full intake. Additive + idempotent.
--
-- Verified against the LIVE database (not migration history): these
-- six columns are the only ones missing. Everything else the sync
-- writes (emergency_contact_*, dietary_flags, health_disclosures,
-- photo_url, hubspot_contact_id, hubspot_deal_id) already exists, and
-- the rich intake JSONB lives on student_intake.
-- ============================================================

ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS sex text;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS home_address text;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS home_city text;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS home_state text;
ALTER TABLE sis_students ADD COLUMN IF NOT EXISTS home_postal_code text;

-- ============================================================
-- SOURCE: 044_uhp_requests_target_team.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Inbox routing (Phase 1 of Workspace direction)
-- Adds team routing to uhp_requests so cross-team intake can
-- be filtered per team. Pairs with the Help Queue → Inbox rename
-- and team-filtered view on /requests/backlog.
--
-- No backfill in this migration. Existing rows stay null. The UI
-- treats null as "unrouted" and surfaces them to admins for triage.
-- Backfill (heuristic from submitted_by email domain, or manual)
-- is intentionally separated so it can be reviewed independently.
-- ============================================================

ALTER TABLE public.uhp_requests
  ADD COLUMN IF NOT EXISTS target_team_slug text;

CREATE INDEX IF NOT EXISTS idx_uhp_requests_target_team
  ON public.uhp_requests(target_team_slug);

-- ============================================================
-- SOURCE: 045_intake_manual_edit.sql
-- ============================================================
-- ============================================================
-- 045 — Protect staff edits from the HubSpot sync
--
-- The HubSpot sync (lib/hubspot.ts upsertAcceptedStudentIntake) and the
-- intake webhook only skip rows where completed_at is set. Now that staff
-- can edit a student's full record in the OPS app (the staff editor at
-- /students/[id]/edit), those edits need the same protection so the next
-- sync doesn't clobber them.
--
-- manually_edited_at  — set whenever staff save the editor; the sync skip-guard
--                       honors it exactly like completed_at.
-- manually_edited_by  — the auth user id of the staff member who last edited
--                       (no FK so a missing user_profiles row can't block a save).
--
-- Additive + idempotent. Verified against the LIVE schema: both columns are
-- absent on student_intake today.
-- ============================================================

ALTER TABLE public.student_intake ADD COLUMN IF NOT EXISTS manually_edited_at timestamptz;
ALTER TABLE public.student_intake ADD COLUMN IF NOT EXISTS manually_edited_by uuid;

CREATE INDEX IF NOT EXISTS idx_intake_manual_edit
  ON public.student_intake(manually_edited_at)
  WHERE manually_edited_at IS NOT NULL;

-- ============================================================
-- SOURCE: 045_reference_data_seeds.sql
-- ============================================================
-- ============================================================
-- 045_reference_data_seeds.sql
--
-- Adds seed data that was missing from migrations, covering:
--   1. programs            (previously only in loose supabase/035_programs_lookup.sql)
--   2. partner_programs    (no CREATE TABLE in migrations; table was built ad-hoc)
--   3. field_equipment     (no CREATE TABLE in migrations; table was built ad-hoc)
--   4. field_procedures    (no CREATE TABLE in migrations; table was built ad-hoc)
--   5. field_procedure_steps (no CREATE TABLE in migrations; table was built ad-hoc)
--   6. onboarding_templates  + onboarding_template_items for Patriot program
--      (migration 027 seeded CPT/IHC/CNC/Trades; Patriot was added later)
--
-- All operations are idempotent: safe to run against staging (data already present)
-- and against a fresh local DB (will create tables and insert fresh rows).
-- ============================================================


-- ============================================================
-- 1. programs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.programs (
  code          TEXT        PRIMARY KEY,
  display_name  TEXT        NOT NULL,
  hubspot_value TEXT        UNIQUE,
  team_slug     TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_hubspot_value ON public.programs(hubspot_value);
CREATE INDEX IF NOT EXISTS idx_programs_team_slug     ON public.programs(team_slug);

ALTER TABLE public.programs DISABLE ROW LEVEL SECURITY;

INSERT INTO public.programs (code, display_name, hubspot_value, team_slug) VALUES
  ('CPT',        'Certified Personal Trainer', 'Certified Personal Training (CPT)', 'health'),
  ('IHC',        'Integrative Health Coach',   'Integrative Health Course (IHC)',   'health'),
  ('CNC',        'Culinary Nutrition Coach',   'Culinary Nutrition Coach (CNC)',    'culinary'),
  ('Patriot',    'Patriot Pathway',            NULL,                                'health'),
  ('Trades',     'Trades',                     NULL,                                'trades'),
  ('Leadership', 'Leadership',                 NULL,                                'ops'),
  ('Corporate',  'Corporate',                  NULL,                                'ops')
ON CONFLICT (code) DO NOTHING;

-- Drop hardcoded CHECK so new programs can be added by row insert, not migration.
ALTER TABLE public.sis_enrollments DROP CONSTRAINT IF EXISTS sis_enrollments_program_check;

-- Align canonical code: templates may have stored 'Patriot Pathway' before the
-- programs table existed (035_programs_lookup.sql renamed them; re-apply here
-- for any fresh DB that skipped that loose file).
UPDATE public.onboarding_templates SET program = 'Patriot' WHERE program = 'Patriot Pathway';


-- ============================================================
-- 2. partner_programs
-- Table was created ad-hoc (no matching CREATE TABLE in migrations/).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.partner_programs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  partner_name TEXT        NOT NULL,
  go_live_date DATE,
  status       TEXT        NOT NULL DEFAULT 'planning',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.partner_programs DISABLE ROW LEVEL SECURITY;

INSERT INTO public.partner_programs (slug, name, partner_name, go_live_date, status) VALUES
  ('walmart-skillbridge', 'Walmart SkillBridge', 'Walmart', '2026-06-30', 'planning')
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- 3. field_equipment
-- Table was created ad-hoc. Adds de-duplication key so re-seeding is idempotent.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.field_equipment (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT        NOT NULL,
  equipment_type TEXT        NOT NULL,
  location       TEXT,
  manufacturer   TEXT,
  model_number   TEXT,
  serial_number  TEXT,
  qr_code_id     TEXT        UNIQUE DEFAULT (uuid_generate_v4())::text,
  photo_url      TEXT,
  active         BOOLEAN     DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Remove duplicate rows introduced by double-seeding before adding the constraint.
-- Keep the earliest (lowest id) copy for each (name, equipment_type) pair.
DELETE FROM public.field_equipment fe1
USING public.field_equipment fe2
WHERE fe1.id > fe2.id
  AND fe1.name = fe2.name
  AND fe1.equipment_type = fe2.equipment_type;

ALTER TABLE public.field_equipment
  ADD CONSTRAINT uq_field_equipment_name_type UNIQUE (name, equipment_type);

CREATE INDEX IF NOT EXISTS idx_field_equipment_type ON public.field_equipment(equipment_type);

ALTER TABLE public.field_equipment DISABLE ROW LEVEL SECURITY;

INSERT INTO public.field_equipment (name, equipment_type, location) VALUES
  ('Miter Saw',                'carpentry',  'Carpentry Bay'),
  ('Table Saw',                'carpentry',  'Carpentry Bay'),
  ('Conduit Bender',           'electrical', 'Electrical Bay'),
  ('Electrical Panel — Bay 1', 'electrical', 'Electrical Bay'),
  ('Multimeter Station',       'electrical', 'Electrical Bay'),
  ('HVAC Unit — Bay 1',        'hvac',       'HVAC Bay'),
  ('HVAC Unit — Bay 2',        'hvac',       'HVAC Bay'),
  ('PEX Crimping Station',     'plumbing',   'Plumbing Bay'),
  ('Pipe Threader',            'plumbing',   'Plumbing Bay'),
  ('MIG Welder — Station 1',   'welding',    'Welding Bay'),
  ('MIG Welder — Station 2',   'welding',    'Welding Bay'),
  ('Oxy-Acetylene Torch',      'welding',    'Welding Bay'),
  ('TIG Welder',               'welding',    'Welding Bay')
ON CONFLICT (name, equipment_type) DO NOTHING;


-- ============================================================
-- 4. field_procedures
-- Table was created ad-hoc. Adds de-duplication key so re-seeding is idempotent.
-- Cascade DELETE will also remove orphaned duplicate steps.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.field_procedures (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             TEXT        NOT NULL,
  description       TEXT,
  equipment_id      UUID        REFERENCES public.field_equipment(id),
  procedure_type    TEXT        NOT NULL,
  program           TEXT        NOT NULL DEFAULT 'Trades',
  difficulty        TEXT,
  estimated_minutes INTEGER,
  safety_warnings   TEXT[],
  tools_required    TEXT[],
  ppe_required      TEXT[],
  qr_code_id        TEXT        UNIQUE DEFAULT (uuid_generate_v4())::text,
  created_by        UUID        REFERENCES public.user_profiles(id),
  active            BOOLEAN     DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Remove duplicate rows before adding the constraint.
DELETE FROM public.field_procedures fp1
USING public.field_procedures fp2
WHERE fp1.id > fp2.id
  AND fp1.title = fp2.title
  AND fp1.procedure_type = fp2.procedure_type
  AND fp1.program = fp2.program;

ALTER TABLE public.field_procedures
  ADD CONSTRAINT uq_field_procedures_title_type_program
  UNIQUE (title, procedure_type, program);

CREATE INDEX IF NOT EXISTS idx_field_procedures_program      ON public.field_procedures(program);
CREATE INDEX IF NOT EXISTS idx_field_procedures_type         ON public.field_procedures(procedure_type);
CREATE INDEX IF NOT EXISTS idx_field_procedures_equipment_id ON public.field_procedures(equipment_id);

ALTER TABLE public.field_procedures DISABLE ROW LEVEL SECURITY;

INSERT INTO public.field_procedures
  (title, description, procedure_type, program, difficulty, estimated_minutes,
   safety_warnings, tools_required, ppe_required)
VALUES
  (
    'HVAC Filter Replacement',
    'Standard filter replacement procedure for residential HVAC units. Performed every 30-90 days depending on usage.',
    'maintenance', 'Trades', 'beginner', 15,
    ARRAY['Ensure unit is powered OFF before opening panel', 'Do not operate unit without filter installed'],
    ARRAY['Flathead screwdriver', 'New filter (check size label inside panel)'],
    ARRAY['Dust mask', 'Safety glasses']
  ),
  (
    'Outlet Replacement (15A Duplex)',
    'Replace a standard 15A duplex receptacle. De-energize the circuit, swap the device, verify polarity.',
    'maintenance', 'Trades', 'beginner', 20,
    ARRAY['Verify circuit is OFF with non-contact tester before touching wires', 'Lock out the breaker'],
    ARRAY['Flathead screwdriver', 'Phillips screwdriver', 'Voltage tester', 'New 15A duplex receptacle'],
    ARRAY['Safety glasses', 'Insulated gloves']
  ),
  (
    'PEX Crimp Connection',
    'Make a leak-tight PEX-to-fitting crimp using a copper crimp ring.',
    'installation', 'Trades', 'beginner', 15,
    ARRAY['Inspect crimp tool calibration before use'],
    ARRAY['PEX cutter', 'Crimp tool', 'Go/no-go gauge', 'Copper crimp rings', 'PEX fitting'],
    ARRAY['Safety glasses', 'Gloves']
  ),
  (
    'Miter Saw Crosscut',
    'Make a safe, accurate 90-degree crosscut on a 2x4 using a compound miter saw.',
    'safety_check', 'Trades', 'beginner', 10,
    ARRAY['Never reach across the blade path', 'Wait for blade to fully stop before lifting', 'Both hands clear of cut line'],
    ARRAY['Compound miter saw', 'Tape measure', 'Pencil', 'Square'],
    ARRAY['Safety glasses', 'Hearing protection', 'Dust mask']
  ),
  (
    'MIG Tack Weld (Mild Steel)',
    'Set up a MIG welder and lay 4 tack welds to fix two pieces of 1/8-inch mild steel.',
    'safety_check', 'Trades', 'intermediate', 25,
    ARRAY['Verify ventilation before striking arc', 'No flammables within 35 feet', 'Confirm ground clamp on workpiece, not bench'],
    ARRAY['MIG welder', 'Wire brush', 'Pliers', 'Chipping hammer', 'Magnetic squares'],
    ARRAY['Welding helmet (auto-darkening)', 'Welding jacket', 'Welding gloves', 'Steel-toe boots', 'Hearing protection']
  ),
  (
    'HVAC Capacitor Test',
    'Safely discharge and test a dual-run capacitor on a residential condenser.',
    'troubleshoot', 'Trades', 'intermediate', 20,
    ARRAY['Capacitors store lethal charge — discharge before touching terminals', 'Disconnect at the service before opening the access panel'],
    ARRAY['Insulated screwdriver with discharge resistor', 'Multimeter with capacitance setting', 'Phillips screwdriver'],
    ARRAY['Insulated gloves', 'Safety glasses']
  )
ON CONFLICT (title, procedure_type, program) DO NOTHING;


-- ============================================================
-- 5. field_procedure_steps
-- Table was created ad-hoc. Steps reference procedure_id looked up by
-- (title, procedure_type, program) which is now unique.
-- UNIQUE (procedure_id, step_number) already exists in DB; harmless if re-added.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.field_procedure_steps (
  id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  procedure_id                UUID        REFERENCES public.field_procedures(id) ON DELETE CASCADE,
  step_number                 INTEGER     NOT NULL,
  title                       TEXT        NOT NULL,
  instruction                 TEXT        NOT NULL,
  photo_url                   TEXT,
  video_url                   TEXT,
  is_safety_critical          BOOLEAN     DEFAULT FALSE,
  requires_confirmation       BOOLEAN     DEFAULT TRUE,
  checkpoint_note             TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  estimated_seconds           INTEGER,
  requires_instructor_signoff BOOLEAN     DEFAULT FALSE,
  UNIQUE (procedure_id, step_number)
);

ALTER TABLE public.field_procedure_steps DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  proc_hvac_filter  UUID;
  proc_outlet       UUID;
  proc_pex          UUID;
  proc_miter        UUID;
  proc_mig          UUID;
  proc_hvac_cap     UUID;
BEGIN
  SELECT id INTO proc_hvac_filter FROM public.field_procedures
    WHERE title = 'HVAC Filter Replacement'         AND procedure_type = 'maintenance'  AND program = 'Trades';
  SELECT id INTO proc_outlet      FROM public.field_procedures
    WHERE title = 'Outlet Replacement (15A Duplex)' AND procedure_type = 'maintenance'  AND program = 'Trades';
  SELECT id INTO proc_pex         FROM public.field_procedures
    WHERE title = 'PEX Crimp Connection'            AND procedure_type = 'installation' AND program = 'Trades';
  SELECT id INTO proc_miter       FROM public.field_procedures
    WHERE title = 'Miter Saw Crosscut'              AND procedure_type = 'safety_check' AND program = 'Trades';
  SELECT id INTO proc_mig         FROM public.field_procedures
    WHERE title = 'MIG Tack Weld (Mild Steel)'      AND procedure_type = 'safety_check' AND program = 'Trades';
  SELECT id INTO proc_hvac_cap    FROM public.field_procedures
    WHERE title = 'HVAC Capacitor Test'             AND procedure_type = 'troubleshoot' AND program = 'Trades';

  -- HVAC Filter Replacement (6 steps)
  INSERT INTO public.field_procedure_steps
    (procedure_id, step_number, title, instruction, is_safety_critical, requires_confirmation, requires_instructor_signoff, checkpoint_note, estimated_seconds)
  VALUES
    (proc_hvac_filter, 1, 'Power Off',              'Locate the thermostat or power switch and turn the HVAC unit completely OFF. Verify the unit has stopped running before proceeding.',                                                                       true,  true, false, 'Confirm unit is not running — no fan noise, no airflow',                            NULL),
    (proc_hvac_filter, 2, 'Locate Filter Panel',    'Find the filter access panel on the unit. It is typically on the return air side — look for a panel with a handle or screws on the lower portion of the air handler.',                                    false, true, false, 'Panel should open easily — do not force it',                                        NULL),
    (proc_hvac_filter, 3, 'Remove Old Filter',      'Open the panel and slide out the old filter. Note the direction of the airflow arrow printed on the filter — your new filter must face the same direction.',                                              false, true, false, 'Check the size printed on the filter frame before disposing',                       NULL),
    (proc_hvac_filter, 4, 'Inspect Filter Housing', 'Before installing the new filter, inspect the housing for dust buildup, debris, or damage. Wipe down the housing with a dry cloth if needed.',                                                           false, true, false, 'Housing should be clean and free of obstructions',                                  NULL),
    (proc_hvac_filter, 5, 'Install New Filter',     'Slide the new filter into the housing with the airflow arrow pointing toward the unit (into the return air path). The filter should fit snugly with no gaps around the edges.',                          false, true, false, 'No gaps around filter edges — gaps allow unfiltered air to bypass the filter',      NULL),
    (proc_hvac_filter, 6, 'Close Panel and Power On','Close the access panel securely. Return to the thermostat and power the unit back ON. Verify normal operation — you should hear the fan start and feel airflow from vents.',                            true,  true, false, 'Confirm airflow at vents before leaving the unit',                                  NULL)
  ON CONFLICT (procedure_id, step_number) DO NOTHING;

  -- Outlet Replacement 15A Duplex (6 steps)
  INSERT INTO public.field_procedure_steps
    (procedure_id, step_number, title, instruction, is_safety_critical, requires_confirmation, requires_instructor_signoff, checkpoint_note, estimated_seconds)
  VALUES
    (proc_outlet, 1, 'Lock Out Breaker',             'Locate the breaker for the outlet. Switch it OFF. Apply a lockout tag.',                                                                                          true,  true, true,  'Tester reads zero at the outlet',                                          120),
    (proc_outlet, 2, 'Verify No Voltage',            'With a non-contact voltage tester, confirm the outlet is dead on both halves.',                                                                                   true,  true, false, 'Tester silent on every contact',                                            60),
    (proc_outlet, 3, 'Remove Cover and Receptacle',  'Unscrew the wall plate, then unscrew the receptacle from the box. Pull it forward.',                                                                              false, true, false, NULL,                                                                        90),
    (proc_outlet, 4, 'Note Wiring',                  'Photograph the wiring before disconnecting. Hot to brass, neutral to silver, ground to green.',                                                                   false, true, false, NULL,                                                                        60),
    (proc_outlet, 5, 'Transfer Wires',               'Move each wire from the old device to the matching terminal on the new device. Tighten to spec.',                                                                 false, true, false, 'All terminal screws fully tight, no copper visible past the screw',        180),
    (proc_outlet, 6, 'Reinstall and Test',            'Push the device back into the box, screw it in, replace the wall plate. Restore power and test with a plug-in tester.',                                         true,  true, true,  'Plug-in tester shows correct polarity and ground',                         120)
  ON CONFLICT (procedure_id, step_number) DO NOTHING;

  -- PEX Crimp Connection (6 steps)
  INSERT INTO public.field_procedure_steps
    (procedure_id, step_number, title, instruction, is_safety_critical, requires_confirmation, requires_instructor_signoff, checkpoint_note, estimated_seconds)
  VALUES
    (proc_pex, 1, 'Square Cut',                'Cut the PEX with a PEX cutter. The cut must be square and clean — no burrs.',                                                              false, true, false, NULL,                                                    45),
    (proc_pex, 2, 'Slide Crimp Ring',          'Slide a copper crimp ring onto the PEX, leaving about 1/8 inch from the end.',                                                             false, true, false, NULL,                                                    30),
    (proc_pex, 3, 'Insert Fitting',            'Push the fitting fully into the PEX until it bottoms out. The PEX should cover the full insertion depth.',                                 false, true, false, NULL,                                                    30),
    (proc_pex, 4, 'Position Ring',             'Slide the crimp ring up so the front edge is 1/8 to 1/4 inch from the end of the PEX.',                                                   false, true, false, NULL,                                                    30),
    (proc_pex, 5, 'Crimp',                     'Place the crimp tool around the ring perpendicular to the PEX. Squeeze the handles fully closed in one motion.',                          false, true, false, 'Tool releases automatically — do not over-pump',         45),
    (proc_pex, 6, 'Verify with Go/No-Go Gauge','Slide the go/no-go gauge over the crimp. The crimped side must pass; the no-go side must not.',                                            false, true, true,  'Pass on go side, fail on no-go side',                   45)
  ON CONFLICT (procedure_id, step_number) DO NOTHING;

  -- Miter Saw Crosscut (6 steps)
  INSERT INTO public.field_procedure_steps
    (procedure_id, step_number, title, instruction, is_safety_critical, requires_confirmation, requires_instructor_signoff, checkpoint_note, estimated_seconds)
  VALUES
    (proc_miter, 1, 'Inspect Saw',        'Check that the blade guard moves freely, the blade is sharp and straight, and the table is clean.',                          true,  true, false, 'Guard returns under spring tension',                    60),
    (proc_miter, 2, 'Mark the Cut',       'Measure and mark the cut line on the workpiece. Use a square to extend the line across the face.',                           false, true, false, NULL,                                                    60),
    (proc_miter, 3, 'Position Workpiece', 'Place the 2x4 firmly against the fence. Align the mark with the kerf indicator.',                                            true,  true, false, 'Workpiece flush against fence, no gap',                 45),
    (proc_miter, 4, 'Hold Down',          'Hold the workpiece firmly with your off-hand at least 6 inches from the blade path.',                                        true,  true, false, NULL,                                                    15),
    (proc_miter, 5, 'Cut',                'Squeeze the trigger. Let the blade reach full speed before lowering it through the wood. Cut steadily — do not force it.',  true,  true, true,  'Both hands clear, blade at full speed before contact',  30),
    (proc_miter, 6, 'Stop and Lift',      'Release the trigger. Wait for the blade to fully stop before lifting the saw or moving the workpiece.',                      true,  true, false, 'Blade fully stopped — no spin',                         30)
  ON CONFLICT (procedure_id, step_number) DO NOTHING;

  -- MIG Tack Weld Mild Steel (8 steps)
  INSERT INTO public.field_procedure_steps
    (procedure_id, step_number, title, instruction, is_safety_critical, requires_confirmation, requires_instructor_signoff, checkpoint_note, estimated_seconds)
  VALUES
    (proc_mig, 1, 'PPE Check',       'Don welding helmet, jacket, gloves, boots. No bare skin showing. No synthetics.',                                                         true,  true, true,  'Instructor confirms PPE complete',              120),
    (proc_mig, 2, 'Workpiece Prep',  'Wire-brush both pieces at the joint until shiny metal shows. Mill scale and rust will ruin the weld.',                                    false, true, false, NULL,                                             120),
    (proc_mig, 3, 'Setup Joint',     'Position the two pieces in a tee or butt joint with magnetic squares. Tight fit-up.',                                                      false, true, false, 'Joint gap under 1/16 inch',                     120),
    (proc_mig, 4, 'Ground Clamp',    'Attach the ground clamp directly to the workpiece, not the welding table.',                                                                true,  true, false, 'Ground reads continuity to workpiece',           45),
    (proc_mig, 5, 'Set Machine',     'For 1/8 mild steel: ~18-19V, ~250 IPM wire feed, 75/25 gas at 20-25 CFH. Confirm with chart on machine.',                                 false, true, false, NULL,                                             90),
    (proc_mig, 6, 'Strike Tack 1',   'Helmet down. Strike a 1-second tack at one end of the joint. Hold gun at 45 degrees, 3/8 inch stickout.',                                true,  true, false, NULL,                                             30),
    (proc_mig, 7, 'Strike Tacks 2-4','Tack the opposite end first to control distortion, then the two midpoints.',                                                              true,  true, true,  'Four uniform tacks, no porosity',                120),
    (proc_mig, 8, 'Cool and Inspect','Let the workpiece cool. Chip and brush the tacks. Check for cracks, undercut, or lack of fusion.',                                        false, true, false, NULL,                                             120)
  ON CONFLICT (procedure_id, step_number) DO NOTHING;

  -- HVAC Capacitor Test (7 steps)
  INSERT INTO public.field_procedure_steps
    (procedure_id, step_number, title, instruction, is_safety_critical, requires_confirmation, requires_instructor_signoff, checkpoint_note, estimated_seconds)
  VALUES
    (proc_hvac_cap, 1, 'Disconnect Power',   'Pull the disconnect at the condenser. Lock and tag.',                                                                                                   true,  true, true,  'Disconnect pulled, tag in place',              120),
    (proc_hvac_cap, 2, 'Wait Five Minutes',  'Allow internal capacitance to begin decaying. Do not shortcut this step.',                                                                              true,  true, false, NULL,                                            300),
    (proc_hvac_cap, 3, 'Open Access Panel',  'Remove the screws on the electrical access panel. Set the panel aside.',                                                                                false, true, false, NULL,                                             60),
    (proc_hvac_cap, 4, 'Discharge Capacitor','Using an insulated screwdriver with a 20K-ohm resistor, short C-Herm and C-Fan in turn. Hold for 5 seconds each.',                                    true,  true, true,  'No spark on second discharge attempt',           90),
    (proc_hvac_cap, 5, 'Disconnect Leads',   'Photograph wiring. Pull the leads off Herm, Fan, and C terminals.',                                                                                    false, true, false, NULL,                                             90),
    (proc_hvac_cap, 6, 'Measure Capacitance','Set multimeter to capacitance. Probe Herm-to-C and Fan-to-C. Compare against the rating printed on the cap.',                                          false, true, false, 'Both readings within 6% of rated value',        120),
    (proc_hvac_cap, 7, 'Reconnect or Replace','If in spec, reconnect leads in original orientation. If out of spec, replace with matching part.',                                                    false, true, false, NULL,                                            120)
  ON CONFLICT (procedure_id, step_number) DO NOTHING;
END $$;


-- ============================================================
-- 6. onboarding_templates + onboarding_template_items: Patriot program
--
-- Migration 027 seeded CPT, IHC, CNC, Trades. Patriot was added later
-- (via manual insert or the loose 035 file). This block ensures Patriot
-- exists and has its 22 standard checklist items.
-- The DO block reuses the same pattern as 027: seeds items for any template
-- that currently has no items, so it is safe to run on both staging and fresh.
-- ============================================================
INSERT INTO public.onboarding_templates (program, name, description)
SELECT 'Patriot', 'Patriot Pre-Arrival Checklist', 'Standard checklist for Patriot Pathway program'
WHERE NOT EXISTS (SELECT 1 FROM public.onboarding_templates WHERE program = 'Patriot');

DO $$
DECLARE
  tmpl RECORD;
BEGIN
  FOR tmpl IN
    SELECT t.id
    FROM public.onboarding_templates t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.onboarding_template_items WHERE template_id = t.id
    )
  LOOP
    -- pre_arrival (9 items)
    INSERT INTO public.onboarding_template_items
      (template_id, title, description, item_type, is_required, due_days_before, sort_order, phase)
    VALUES
      (tmpl.id, 'Upload DD-214',                   'Your Certificate of Release or Discharge from Active Duty. Required for GI Bill verification.',                                                                                'document',       true,  14, 1, 'pre_arrival'),
      (tmpl.id, 'Upload Certificate of Eligibility','Your VA Certificate of Eligibility for GI Bill benefits.',                                                                                                                    'document',       true,  14, 2, 'pre_arrival'),
      (tmpl.id, 'Book your travel',                'Book your flight or confirm your drive. Arrive at XNA or drive directly to campus. Staff will meet you at baggage claim or the entry gate.',                                   'action',         true,  10, 3, 'pre_arrival'),
      (tmpl.id, 'Complete pre-arrival intake form','Fill out your pre-arrival intake — gear sizes, dietary needs, emergency contact, arrival details. You received a link via email.',                                              'action',         true,  7,  4, 'pre_arrival'),
      (tmpl.id, 'Review community norms',          'Read and acknowledge the UHP community standards. This sets the tone for your 19 days.',                                                                                        'acknowledgment', true,  5,  5, 'pre_arrival'),
      (tmpl.id, 'Pack your gear',                  'Athletic clothing for PT. Casual clothing for class. Weather-appropriate layers. Toiletries. UHP apparel provided on arrival.',                                                'gear',           true,  3,  6, 'pre_arrival'),
      (tmpl.id, 'Upload a recent photo',           'A clear headshot for your student profile. Already done if you completed your intake form.',                                                                                    'document',       false, 7,  7, 'pre_arrival'),
      (tmpl.id, 'Confirm arrival details',         'Reply to your admissions contact with your final flight number and arrival time, or confirm your driving ETA.',                                                                'action',         true,  3,  8, 'pre_arrival'),
      (tmpl.id, 'Review your Day 1 schedule',      'Your Day 1 schedule is now available. Know where to go when you arrive.',                                                                                                       'info',           false, 1,  9, 'pre_arrival');

    -- arrival_day (7 items)
    INSERT INTO public.onboarding_template_items
      (template_id, title, description, item_type, is_required, due_days_before, sort_order, phase)
    VALUES
      (tmpl.id, 'Check in at the Field House',         'Station 1: Welcome check-in. Get your name badge and cohort packet.',                                             'action', true,  0, 1, 'arrival_day'),
      (tmpl.id, 'Bunk assignment + cabin walkthrough',  'Station 2: Get your bunk assignment and walk to your cabin with a GA.',                                          'action', true,  0, 2, 'arrival_day'),
      (tmpl.id, 'Apparel fitting at the Dome',          'Station 3: Try on your UHP apparel and confirm sizes. Replacements handled here.',                               'action', true,  0, 3, 'arrival_day'),
      (tmpl.id, 'Medical check-in with health team',    'Station 4: Brief check-in with the health team. Voluntary disclosure of any medical needs.',                     'action', false, 0, 4, 'arrival_day'),
      (tmpl.id, 'Campus orientation tour',              'Station 5: Side-by-side tour of campus — PLC, Dome, Field House, Culinary, Trade Building.',                    'action', true,  0, 5, 'arrival_day'),
      (tmpl.id, 'Welcome session at the Dome',          'Station 6: Full cohort welcome — program overview, philosophy, what to expect.',                                 'action', true,  0, 6, 'arrival_day'),
      (tmpl.id, 'Welcome dinner',                       'Station 7: First meal together. Culinary Building.',                                                             'action', true,  0, 7, 'arrival_day');

    -- offboarding (6 items)
    INSERT INTO public.onboarding_template_items
      (template_id, title, description, item_type, is_required, due_days_before, sort_order, phase)
    VALUES
      (tmpl.id, 'Return all loaned equipment',        'Return any equipment checked out during the program.',                                               'action',   true,  0, 1, 'offboarding'),
      (tmpl.id, 'Clear your bunk',                    'Strip your bunk, bag your bedding, leave the cabin clean for the next cohort.',                      'action',   true,  0, 2, 'offboarding'),
      (tmpl.id, 'Certification authorization letter', 'Your certification authorization letter is ready for download.',                                    'document', false, 0, 3, 'offboarding'),
      (tmpl.id, 'Alumni network access',              'Join the UHP alumni community. Your alumni account has been created.',                              'info',     false, 0, 4, 'offboarding'),
      (tmpl.id, '30-day check-in scheduled',          'Your 30-day post-program check-in has been scheduled.',                                             'info',     false, 0, 5, 'offboarding'),
      (tmpl.id, 'Program feedback survey',            'Complete your program feedback survey.',                                                            'action',   true,  0, 6, 'offboarding');
  END LOOP;
END $$;

-- ============================================================
-- SOURCE: 046_intake_manual_edit_fields.sql
-- ============================================================
-- ============================================================
-- 046 — Field-level staff-edit protection
--
-- 045 added manually_edited_at, a whole-row "staff touched this" marker that
-- made the HubSpot sync skip the entire student. This adds the set of fields
-- staff actually changed, so the sync can skip ONLY those and keep refreshing
-- everything else (gear, dietary, arrival, records, …) from HubSpot.
--
-- The set is grow-only: once staff change a field it stays staff-owned. The
-- HubSpot sync (lib/hubspot.ts) reads manually_edited_fields and strips just
-- those keys from its writes; completed_at still locks the whole row.
--
-- Additive + idempotent.
-- ============================================================

ALTER TABLE public.student_intake
  ADD COLUMN IF NOT EXISTS manually_edited_fields text[] NOT NULL DEFAULT '{}';

-- Preserve protection for any row edited under 045's whole-row lock (manually
-- edited before this column existed): mark every protectable field so the sync
-- keeps skipping them, matching their prior behavior. Only touches rows that
-- were staff-edited and not yet backfilled.
UPDATE public.student_intake
SET manually_edited_fields = ARRAY[
  'first_name','last_name','phone',
  'date_of_birth','sex','home_address','home_city','home_state','home_postal_code',
  'emergency_contact','dietary_flags','gear_sizes','arrival_details','health_disclosures'
]
WHERE manually_edited_at IS NOT NULL
  AND (manually_edited_fields IS NULL OR manually_edited_fields = '{}');

-- ============================================================
-- PILOT PREPARATION
-- Seed cohorts for the July 13 Trades launch and the June 1
-- CPT and IHC cohorts.
-- Idempotent: checks existence before inserting.
-- ============================================================

DO $$
BEGIN
  -- CPT June 1 cohort — active, 50 seats
  INSERT INTO public.cohorts (id, program, start_date, end_date, capacity, status)
  VALUES ('ced0d5e0-fb63-4c8b-9bd6-6ca0753e0ae7', 'CPT', '2026-06-01', NULL, 50, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- IHC June 1 cohort — active, 35 seats
  INSERT INTO public.cohorts (id, program, start_date, end_date, capacity, status)
  VALUES ('b401dd23-b570-40c7-a1f6-ac551c3ab2aa', 'IHC', '2026-06-01', NULL, 35, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Trades launch cohort — firm date, VA compliance gated
  IF NOT EXISTS (
    SELECT 1 FROM public.cohorts WHERE program = 'Trades' AND start_date = '2026-07-13'
  ) THEN
    INSERT INTO public.cohorts (program, start_date, end_date, capacity, status)
    VALUES ('Trades', '2026-07-13', NULL, 40, 'upcoming');
  END IF;
END $$;

-- ============================================================
-- FOUNDATIONAL ORG DATA (dumped from staging 2026-05-31 14:03:19 UTC)
-- tables: teams, user_profiles, team_members, squads, squad_members
-- ============================================================

SET session_replication_role = replica; -- bypass auth.users + lead_user_id FKs for local dev

-- USER_PROFILES
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('64276bab-2a62-49ac-a59a-6c989230504c','alisha@uhp.com','Alisha Hernandez','Dishwasher',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('84b2c305-fd3b-43b4-aa81-80dd5f9fb717','amanda@uhp.com','Amanda Garcia','IHC Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('3c92908f-6405-4132-9b86-70b42d4cd07d','andrew@uhp.com','Andrew Reid','Asst Prf Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('8fdecf7a-3b20-461c-a564-9aa20b305bf8','arturo@uhp.com','Arturo Alfaro Jr','Dishwasher',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('34be5f14-dd0f-41c2-adef-f020dcd38dda','ben@uhp.com','Ben Durham','VP, Operations',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('9d9f6c6b-5bea-47ac-9c80-6d8bc4b16918','bendurham@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('ef0424a1-7297-47fb-b5e0-461a08796231','blair@uhp.com',NULL,'Sr Dir, Prf Strategy',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('d2f2285c-22db-462e-bc99-d41b97c76562','brian@uhp.com','Brian Busker','Dir, Culinary',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('ebd2e673-31e0-4b47-b7cb-630b6f854e34','candice@uhp.com','Candice Storley','Dir, Performance',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('72e79893-cbe1-4927-bcb9-d4dbb8dfe464','carlena@uhp.com','Carlena Webb','Hospitality - Housekeeping',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('578d2c56-988b-4b44-925b-371b6519dcf3','carson@uhp.com','Carson Graham','Dir, Photography',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('b50958ff-a6d5-4fbe-9c10-e45b7abe710b','clifton@uhp.com','Clifton Arnold','Prf Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('6c815f90-525e-483d-ae6d-28e0f692be95','cody@uhp.com','Cody Montemayer','Admissions Advisor',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('bfe6265b-8749-4158-87d8-c336c855ab15','codyb@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('912d1abc-4cf3-4c48-a7fd-8e070b2bacf7','colleen@uhp.com','Colleen Cronin','IHC Guest',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('cc92be4d-97a9-4060-9b72-8e23f94ce778','curtis@uhp.com','Curtis Josenberger Jr','Admissions Advisor',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('9b4d6fcc-5f21-42b8-a243-3f5fad8483f2','david.guerra@uhp.com','David Guerra','Dishwasher',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('23de3d8d-de6a-418b-a8e0-0b8bbc80f054','david@uhp.com','David Maccar','Media Manager',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('b5b0e9cd-68e9-419b-ae1a-5043566e84d3','davidhamrick@uhp.com','David Hamrick','Prf Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('6fa9fd83-1866-4d99-a960-ede8b22507c5','dominic@uhp.com','Dominic Silva','Head of Grounds',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('a758f9f5-99a8-4d35-8489-0348b9a7e463','edward@uhp.com','Edward Alfaro','Dishwasher',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('0f579888-b4aa-405b-a599-e9289b294b65','eric@uhp.com','Eric Corvin','Facilities Manager',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('e72b8c83-372f-4bac-9348-248b1cd9259a','halle@uhp.com','Halle Haas','Enrollment Coordinator',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('664e410d-8f71-4404-95ee-0cd86787bba8','hattie@uhp.com','Hattie Douglas','Dir, People',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('e5e75575-2ad8-486a-8004-8b067fb23db9','hunter@uhp.com',NULL,'SVP, Performance',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('d588934f-f0ed-44e5-a395-945388881e94','jason.tutor@uhp.com','Jason Tutor','Grounds',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('017c2ee8-c408-4e02-9040-24980609e6c2','jason@uhp.com','Jason Strickland','Admissions Advisor',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('5bf2acc8-e447-4cd5-b8c5-9d88014f114a','jeanette@uhp.com','Jeanette Aguilar','Dishwasher',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('b61775d4-b124-4ba8-a113-9052962e51f3','jimmy@uhp.com','Jimmy','SVP, Technology','4793817162',NULL,'t','t',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('d91b0f1c-7dca-4515-96ed-546e7eacb551','jimmyeaster@contentforgeai.io','Jimmy Easter','SVP, Technology',NULL,NULL,'t','t',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('ac2950a7-33d5-4c73-bd31-a1f53a813f0a','jimmyeaster@contentofrgeai.io',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('e83c260e-8a62-4e49-b5fe-8705744d6531','joaquim_test@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('e79cebf3-66b6-45a7-88f8-791e2d75a045','joaquim_test2@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('db2dfa99-c05f-459a-9464-8695b682112b','joaquim@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','joaquin@uhp.com','Joaquin Rodriguez','General Ops Mgr',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('6103ae42-29a8-451d-a579-f2d0ac30ed42','joey@uhp.com','Joey Szczepaniak','VP, Admissions',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('e78cc238-dcc7-4a5f-8e73-0d0b4ab15fe0','josh@uhp.com','Josh Smith','Lead Line Cook',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','joshua@uhp.com','Joshua Capleton','Admissions Advisor',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('c57548f8-a764-4dd4-b98f-ba8d67dc74c3','katelin@uhp.com','Katelin Petersen','Sr Accountant',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('638cfc1a-6d78-45b7-833a-d591532c8a2d','kelly@uhp.com','Kelly Howard','VP of Education',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('748f5ce2-1526-4d20-8bd2-2a8d61d9826a','kenneth@uhp.com','Kenneth Welch','Admissions',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','kenny@uhp.com','Kenny Stone','Prf Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('ef221491-34f7-431e-b9f4-addc2d8bcba4','kevin@uhp.com','Kevin Berneburg','Operations Generalist',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('eeb30fd6-218a-4859-96ed-4887a8ba3143','kyle@uhp.com','Kyle Peak','Grounds',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('6942f95d-f5cb-4f70-94f3-0d39d5b3365a','laura@uhp.com','Laura Lovell','Dir, IHC',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('07157515-7846-49fd-b1d1-7b5e6875b593','luke@uhp.com','Luke Rayfield','SVP, Operations',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('58ab3c87-e458-4805-8dc8-5a8f43f28146','mark@uhp.com',NULL,'VP, Coaching & Development',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('b346b6a1-2c27-4c44-a0df-7fd6789b76c6','matt.egan@uhp.com','Matt Egan','CFO',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('8c089939-7053-45ef-8a85-ff161e736b44','matt@uhp.com','Matt Hesse','CEO',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('71544cd9-44ea-41ab-8156-16cf856b611b','megan@uhp.com','Megan Smith','Director of Experience & Hospitality',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('b906c3eb-61af-40fd-b68a-80a37280cdbb','michael@uhp.com','Michael Moore','Line Cook',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('2b05d279-72e1-45d1-826d-223e095dc639','michaelbrown@uhp.com','Michael Brown','Head of Security',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('de891181-0531-4df4-955c-863ef1a15a7b','mickey@uhp.com','Mickey Gamonal','Admissions',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('57e0eb37-c168-44cd-8b83-12f0579b53a1','mike@uhp.com','Mike Shea','Chief Marketing & Admissions Officer',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('3b263c41-1588-430b-9061-eeddab5b3157','misti@uhp.com','Misti Cassels','IHC Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('25a49869-7198-44ff-b7ae-e7205d1075e9','nathan@uhp.com','Nathan Drebenstedt','Security Officer',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('04773cb8-c21e-4750-a1a5-46a3632500bd','oisin@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('9d774cb8-b310-4b70-a208-a64061833efc','peter@uhp.com','Peter Russo','Admissions Specialist',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','ray@uhp.com','Ray Taylor','VP, Ignite Trade School',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('89a4c23d-aa6a-4069-a591-015ea516fa78','riley@uhp.com','Riley Arnold','Farmer - Greenhouse Manager',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('5cd0ea63-92b9-4f20-aebf-a287f041a851','scead@uhp.com','Scead Saxton','Admissions Advisor',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('cb2aa510-b45d-4b82-902f-2144764960c4','sean@uhp.com','Sean Murphy','VP, Leadership Development & Pathways',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('e42022ef-1b8d-4928-b708-225db9927927','shane@uhp.com','Shane Gray','Media Editor',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('7f10c5f2-235e-42f2-87e3-f753892aeb94','stu@uhp.com','Stu Green',NULL,'',NULL,'t','t',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('58286883-8352-4618-b0a3-620d1d983a99','susan@uhp.com','Susan Lopez','Dishwasher',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('57aa80b3-8152-438d-a7e2-af650d72583b','tara@uhp.com',NULL,NULL,NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('ea9727e3-3872-40eb-a887-e83b4c03ad01','tim@uhp.com','Tim Simmons','COO',NULL,NULL,'t','t',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('b664bde0-1846-4cfa-b2cf-e80dbad0c159','tom@uhp.com','Tom Byland','Owner''s Representative',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('126ffc3f-cb6a-4b62-8478-9d37575ae5e8','trent@uhp.com','Trent Ackerman','Project Manager, Construction',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('c4899576-efa9-4487-a165-2abcc82c33d6','tyrone@uhp.com','Tyrone Gowans','IHC Coach',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('92a6d66d-792f-4695-98d7-0ee1ca73bbbc','vicky@uhp.com','Vicky Wilkins','Hospitality - Housekeeping',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('2f71dfab-32c6-4dbf-ba5e-5563f21df499','wesley@uhp.com','Wesley Northey IV','Director, Leadership Development',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_profiles (id,email,display_name,title,phone,avatar_url,active,is_admin,default_team_id) VALUES ('aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','whitney@uhp.com','Whitney Rurak','Hospitality - Housekeeping',NULL,NULL,'t','f',NULL) ON CONFLICT (id) DO NOTHING;

-- TEAMS
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('b423d7f0-79ad-4f11-8ac2-1aa924e55e2f','Executive','executive','Executive rollups, risk, readiness, and cross-department visibility.',NULL,'{all}'::text[],'#0E9E99','⭐','t',NULL,'department','/executive',10) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('6b60f284-6972-4592-bd99-d07a24ae4b6f','Operations','ops','Maintenance, grounds, housing, security, transportation, facilities, and access.',NULL,'{all}'::text[],'#C97A00','🏗️','t',NULL,'department','/admin/ops',20) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('3da56c41-4bf1-4503-8ce2-882764583f55','Maintenance','maintenance','Repairs, maintenance, facility closeout, and room maintenance.',NULL,'{all}'::text[],'#C97A00','M','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/work-orders?team=maintenance',21) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('f8689b0d-d3aa-4fc3-ae6d-9368a2a9092f','Grounds & Maintenance','grounds','Grounds, exterior work, vehicle support, and grounds prioritization.',NULL,'{all}'::text[],'#65A30D','🌿','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/grounds-priorities',22) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('d9727af0-9eef-4652-b452-f6b2be333d55','Housing / Rooms','housing','Rooms, cabins, bunks, housing readiness, and check-in.',NULL,'{all}'::text[],'#7C3AED','H','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/rooms',23) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('20e23da4-ee74-4d42-acd8-02e67cdc8892','Campus Security','security','Security incidents, patrol coverage, access, and restricted spaces.',NULL,'{all}'::text[],'#DC2626','🔒','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/work-orders?team=security',24) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('d04feb5e-1b56-4068-87f9-e29c0a75c9af','Transportation','transportation','Vehicle, driver, and student movement support.',NULL,'{all}'::text[],'#F59E0B','T','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/work-orders?team=transportation',25) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('1985cdee-252c-4159-811b-e83e127beaf2','Facilities','facilities','Facility readiness, spaces, rooms, and reservations.',NULL,'{all}'::text[],'#64748B','F','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/spaces',26) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('bf6ffef4-5576-423d-98ed-8fbe080cdca0','Badges / Access','badges-access','Badge access, attendance events, and access support.',NULL,'{all}'::text[],'#0E9E99','B','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/badges',27) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('9ae61c61-5b3c-4c6a-89f7-271167455fdf','Programs','programs','Coaching, IHC, CNC, Trades, curriculum, cohorts, schedules, and rosters.',NULL,'{all}'::text[],'#059669','P','t',NULL,'department','/admin/programs',30) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('39617f28-940d-475d-8ebc-a739b27e2561','Coaching','coaching','Cohort coaching rosters, classes, sessions, notes, and student-visible plans.',NULL,'{CPT,IHC,Patriot}'::text[],'#059669','C','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs#coaching',31) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('fd9842a6-963b-4e51-bf23-b5ada1ab2577','IHC','ihc','Intrinsic Health Coaching sessions, student support, and wellbeing work.',NULL,'{IHC}'::text[],'#0E9E99','🧠','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs#ihc',32) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('66b99d2b-b493-4591-a840-a1879d9d2541','CNC','cnc','Culinary Nutrition Coaching and greenhouse/lab planning.',NULL,'{CNC}'::text[],'#65A30D','🌱','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/kitchen/cnc',33) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('dc718411-066e-4e0f-8d51-5f4a7914dcd9','Trades','trades','Trades programs, field execution, milestones, and attendance.',NULL,'{Trades}'::text[],'#F59E0B','🔧','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs#trades',34) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('b7080bf8-6f2c-4bb3-a241-cf49ca16cadd','Curriculum / Instruction','curriculum','Curriculum, class materials, instructors, and instruction planning.',NULL,'{all}'::text[],'#2563EB','U','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs#curriculum',35) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('df55bf86-6088-46ca-8604-b76b232488e2','Admissions','admissions','Intake, enrollment, funding/documents, and handoff from HubSpot into UHP Ops.',NULL,'{all}'::text[],'#2563EB','📋','t',NULL,'department','/admin/admissions-dashboard',40) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('d29e772a-8ca7-4dc1-9f2e-2c03bb24878f','Intake','intake','Pre-arrival intake, forms, missing items, and student readiness.',NULL,'{all}'::text[],'#2563EB','I','t','df55bf86-6088-46ca-8604-b76b232488e2','subteam','/admin/intake',41) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('05870441-d919-45c7-a24e-0416929cfccf','Enrollment','enrollment','Enrollment readiness, cohort assignment, and onboarding status.',NULL,'{all}'::text[],'#1D4ED8','E','t','df55bf86-6088-46ca-8604-b76b232488e2','subteam','/admin/onboarding',42) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('0a5a2f9e-8423-4701-8683-038401465c51','Funding / Documents','funding','Funding source, required documents, and finance handoff.',NULL,'{all}'::text[],'#7C3AED','F','t','df55bf86-6088-46ca-8604-b76b232488e2','subteam','/admin/import',43) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('2db0dd6e-5b8f-444d-86f3-9f45d0fc480a','Campus Services','campus-services','Culinary, student support, and check-ins.',NULL,'{all}'::text[],'#DC2626','C','t',NULL,'department','/admin/campus-services',50) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('3e33c5ad-cde4-4765-92d4-eb3d89f98865','Culinary','culinary','Kitchen operations, meal planning, dietary needs, shopping, and inventory.',NULL,'{CNC}'::text[],'#DC2626','🍽️','t','2db0dd6e-5b8f-444d-86f3-9f45d0fc480a','subteam','/admin/kitchen',51) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('3dd4c488-4dd0-493c-932c-228b557c1f5a','Student Support','student-support','Student support, follow-up, flags, and care coordination.',NULL,'{all}'::text[],'#0E9E99','S','t','2db0dd6e-5b8f-444d-86f3-9f45d0fc480a','subteam','/admin/campus-services#support',52) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('debe2f69-7eef-401b-9e96-e4017a32c28f','Check-ins','checkins','Student check-ins, flags, and follow-up routing.',NULL,'{all}'::text[],'#F59E0B','C','t','2db0dd6e-5b8f-444d-86f3-9f45d0fc480a','subteam','/admin/checkins',53) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('67383817-d8c9-40b0-87ff-7a3ddf59085f','Finance','finance','Tuition, funding, expenses, CapEx, OpEx, and forecasts.',NULL,'{all}'::text[],'#7C3AED','F','t',NULL,'department','/admin/finance',60) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('6f572051-5507-42b2-81be-bf6d6c3b62f4','Technology','technology','Requests, approvals, processes, integrations, observability, feature flags, and release safety.','b61775d4-b124-4ba8-a113-9052962e51f3','{all}'::text[],'#374151','💻','t',NULL,'department','/admin/technology',70) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('d189f91d-bf68-47ee-83a0-9934c699e996','Marketing','marketing','Pipeline signal, campaigns, alumni, and outcome reporting.',NULL,'{all}'::text[],'#7C3AED','📣','t',NULL,'department','/admin/reports',80) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('3479deb2-84b8-4be7-bbdb-b5b67956f9cc','Housekeeping','housekeeping','Residential and facility cleaning, hospitality. Lead: Megan Smith',NULL,'{all}'::text[],'#7C3AED','🏠','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/rooms',100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('1d1db487-0432-47f3-a141-171080c5e315','Construction & Facilities','construction','Capital projects, renovation, facilities planning. Lead: Tom Byland (Owner''s Rep)',NULL,'{all}'::text[],'#374151','🏗️','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/work-orders?team=construction',100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('c55666c7-078c-4c88-b2e1-7357ad77d0ef','General Operations','gen-ops','Daily campus operations, facilities coordination. Lead: Joaquin Rodriguez',NULL,'{all}'::text[],'#C97A00','⚙️','t','6b60f284-6972-4592-bd99-d07a24ae4b6f','subteam','/admin/ops',100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('f075e03a-bc4a-4e3e-8287-2f4f5ce95712','Health & Coaching','health','Health programs, coaching, student wellness. Lead: Hunter (SVP Health)',NULL,'{CPT,IHC,Patriot}'::text[],'#059669','💪','t',NULL,'subteam',NULL,100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('d0cbf37a-a7a4-44ed-bbb3-5d6d78cf7c31','Ignite Trade School','ignite','Trade school programs (Electrical, HVAC, Plumbing, Welding). VP: Ray Taylor',NULL,'{Trades}'::text[],'#F59E0B','⚡','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs#trades',100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('b7e73e2b-7425-4cc3-a777-535e6cbf1c38','Student','student','All enrolled students across all programs',NULL,'{all}'::text[],'#1AAFA0','🎓','t',NULL,'audience','/student/home',100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('4a2bdcef-e8bd-4309-8502-f20bc1e8d39a','Performance Strategy','performance-strategy','Senior Director Performance Strategy. Lead: Blair Wagner',NULL,'{CPT,IHC}'::text[],'#7C3AED','📊','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs',100) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teams (id,name,slug,description,lead_user_id,programs,color,icon,active,parent_team_id,team_type,dashboard_href,sort_order) VALUES ('eacf0c88-e26a-497f-b0e5-ddee03191c3f','CPT','cpt','Cognitive Performance Training. Dir: Candice Storley, Coaches: Hamrick, Stone, Arnold',NULL,'{CPT}'::text[],'#059669','🏋️','t','9ae61c61-5b3c-4c6a-89f7-271167455fdf','subteam','/admin/programs#coaching',100) ON CONFLICT (id) DO NOTHING;

-- TEAM_MEMBERS
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('188753b3-26f5-47bf-9187-0a602611b7ca','6f572051-5507-42b2-81be-bf6d6c3b62f4','b61775d4-b124-4ba8-a113-9052962e51f3','lead','d91b0f1c-7dca-4515-96ed-546e7eacb551','2026-04-11 21:39:56.767561+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('c99fd6f6-4f38-4f16-92a5-39771b8d749e','df55bf86-6088-46ca-8604-b76b232488e2','d91b0f1c-7dca-4515-96ed-546e7eacb551','member','d91b0f1c-7dca-4515-96ed-546e7eacb551','2026-04-11 21:56:25.720602+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('19b2e2a8-3d0e-4474-920a-eda3b539a230','6f572051-5507-42b2-81be-bf6d6c3b62f4','d91b0f1c-7dca-4515-96ed-546e7eacb551','lead','d91b0f1c-7dca-4515-96ed-546e7eacb551','2026-04-12 03:28:12.361316+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ef66f878-94fe-43a4-9052-e42463b6aaf4','b423d7f0-79ad-4f11-8ac2-1aa924e55e2f','8c089939-7053-45ef-8a85-ff161e736b44','lead',NULL,'2026-04-17 18:53:34.681561+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ba9c71b8-d7ef-4adc-b412-c1b0cc2533c6','b423d7f0-79ad-4f11-8ac2-1aa924e55e2f','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead',NULL,'2026-04-17 18:53:35.165758+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('83d5c7d5-b8fc-4b79-b858-39b9e787a272','6b60f284-6972-4592-bd99-d07a24ae4b6f','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead',NULL,'2026-04-17 18:53:35.394706+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('6fe3721b-15d5-474f-8ceb-0616994e1a82','3e33c5ad-cde4-4765-92d4-eb3d89f98865','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead',NULL,'2026-04-17 18:53:35.653174+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('7637de20-4869-4c4b-8582-d2577ad911be','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead',NULL,'2026-04-17 18:53:35.894193+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('32ada596-134f-41dc-bd18-43a8aeb40390','dc718411-066e-4e0f-8d51-5f4a7914dcd9','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead',NULL,'2026-04-17 18:53:36.136293+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('da953f8d-4e3b-49fb-b418-9c726b258c21','6f572051-5507-42b2-81be-bf6d6c3b62f4','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead',NULL,'2026-04-17 18:53:36.429306+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('41197f5e-d806-4349-a1b2-f4325c21038f','b423d7f0-79ad-4f11-8ac2-1aa924e55e2f','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member',NULL,'2026-04-17 18:53:37.092595+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('24870ac5-88eb-428c-bbc6-6eada11ad9f8','b423d7f0-79ad-4f11-8ac2-1aa924e55e2f','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead',NULL,'2026-04-17 18:53:37.739801+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('665124ee-c298-44b3-b884-f5fdc3114bd2','d189f91d-bf68-47ee-83a0-9934c699e996','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead',NULL,'2026-04-17 18:53:37.976199+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('903963a3-a5e0-45d2-9b7c-7abee08ec954','df55bf86-6088-46ca-8604-b76b232488e2','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead',NULL,'2026-04-17 18:53:38.207102+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('8aece85d-fc83-4af3-af95-bf97f5394151','df55bf86-6088-46ca-8604-b76b232488e2','6103ae42-29a8-451d-a579-f2d0ac30ed42','lead',NULL,'2026-04-17 18:53:38.663706+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('9922ee19-bf1a-4f37-a14b-3435298bf1ac','6f572051-5507-42b2-81be-bf6d6c3b62f4','6103ae42-29a8-451d-a579-f2d0ac30ed42','lead',NULL,'2026-04-17 18:53:38.88402+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('15755a35-303c-46a9-979b-f3ae62b7b4cc','df55bf86-6088-46ca-8604-b76b232488e2','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member',NULL,'2026-04-17 18:53:39.560844+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('0b30d3f3-490b-4fb6-8e01-586afd33dac4','df55bf86-6088-46ca-8604-b76b232488e2','017c2ee8-c408-4e02-9040-24980609e6c2','member',NULL,'2026-04-17 18:53:40.265169+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('548e6fcc-09fc-4572-ac90-b1723301a6d9','df55bf86-6088-46ca-8604-b76b232488e2','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member',NULL,'2026-04-17 18:53:40.962013+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('bff63444-561e-41d6-9cb0-1295ee886dca','df55bf86-6088-46ca-8604-b76b232488e2','cc92be4d-97a9-4060-9b72-8e23f94ce778','member',NULL,'2026-04-17 18:53:41.628413+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('9c72ca5d-3402-4e9c-9046-272f05d28218','df55bf86-6088-46ca-8604-b76b232488e2','6c815f90-525e-483d-ae6d-28e0f692be95','member',NULL,'2026-04-17 18:53:42.338999+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('8e0faa9a-537a-4ea9-a28a-19936e739df0','df55bf86-6088-46ca-8604-b76b232488e2','de891181-0531-4df4-955c-863ef1a15a7b','member',NULL,'2026-04-17 18:53:43.048118+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('18f291f0-24db-4893-8ca7-d75c52e4c7e8','df55bf86-6088-46ca-8604-b76b232488e2','9d774cb8-b310-4b70-a208-a64061833efc','member',NULL,'2026-04-17 18:53:43.6939+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('fd9bc77c-fb25-450c-b4c3-0075c50882a5','df55bf86-6088-46ca-8604-b76b232488e2','5cd0ea63-92b9-4f20-aebf-a287f041a851','member',NULL,'2026-04-17 18:53:44.400249+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('4a62a977-be92-448b-a184-993a9620cf5f','df55bf86-6088-46ca-8604-b76b232488e2','e72b8c83-372f-4bac-9348-248b1cd9259a','member',NULL,'2026-04-17 18:53:45.067305+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('c58a3756-5061-4c34-a89c-40e3e1770b0f','6b60f284-6972-4592-bd99-d07a24ae4b6f','07157515-7846-49fd-b1d1-7b5e6875b593','lead',NULL,'2026-04-17 18:53:45.730438+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('e94407f3-a76b-4f33-872d-46727364cd71','6b60f284-6972-4592-bd99-d07a24ae4b6f','34be5f14-dd0f-41c2-adef-f020dcd38dda','member',NULL,'2026-04-17 18:53:46.384559+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ac160f53-e71f-48dc-bb67-49d6bbb11231','6b60f284-6972-4592-bd99-d07a24ae4b6f','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member',NULL,'2026-04-17 18:53:47.066032+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('faf76dff-58c0-45ae-b413-680c657e1ada','6b60f284-6972-4592-bd99-d07a24ae4b6f','ef221491-34f7-431e-b9f4-addc2d8bcba4','member',NULL,'2026-04-17 18:53:47.76875+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('03979e85-0d73-4f31-a8f5-7b8e4a0287e0','6b60f284-6972-4592-bd99-d07a24ae4b6f','0f579888-b4aa-405b-a599-e9289b294b65','member',NULL,'2026-04-17 18:53:48.441704+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('c8efa21d-8696-43e0-bc44-cd7cd674caf9','6b60f284-6972-4592-bd99-d07a24ae4b6f','2b05d279-72e1-45d1-826d-223e095dc639','member',NULL,'2026-04-17 18:53:49.0614+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ddeb5158-a450-4242-8df6-4eb44bdb327b','6b60f284-6972-4592-bd99-d07a24ae4b6f','25a49869-7198-44ff-b7ae-e7205d1075e9','member',NULL,'2026-04-17 18:53:49.716312+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('7eebeae2-6c48-411a-b9ed-0045c60d03b9','6b60f284-6972-4592-bd99-d07a24ae4b6f','6fa9fd83-1866-4d99-a960-ede8b22507c5','member',NULL,'2026-04-17 18:53:50.369526+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('29252fb7-94c7-46cf-adc3-499906e648ea','6b60f284-6972-4592-bd99-d07a24ae4b6f','eeb30fd6-218a-4859-96ed-4887a8ba3143','member',NULL,'2026-04-17 18:53:51.007998+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('14b6f9f7-306e-4a73-bc0c-f45b3c03c3d7','6b60f284-6972-4592-bd99-d07a24ae4b6f','d588934f-f0ed-44e5-a395-945388881e94','member',NULL,'2026-04-17 18:53:51.70376+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('d2c2d88e-959b-436f-b15b-07f607eb7828','6b60f284-6972-4592-bd99-d07a24ae4b6f','b664bde0-1846-4cfa-b2cf-e80dbad0c159','member',NULL,'2026-04-17 18:53:52.451853+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('f7072f2e-9a17-41f9-bd5d-62b0ab4c9495','6b60f284-6972-4592-bd99-d07a24ae4b6f','126ffc3f-cb6a-4b62-8478-9d37575ae5e8','member',NULL,'2026-04-17 18:53:53.121917+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('84ff6d73-b1e4-4f40-a9d9-2fd1fb47dcec','6b60f284-6972-4592-bd99-d07a24ae4b6f','71544cd9-44ea-41ab-8156-16cf856b611b','member',NULL,'2026-04-17 18:53:53.75259+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('c56e5961-b313-4882-94de-d20a382c4bd5','6b60f284-6972-4592-bd99-d07a24ae4b6f','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member',NULL,'2026-04-17 18:53:54.451658+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('491e0491-30a9-4e67-a525-5745f5d2d399','6b60f284-6972-4592-bd99-d07a24ae4b6f','92a6d66d-792f-4695-98d7-0ee1ca73bbbc','member',NULL,'2026-04-17 18:53:55.101247+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('0cc5ef93-0016-40e7-ba91-5c1dda600e12','6b60f284-6972-4592-bd99-d07a24ae4b6f','72e79893-cbe1-4927-bcb9-d4dbb8dfe464','member',NULL,'2026-04-17 18:53:55.738615+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('d27cada4-b260-43f6-a0cb-31ebf237e708','3e33c5ad-cde4-4765-92d4-eb3d89f98865','d2f2285c-22db-462e-bc99-d41b97c76562','lead',NULL,'2026-04-17 18:53:56.444702+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('9217f29e-718b-4b59-91e4-d2102a79a748','3e33c5ad-cde4-4765-92d4-eb3d89f98865','e78cc238-dcc7-4a5f-8e73-0d0b4ab15fe0','member',NULL,'2026-04-17 18:53:57.147965+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('b13c4762-77cf-4540-95e9-14108ad405a5','3e33c5ad-cde4-4765-92d4-eb3d89f98865','b906c3eb-61af-40fd-b68a-80a37280cdbb','member',NULL,'2026-04-17 18:53:57.784495+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('241d92d8-e323-407f-bcf0-7be950e74149','3e33c5ad-cde4-4765-92d4-eb3d89f98865','64276bab-2a62-49ac-a59a-6c989230504c','member',NULL,'2026-04-17 18:53:58.421138+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('a0372d3f-646e-448f-bfd0-e20d306fd69c','3e33c5ad-cde4-4765-92d4-eb3d89f98865','58286883-8352-4618-b0a3-620d1d983a99','member',NULL,'2026-04-17 18:53:59.067897+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('a4fa6080-d5d5-4b7e-abea-70cc5e4965d4','3e33c5ad-cde4-4765-92d4-eb3d89f98865','9b4d6fcc-5f21-42b8-a243-3f5fad8483f2','member',NULL,'2026-04-17 18:53:59.713915+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('7f7f671f-a002-47d8-b794-dde98a0ce349','3e33c5ad-cde4-4765-92d4-eb3d89f98865','8fdecf7a-3b20-461c-a564-9aa20b305bf8','member',NULL,'2026-04-17 18:54:00.348843+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('5532702a-424f-4108-aad7-a00ba82e1262','3e33c5ad-cde4-4765-92d4-eb3d89f98865','a758f9f5-99a8-4d35-8489-0348b9a7e463','member',NULL,'2026-04-17 18:54:01.008013+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('c722296c-6afc-49b7-a468-525475f1c1f1','3e33c5ad-cde4-4765-92d4-eb3d89f98865','5bf2acc8-e447-4cd5-b8c5-9d88014f114a','member',NULL,'2026-04-17 18:54:01.75889+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('9570a563-a3ec-4a37-8d61-b71c5107d5d3','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','58ab3c87-e458-4805-8dc8-5a8f43f28146','member',NULL,'2026-04-17 18:54:03.157327+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('8bc1cef4-aad8-43de-b04a-f9849d8243ee','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','638cfc1a-6d78-45b7-833a-d591532c8a2d','member',NULL,'2026-04-17 18:54:03.808849+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('e30bc7fd-dfef-4c46-9480-569ef66599a3','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','ef0424a1-7297-47fb-b5e0-461a08796231','member',NULL,'2026-04-17 18:54:04.472469+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('59d4ff20-029a-4923-aa6e-ad0f00c5bf69','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','ebd2e673-31e0-4b47-b7cb-630b6f854e34','member',NULL,'2026-04-17 18:54:05.124991+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('eddaef8c-ea8b-4ab9-a64c-a1bc1edfb535','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','6942f95d-f5cb-4f70-94f3-0d39d5b3365a','member',NULL,'2026-04-17 18:54:05.765753+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('8d8eb77c-3012-41f1-8667-c80932ffba26','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','b5b0e9cd-68e9-419b-ae1a-5043566e84d3','member',NULL,'2026-04-17 18:54:06.471025+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ab1db190-df72-4dd3-bfc4-25ee86e1883e','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','member',NULL,'2026-04-17 18:54:07.260881+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('d9410c23-8970-4042-8363-02361cad2d89','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','3c92908f-6405-4132-9b86-70b42d4cd07d','member',NULL,'2026-04-17 18:54:08.071888+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('30b3ea11-40d6-4621-a7d7-bd37702077c9','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','b50958ff-a6d5-4fbe-9c10-e45b7abe710b','member',NULL,'2026-04-17 18:54:08.804572+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('d23c598b-b1fd-4b7e-8d86-921b65fbe537','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','3b263c41-1588-430b-9061-eeddab5b3157','member',NULL,'2026-04-17 18:54:09.553807+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('d1ff407a-5118-45bc-afde-68992e88206b','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','c4899576-efa9-4487-a165-2abcc82c33d6','member',NULL,'2026-04-17 18:54:10.291292+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('1e1bba8f-b903-4efd-96c2-7f0b92378272','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','84b2c305-fd3b-43b4-aa81-80dd5f9fb717','member',NULL,'2026-04-17 18:54:10.983332+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('72764abc-1f6a-4170-aff3-6ff0213be4a6','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','912d1abc-4cf3-4c48-a7fd-8e070b2bacf7','member',NULL,'2026-04-17 18:54:11.763394+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('20e8f497-72b9-4039-b1c9-b6aebf8e9081','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','89a4c23d-aa6a-4069-a591-015ea516fa78','member',NULL,'2026-04-17 18:54:12.543812+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('0587c6f7-c6ff-4f45-98bf-5abe40ad6d5b','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','cb2aa510-b45d-4b82-902f-2144764960c4','member',NULL,'2026-04-17 18:54:13.2282+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('7f2dadab-f20c-4c49-aa3d-f1911d0df763','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','2f71dfab-32c6-4dbf-ba5e-5563f21df499','member',NULL,'2026-04-17 18:54:13.976355+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('53de3829-f1ae-41e9-bcd6-25ed69f2f47f','d189f91d-bf68-47ee-83a0-9934c699e996','578d2c56-988b-4b44-925b-371b6519dcf3','member',NULL,'2026-04-17 18:54:14.642982+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('e695df23-232a-4130-8694-a9d5d518f5fe','d189f91d-bf68-47ee-83a0-9934c699e996','e42022ef-1b8d-4928-b708-225db9927927','member',NULL,'2026-04-17 18:54:15.338505+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('5ef3628a-f1dc-474a-9ee1-b462fda9c48b','d189f91d-bf68-47ee-83a0-9934c699e996','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member',NULL,'2026-04-17 18:54:16.067597+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('06b750b0-1a6c-4f5f-ac1a-4b7ca3a9626f','d189f91d-bf68-47ee-83a0-9934c699e996','664e410d-8f71-4404-95ee-0cd86787bba8','member',NULL,'2026-04-17 18:54:16.748726+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('e7cfc143-bff3-4f7b-8946-32775b604f5c','dc718411-066e-4e0f-8d51-5f4a7914dcd9','fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','lead',NULL,'2026-04-17 18:54:17.461484+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('9cb3953f-dd7c-438c-a049-9340a6c80d57','b423d7f0-79ad-4f11-8ac2-1aa924e55e2f','c57548f8-a764-4dd4-b98f-ba8d67dc74c3','member',NULL,'2026-04-17 18:54:18.783408+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('7f9f70fc-7b18-40ac-998f-4dc8f670e94e','f075e03a-bc4a-4e3e-8287-2f4f5ce95712','e5e75575-2ad8-486a-8004-8b067fb23db9','lead',NULL,'2026-05-06 19:40:41.741999+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('bc914f3e-92da-4358-8119-7c52d3b5b5f1','6f572051-5507-42b2-81be-bf6d6c3b62f4','db2dfa99-c05f-459a-9464-8695b682112b','member','b61775d4-b124-4ba8-a113-9052962e51f3','2026-05-13 14:49:07.667968+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('7c238802-9768-4228-a186-b79af86b9040','df55bf86-6088-46ca-8604-b76b232488e2','04773cb8-c21e-4750-a1a5-46a3632500bd','lead',NULL,'2026-05-19 18:38:10.026175+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('6edd8881-a835-40da-af2f-f1d9e459106b','6f572051-5507-42b2-81be-bf6d6c3b62f4','7f10c5f2-235e-42f2-87e3-f753892aeb94','member','b61775d4-b124-4ba8-a113-9052962e51f3','2026-05-27 13:11:12.86357+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ed731a16-07f0-470d-9f24-a1e0fcbf7b00','6f572051-5507-42b2-81be-bf6d6c3b62f4','04773cb8-c21e-4750-a1a5-46a3632500bd','lead',NULL,'2026-05-27 15:18:24.406957+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('8c60bab4-ca5e-4ed9-a78f-15b1abddb767','20e23da4-ee74-4d42-acd8-02e67cdc8892','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member','b61775d4-b124-4ba8-a113-9052962e51f3','2026-05-29 13:24:04.616341+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('ec596e1e-7da0-4e45-bad5-241a5a6bde3f','c55666c7-078c-4c88-b2e1-7357ad77d0ef','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member','b61775d4-b124-4ba8-a113-9052962e51f3','2026-05-29 13:24:32.031018+00') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id,team_id,user_id,role,added_by,added_at) VALUES ('0a30983c-cf09-4c9c-b4d9-bcd5f381b895','c55666c7-078c-4c88-b2e1-7357ad77d0ef','bfe6265b-8749-4158-87d8-c336c855ab15','member','7f10c5f2-235e-42f2-87e3-f753892aeb94','2026-05-29 17:27:14.791567+00') ON CONFLICT (id) DO NOTHING;

-- SQUADS
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('174506d1-87ce-4ab0-96a7-f03a6e966abb','Governance & Leadership','Build the decision-making infrastructure, budget authority framework, and accountability culture (Oz Principle) that allows UHP to scale without founder-dependent decisions. Own Operation Iron Clock reporting cadence.','Budget approval workflows, Decision authority matrix, Monthly EC reporting, Oz Principle culture reinforcement','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('78386be6-3184-4cfe-bcb7-b9140cb09a4b','Graduate & On Campus Living','Graduate programs, on-campus housing, student services, and compliance','Education / Campus / Governance','#C9A84C',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('f3f9299e-7c60-4f78-98d8-6063313039f3','Graduate & On Campus Living','Graduate programs, on-campus housing, student services, and compliance','Education / Campus / Governance','#C9A84C',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('0ab16f7e-0e65-41e9-9409-3bfc407366d0','Pipeline & SOPs','Document, standardize, and automate every repeatable UHP process — from admissions intake to graduation ceremony. Eliminate invisible processes (Tim''s ''we don''t have a process for that / yes we do'' problem). Own the SOP library.','Admissions process, Enrollment cutoff policy, Admissions-to-campus handoff SOP, Inventory ordering SOPs, Graduation ceremony SOP, Week 2 retention protocol','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('741abc49-633e-4a67-9180-881274078fc9','SOP Leads','We are here to map and ensure all SOPs, processess and procedures are mapped','E2E','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('d578f04a-5845-422c-a721-7c7dac4d43bf','Squad 1 — Arrival & First Impressions','Design and operationalize the arrival day experience so that every student''s first 24 hours creates an immediate sense of belonging, clarity, and awe — eliminating all micro-misses from arrival through Day 2.','Arrival Day / Onboarding, Pre-Arrival Communication & Expectation Setting, Laundry Operations, Student Health & Wellness Monitoring (acute on-arrival)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','Squad 1 — Arrival Experience','Design and deliver a world-class, consistent, and personalized arrival day experience that transitions every student from civilian to UHP community member with clarity, warmth, and zero ambiguity.','Student Arrival Day Experience, Inventory & Apparel Management, Laundry Operations, Pre-Arrival Communication & Expectation Setting','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','Squad 1: Arrival Experience','Design and operationalize a world-class, consistent, and wow-worthy student arrival experience from the moment of commitment through the end of Day 1 on campus — eliminating ambiguity and creating immediate belonging.','Arrival Day Experience, Student Enrollment & Commitment Tracking, Pre-Arrival Expectation Setting','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('8f3a9586-4aef-4928-874d-f4e8413c2ac1','Squad 1: Governance & Leadership','Establish scalable decision-making authority, budget delegation, accountability culture (Above the Line / Oz Principle), and the Operation Iron Clock reporting cadence so UHP leadership can scale without founder dependency.','HR & People Operations, SOP Documentation & Process Visibility (oversight)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('2182ea43-7318-4c95-8d89-e3d574655bb4','Squad 2 — Admissions & Student Pipeline','Create a frictionless, personalized admissions journey that attracts the right veterans, sets accurate expectations, and seamlessly hands off a rich student profile to the campus team — driving conversion, retention, and outcomes.','Lead intake and qualification, Admissions interview process, Application and documentation workflow, Pre-course nurture sequence, Admissions-to-campus handoff protocol, Alumni and champion referral program, Outcome clarity and marketing message alignment','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('f5fa899e-96e6-4987-812f-eb263fe6d678','Squad 2 — Systems & Technology','Select, implement, and integrate all mission-critical SaaS systems (SIS, Scheduling, Inventory, HR) before the June pilot. Ensure Wi-Fi infrastructure enables all systems to function campus-wide.','Student Information & Records Management, Inventory Management (Apparel & Supplies), Campus Facility & Safety Management (tech layer)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('4500ff55-05ba-4b57-8620-8c83877b4952','Squad 2: Admissions & Pipeline','Build a seamless, personalized, and outcome-oriented admissions experience that attracts the right students, sets accurate expectations, and transfers complete student profiles to campus operations — reducing drop-off and misalignment.','Student Admissions & Pre-Arrival Communication, Feedback Collection & Continuous Improvement (admissions funnel), Enrollment & Commitment Tracking','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('a39c3b7d-20a9-4823-8604-5ede95422845','Squad 2: Pipeline & SOP','Document, standardize, and make visible all critical operational processes across admissions, campus ops, culinary, and student experience so that any staff member can execute any core process without tribal knowledge.','SOP Documentation & Process Visibility, Pre-Arrival & Expectation Setting, Laundry & Campus Housekeeping, Brand Consistency Standards','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('8f2e35d4-5791-4bfc-a836-4959e1f9df5b','Squad 2: Systems & Technology','Evaluate, select, implement, and integrate the core technology stack that enables UHP to scale from 30 to 1,000+ students. Prioritize SIS, scheduling, inventory, and connectivity as the foundational layer for all other operations.','Student Information & Records Management, Scheduling System implementation, Inventory Management implementation, Wi-Fi/connectivity upgrade, Walmart Workday integration scoping','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('ca5d05b3-aa5b-4b80-a373-22dc63131266','Squad 3 — Pipeline & SOP','Make every critical process at UHP visible, documented, and executable by anyone — eliminating the invisible process problem and building a culture of above-the-line operational excellence.','SOP & Process Documentation, Culinary Operations & Meal Service, Scheduling & Facility Management, Maintenance & Facilities Ticketing, Decision-Making & Governance','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('863ac553-3a13-42c2-93d8-98514e8eae62','Squad 3 — Pipeline, SOPs & Process','Document, socialize, and maintain all critical operating processes so that no process exists only in someone''s head — enabling consistent student experience delivery at scale.','Staff Communication & Process Visibility, Student Admissions & Intake (process layer), Food & Culinary Operations (process layer), Laundry Operations (SOP), Campus Facility & Safety Management (SOP)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('40610560-6dbc-4bc4-a122-de6f529d645b','Squad 3 — Systems & Technology','Evaluate, select, and implement the core technology stack that enables UHP to operate at scale — starting with SIS, scheduling, and connectivity — building toward an AI-native operating environment.','SIS evaluation and implementation, Wi-Fi and infrastructure deployment, Scheduling system deployment, Inventory management system deployment, HubSpot optimization and API integrations, SOP tooling (ClickUp) deployment, Data architecture and student ID management, Walmart Workday transcript integration planning','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','Squad 3: Pipeline & Admissions','Build a frictionless, personalized admissions and pre-arrival pipeline that converts qualified veterans with clarity, sets accurate expectations, and seamlessly hands off to campus operations.','Student Admissions & Intake, Pre-Course Nurture & Expectation Setting, Student Feedback & Continuous Improvement (admissions loop)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('68a73ce0-f497-4220-97e8-a9eb350003c9','Squad 3: Process & SOP Pipeline','Document, publish, and maintain all critical operating procedures so every team member has visibility, consistency, and accountability. Eliminate the ''we don''t have a process / yes we do but nobody knows it'' dynamic.','SOP documentation and governance, Laundry & Linen Management, Campus Safety & Medical Response, Brand environment standards, Meeting cadence and action item tracking','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('e125f2de-c215-4a71-8eba-fdc48a3f7248','Squad 3: Systems & Technology','Evaluate, select, implement, and integrate all technology systems needed to support the June pilot and July full launch — led by Jimmy with Tim oversight — ensuring all systems are student-outcome oriented and AI-native where possible.','Student Information & Records Management, Wi-Fi & Campus Connectivity, Inventory Management, Facilities & Maintenance Ticketing','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('fd91d787-8e14-486d-b7d9-027fcbb01fef','Squad 4 — Education & Compliance','Ensure every student has a clear, personalized path from enrollment through graduation to career outcomes — managing GI Bill compliance, program quality, and the post-graduation alumni and outcomes ecosystem.','On-Campus Student Experience & Scheduling (academic), Student Feedback Collection, Graduation Day & Transition Process, Post-Graduation Outcomes & Alumni Engagement, GI Bill / Veteran Benefits Compliance Tracking','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('698622c1-df72-44b9-a11a-e390670b222d','Squad 4 — Education, Compliance & Outcomes','Ensure UHP''s programs meet accreditation and veteran benefits compliance requirements while designing the career outcome pathways that transform veteran students into thriving trade professionals.','Veteran benefits compliance tracking (GI Bill), Accreditation requirements and submission, Curriculum integrity for HVAC, Electrical, Plumbing, Carpentry, Welding, Career pathway design and employer partnerships, Job placement process, Alumni network and champion program (outcomes side), Student outcome tracking and reporting, Graduation process and transition planning','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','Squad 4 — Education, Compliance & Student Outcomes','Ensure every student has a personalized, outcome-oriented experience from admissions through graduation — with compliance, veteran benefits, and post-graduation pathways fully operational.','Student Admissions & Intake (outcome definition layer), Student Feedback Collection, Graduation & Post-Graduation Transition, Student Health & Wellness Monitoring (ongoing)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('46aa223d-8432-4cad-918b-028b8289cbe6','Squad 4: Education & Compliance','Ensure academic program delivery, veteran benefits compliance (GI Bill), student outcomes tracking, feedback loop management, and post-graduation career pathways are systematized, measurable, and continuously improving.','Student Feedback & Continuous Improvement, Graduation & Alumni Transition, Student Information & Records Management (compliance layer)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('38b21714-942e-4ab1-aa99-1164be6cbcf3','Squad 4: Education, Compliance & Outcomes','Ensure every student is tracked from enrollment through graduation and into career placement. Manage veteran benefits compliance, build the alumni network, and close the loop between outcomes data and admissions marketing.','Student Feedback & Continuous Improvement, Graduate Outcomes & Alumni Management, GI Bill and veteran benefits compliance tracking, Personalized outcome goal-setting (index card exercise at Day 1)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('c16396e5-1342-4cc2-bd6e-f5e0d34e6705','Squad 4: Student Experience & Wellbeing','Design and implement a continuous, personalized on-campus student experience — from orientation through graduation — that minimizes micro-misses, supports student wellbeing, and delivers consistent brand moments at every touchpoint.','Student Experience & Wellbeing Monitoring, On-Campus Daily Operations & Scheduling, Graduation & Post-Graduation Transition, Feedback Collection & Continuous Improvement','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('eaa372e6-5959-4465-8344-bee963a17952','Squad 5 — Leadership, Culture & Governance','Build a decision-making structure, accountability culture (above-the-line), and leadership cadence that removes founder-shaped bottlenecks and enables Operation Iron Clock to deliver measurable results monthly.','HR & Workforce Management, Governance & Decision Rights, Monthly EC Reporting (Iron Clock Cadence)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('4828695b-8bf0-4f5a-afa9-96a9bc598a77','Squad 5: Arrival & Student Experience','Own and continuously improve the end-to-end student journey from Arrival Day through the on-campus experience — reducing micro-misses, delivering WOW moments, and ensuring every student feels seen, served, and set up for success from Day 1.','Arrival Day Experience, Student Scheduling & Daily Operations, Culinary / Food Service Operations, Laundry & Campus Housekeeping, Medical / Emergency Protocol','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('31092a26-f660-421d-bf43-c338dde44449','Squad 5: Governance, Culture & Leadership','Build the decision-making frameworks, budget authorities, accountability culture, and leadership development systems that enable UHP to scale from founder-dependent to a distributed, empowered organization — above the line.','HR & Staff Management, Governance & Decision-Making Framework, SOP Documentation & Process Visibility (governance layer)','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('adc39bc5-ddfb-4731-8e49-e32ced06bf91','Squad 5: Leadership, Culture & Governance','Build the governance, decision-making, and cultural infrastructure of UHP so that the organization can scale without founder dependency, eliminate the redline culture, and create a high-trust, above-the-line team.','Governance & Decision-Making, Staff Onboarding & HR Operations, Budget authorization framework, EC monthly reporting, Operation IronClock oversight','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('21293b66-94bb-458e-9666-513186be6d50','Systems & Technology','Design, build, and operate the UHP technology stack — SIS, student PWA, scheduling system, inventory management, BILT integration, WiFi infrastructure, and VA certification system. Make build vs buy decisions with financial rigor.','SIS build/configuration, Student PWA development, WiFi infrastructure project, VA ONCE certification integration, Walmart Workday integration, BILT API','#1AAFA0','d91b0f1c-7dca-4515-96ed-546e7eacb551') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('ab917721-28ae-40ee-b459-40e1e47575ad','Tech','Technology, systems, platform engineering, and SOP automation','Systems / Pipeline / SOP','#1AAFA0',NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squads (id,name,description,area,color,created_by) VALUES ('8a736308-509e-43ce-ae99-659efdbc6c9f','Tech','Technology, systems, platform engineering, and SOP automation','Systems / Pipeline / SOP','#1AAFA0',NULL) ON CONFLICT (id) DO NOTHING;

-- SQUAD_MEMBERS
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('358568b5-93ac-4b9e-923b-03d44a2a3544','0ab16f7e-0e65-41e9-9409-3bfc407366d0','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('bc3cb2ca-2016-43a5-b230-d05713691d8d','0ab16f7e-0e65-41e9-9409-3bfc407366d0','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5075ae7d-c23f-4fff-bda9-69d3c31027bb','0ab16f7e-0e65-41e9-9409-3bfc407366d0','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ee8d5cb3-3ce1-4150-97ec-6f95e45addeb','0ab16f7e-0e65-41e9-9409-3bfc407366d0','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('bc113af1-29ca-416e-a714-7056d81d88e2','0ab16f7e-0e65-41e9-9409-3bfc407366d0','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1f59dbb5-31b1-4c00-a72a-67270e2ec36e','0ab16f7e-0e65-41e9-9409-3bfc407366d0','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d3455455-efe4-4d28-9e45-4248095c0cfd','0ab16f7e-0e65-41e9-9409-3bfc407366d0','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9f9ac622-bbf4-468f-83bb-6e9b7184c972','0ab16f7e-0e65-41e9-9409-3bfc407366d0','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b052be72-7b2e-4c82-aec0-a3d6ae1eba09','0ab16f7e-0e65-41e9-9409-3bfc407366d0','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7c159020-970e-4f5a-bd30-4ddef48fc81e','0ab16f7e-0e65-41e9-9409-3bfc407366d0','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a765e384-1453-4726-b439-3ae4704cb482','0ab16f7e-0e65-41e9-9409-3bfc407366d0','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('411b6ce7-ddd0-4e3e-bd5d-0e09c1c202c1','0ab16f7e-0e65-41e9-9409-3bfc407366d0','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b58729b2-812f-43e9-b158-019921ca1645','0ab16f7e-0e65-41e9-9409-3bfc407366d0','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('97787c50-7dab-473e-9bb6-9635f235abd2','0ab16f7e-0e65-41e9-9409-3bfc407366d0','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('15f52523-968d-44be-a6ef-dd00893f8359','0ab16f7e-0e65-41e9-9409-3bfc407366d0','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8cef31bc-653c-469d-a2a3-4c56cad9124c','0ab16f7e-0e65-41e9-9409-3bfc407366d0','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7f94fac1-3d34-4ae4-bb01-00f9b847d777','174506d1-87ce-4ab0-96a7-f03a6e966abb','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3e87682e-8fff-4bf5-ab1f-e7947cc27256','174506d1-87ce-4ab0-96a7-f03a6e966abb','664e410d-8f71-4404-95ee-0cd86787bba8','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9f2e8b6b-1b46-48b5-a128-72472c007f28','174506d1-87ce-4ab0-96a7-f03a6e966abb','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0b665e1d-fb3f-4ca5-bace-d84be3e65b14','174506d1-87ce-4ab0-96a7-f03a6e966abb','8c089939-7053-45ef-8a85-ff161e736b44','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('706edbd9-1ca6-452d-b91d-7bb8f7aa8ff2','174506d1-87ce-4ab0-96a7-f03a6e966abb','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8657a30e-78ca-4588-bcfc-423c11610722','174506d1-87ce-4ab0-96a7-f03a6e966abb','c57548f8-a764-4dd4-b98f-ba8d67dc74c3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0d29d65f-c9b1-4e0e-ad4f-9ca72b2d7b88','174506d1-87ce-4ab0-96a7-f03a6e966abb','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7f049646-cb44-4666-b9c2-bb7e069629b4','174506d1-87ce-4ab0-96a7-f03a6e966abb','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ec6ca366-6cbc-41c4-8f00-9ca4f1bed950','174506d1-87ce-4ab0-96a7-f03a6e966abb','2f71dfab-32c6-4dbf-ba5e-5563f21df499','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6a7f9115-9394-4a91-b556-2b1f5fe2595f','21293b66-94bb-458e-9666-513186be6d50','d91b0f1c-7dca-4515-96ed-546e7eacb551','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d5285b8c-438c-434c-b649-1fdede9b6e1e','21293b66-94bb-458e-9666-513186be6d50','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a818b748-f43a-4221-87b1-95440502555e','21293b66-94bb-458e-9666-513186be6d50','d2f2285c-22db-462e-bc99-d41b97c76562','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6ffdaa4a-6f93-4c65-b0e5-6d60ed47999f','21293b66-94bb-458e-9666-513186be6d50','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0e7f71da-cbd5-49f8-9595-a886344b9e3a','21293b66-94bb-458e-9666-513186be6d50','6fa9fd83-1866-4d99-a960-ede8b22507c5','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2c37543d-b0c8-46ee-8f56-7bb5cdc5cc94','21293b66-94bb-458e-9666-513186be6d50','ef221491-34f7-431e-b9f4-addc2d8bcba4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4890a099-490d-4512-a1c6-0c881181a8b2','21293b66-94bb-458e-9666-513186be6d50','ea9727e3-3872-40eb-a887-e83b4c03ad01','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4a6a2f31-817f-4039-a10f-79240c35a569','2182ea43-7318-4c95-8d89-e3d574655bb4','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('114b955e-f494-4255-9295-b9957123231b','2182ea43-7318-4c95-8d89-e3d574655bb4','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5ede7318-cda5-429b-ae64-17122139ba2a','2182ea43-7318-4c95-8d89-e3d574655bb4','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2a4f687e-be8b-46dd-b9d2-9c23f3e57df4','2182ea43-7318-4c95-8d89-e3d574655bb4','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f1df3eef-e4d9-4027-b444-890c04c9c56b','2182ea43-7318-4c95-8d89-e3d574655bb4','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9c358568-9dca-42de-a8fc-95b0061d6983','2182ea43-7318-4c95-8d89-e3d574655bb4','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f5617e9d-16fa-487f-bb0d-dd5e2e01a8f9','2182ea43-7318-4c95-8d89-e3d574655bb4','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0fe9d1ce-ffcf-42b0-9e34-5e2faa0e03a7','2182ea43-7318-4c95-8d89-e3d574655bb4','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6f6da37d-4356-4d38-bbab-2c5632f0b295','2182ea43-7318-4c95-8d89-e3d574655bb4','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8be354b2-8d53-4211-adb7-4ab540d067fc','2182ea43-7318-4c95-8d89-e3d574655bb4','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('58f46e77-03c1-42ad-ae21-689e625e4cd3','2182ea43-7318-4c95-8d89-e3d574655bb4','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9ceb2dd7-26f3-41e7-9b8b-72ca2b651d35','2182ea43-7318-4c95-8d89-e3d574655bb4','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('92df682f-99ca-49e7-b174-a1ae4b81a5d5','2182ea43-7318-4c95-8d89-e3d574655bb4','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('385af9a0-df04-4eb9-a940-cc290857bc55','2182ea43-7318-4c95-8d89-e3d574655bb4','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c362c74d-6932-4d93-abf2-ced0837f099a','2182ea43-7318-4c95-8d89-e3d574655bb4','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3161e293-ebe5-4e60-8f2f-4839251ec223','2182ea43-7318-4c95-8d89-e3d574655bb4','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0fe91807-c9ae-4a45-9179-7777e70b833d','31092a26-f660-421d-bf43-c338dde44449','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c74cd454-1b32-4ff5-bbcb-ba25c8845e91','31092a26-f660-421d-bf43-c338dde44449','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('aa12dfaf-3929-4a55-8c80-b7fa5c5eccb2','31092a26-f660-421d-bf43-c338dde44449','c57548f8-a764-4dd4-b98f-ba8d67dc74c3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3dc36d60-89ed-466a-996d-e6c172212d16','31092a26-f660-421d-bf43-c338dde44449','664e410d-8f71-4404-95ee-0cd86787bba8','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('25a65dc3-5651-47cf-a7db-63556c0efb0f','31092a26-f660-421d-bf43-c338dde44449','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('edb95863-30a8-4ca4-a5e1-6dd389875b86','31092a26-f660-421d-bf43-c338dde44449','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a534a0d6-6b6c-4c1d-a7d9-7015a62bb3d9','31092a26-f660-421d-bf43-c338dde44449','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6734ddfd-f03d-494d-a811-7b0334a2a87f','31092a26-f660-421d-bf43-c338dde44449','8c089939-7053-45ef-8a85-ff161e736b44','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('52b2f6cc-7819-4b2d-9052-5c4aecc03455','31092a26-f660-421d-bf43-c338dde44449','2f71dfab-32c6-4dbf-ba5e-5563f21df499','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('369531cb-d118-4766-b774-81596d38f7e4','38b21714-942e-4ab1-aa99-1164be6cbcf3','638cfc1a-6d78-45b7-833a-d591532c8a2d','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b57e40da-9f9e-4ccc-8731-d47a40f25a36','38b21714-942e-4ab1-aa99-1164be6cbcf3','58ab3c87-e458-4805-8dc8-5a8f43f28146','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0bd3c3bf-91ee-4b40-b7f4-be44343447d0','38b21714-942e-4ab1-aa99-1164be6cbcf3','6942f95d-f5cb-4f70-94f3-0d39d5b3365a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1e06fe65-2546-4108-9b06-a7658325a9ee','38b21714-942e-4ab1-aa99-1164be6cbcf3','ebd2e673-31e0-4b47-b7cb-630b6f854e34','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fc2293d8-892c-435d-94ed-4895a3a125df','38b21714-942e-4ab1-aa99-1164be6cbcf3','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d53e5ff8-4fdb-41b1-9e8d-1271fc1b06a4','38b21714-942e-4ab1-aa99-1164be6cbcf3','ef0424a1-7297-47fb-b5e0-461a08796231','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('af1e2b54-2223-496b-8741-67d6072a3fa4','38b21714-942e-4ab1-aa99-1164be6cbcf3','fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('637c7033-5af1-400f-8469-73ac8ce4b576','38b21714-942e-4ab1-aa99-1164be6cbcf3','313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f081e8b2-5066-4a29-a37d-eeb6afe9afdc','38b21714-942e-4ab1-aa99-1164be6cbcf3','c4899576-efa9-4487-a165-2abcc82c33d6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('64564038-ee49-4a95-a088-71675f903497','38b21714-942e-4ab1-aa99-1164be6cbcf3','89a4c23d-aa6a-4069-a591-015ea516fa78','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7c352e65-55c8-4b42-87d7-43c20e9d7890','38b21714-942e-4ab1-aa99-1164be6cbcf3','b5b0e9cd-68e9-419b-ae1a-5043566e84d3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('35d31ea0-e00b-4115-9734-683949ce1902','38b21714-942e-4ab1-aa99-1164be6cbcf3','3b263c41-1588-430b-9061-eeddab5b3157','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('36af77e5-1d24-439c-834b-e5f89be94f9c','38b21714-942e-4ab1-aa99-1164be6cbcf3','84b2c305-fd3b-43b4-aa81-80dd5f9fb717','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a88b3d6d-6f34-472c-a150-62cf47dec201','38b21714-942e-4ab1-aa99-1164be6cbcf3','e5e75575-2ad8-486a-8004-8b067fb23db9','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6d7dc3c3-54b4-4aa4-a246-c8f01090dd60','40610560-6dbc-4bc4-a122-de6f529d645b','d91b0f1c-7dca-4515-96ed-546e7eacb551','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f1930b1f-c798-425f-86be-3307f355b62b','40610560-6dbc-4bc4-a122-de6f529d645b','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('52766219-54f8-4db0-9902-f923cb20d5c2','40610560-6dbc-4bc4-a122-de6f529d645b','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b4af05f1-821f-490b-80c6-c96b286153de','40610560-6dbc-4bc4-a122-de6f529d645b','6fa9fd83-1866-4d99-a960-ede8b22507c5','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3f65eaea-973f-49cb-95d7-cf2231d19791','40610560-6dbc-4bc4-a122-de6f529d645b','d2f2285c-22db-462e-bc99-d41b97c76562','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5a001d72-07bf-46fe-80f8-8fbbb11c2f0d','40610560-6dbc-4bc4-a122-de6f529d645b','ef221491-34f7-431e-b9f4-addc2d8bcba4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5c3f1bcc-1f92-47bd-a596-3b768e34c061','40610560-6dbc-4bc4-a122-de6f529d645b','ea9727e3-3872-40eb-a887-e83b4c03ad01','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b6deb864-75af-4507-9a76-58a56fcde2b4','4500ff55-05ba-4b57-8620-8c83877b4952','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5891f27d-3899-4ed9-b0b6-ceae01dbae5e','4500ff55-05ba-4b57-8620-8c83877b4952','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c07f0a5d-6e9c-445d-a3f1-0240a467d22e','4500ff55-05ba-4b57-8620-8c83877b4952','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b3631198-5173-4212-917e-537f2e642ed9','4500ff55-05ba-4b57-8620-8c83877b4952','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('913e9495-2044-481d-b87a-a620a79bc123','4500ff55-05ba-4b57-8620-8c83877b4952','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('66ad0266-5365-4f55-a38a-7c1e7c4a0c83','4500ff55-05ba-4b57-8620-8c83877b4952','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('644057cc-ae40-4ebc-b81c-62f6ea8ba6a8','4500ff55-05ba-4b57-8620-8c83877b4952','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('98e9cca2-5a74-45a6-99bf-11bf9b7ba617','4500ff55-05ba-4b57-8620-8c83877b4952','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b2d841df-ea3e-4b4b-bc8b-3dc55b44b328','4500ff55-05ba-4b57-8620-8c83877b4952','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6dc39638-23c2-4029-addb-a4ba78936b98','4500ff55-05ba-4b57-8620-8c83877b4952','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ca6eaf4b-89f8-449a-b3ab-23b85ccf4a80','4500ff55-05ba-4b57-8620-8c83877b4952','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6185373b-6cdb-431d-b16f-31716a22ebe9','4500ff55-05ba-4b57-8620-8c83877b4952','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('eefde5f8-6a19-4891-8a34-2abec45d370c','4500ff55-05ba-4b57-8620-8c83877b4952','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3372853a-7b1b-451b-908a-6258eb4d37e5','4500ff55-05ba-4b57-8620-8c83877b4952','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('38e2e8a5-9059-42c5-aaff-f39bbeee6fdf','4500ff55-05ba-4b57-8620-8c83877b4952','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6885f68a-df5d-4ade-a188-b2f2707404d0','4500ff55-05ba-4b57-8620-8c83877b4952','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ab39f78e-5649-4484-b683-e4fa0dc7b4ec','46aa223d-8432-4cad-918b-028b8289cbe6','638cfc1a-6d78-45b7-833a-d591532c8a2d','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('389f8860-0c07-4315-bf57-59d03ec3b759','46aa223d-8432-4cad-918b-028b8289cbe6','58ab3c87-e458-4805-8dc8-5a8f43f28146','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('23a5b3e7-8643-432d-89a9-9f05d6ccf66d','46aa223d-8432-4cad-918b-028b8289cbe6','6942f95d-f5cb-4f70-94f3-0d39d5b3365a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2c8f5a20-a154-443d-9566-21f303125701','46aa223d-8432-4cad-918b-028b8289cbe6','ebd2e673-31e0-4b47-b7cb-630b6f854e34','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('16b0dd61-4aa7-4728-b201-0016c273f7cc','46aa223d-8432-4cad-918b-028b8289cbe6','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('56c8df98-21b0-4fa4-bb76-3a1c65b03612','46aa223d-8432-4cad-918b-028b8289cbe6','ef0424a1-7297-47fb-b5e0-461a08796231','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4b3806f1-028f-4341-afcb-acbbc9ec045d','46aa223d-8432-4cad-918b-028b8289cbe6','fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b51d1d37-f8f6-46ed-aee1-20bb577d4534','46aa223d-8432-4cad-918b-028b8289cbe6','b5b0e9cd-68e9-419b-ae1a-5043566e84d3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b89be201-6a4f-4181-99ab-4444122190de','46aa223d-8432-4cad-918b-028b8289cbe6','313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7c8e281b-bdb7-44de-86d4-215bbfd65614','46aa223d-8432-4cad-918b-028b8289cbe6','3b263c41-1588-430b-9061-eeddab5b3157','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('34a31714-3f91-41e1-a687-77fb9dc473f6','46aa223d-8432-4cad-918b-028b8289cbe6','c4899576-efa9-4487-a165-2abcc82c33d6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('54c5a938-01ad-4811-bb2c-6f4076823f0e','46aa223d-8432-4cad-918b-028b8289cbe6','84b2c305-fd3b-43b4-aa81-80dd5f9fb717','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6ee0e81a-a972-4478-8c5b-9203bc6e341b','46aa223d-8432-4cad-918b-028b8289cbe6','89a4c23d-aa6a-4069-a591-015ea516fa78','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('795d21de-24d8-4607-9673-f0de5aa7bc05','46aa223d-8432-4cad-918b-028b8289cbe6','e5e75575-2ad8-486a-8004-8b067fb23db9','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fddcad4c-f6c7-4064-800a-02185796bbd3','4828695b-8bf0-4f5a-afa9-96a9bc598a77','07157515-7846-49fd-b1d1-7b5e6875b593','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('90e92217-ff9a-421c-bbc4-6497a48dbce5','4828695b-8bf0-4f5a-afa9-96a9bc598a77','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('aecc9085-f384-4441-a03c-39ff6e0d8ea7','4828695b-8bf0-4f5a-afa9-96a9bc598a77','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6dacea33-f061-422b-b30a-e431bdba921b','4828695b-8bf0-4f5a-afa9-96a9bc598a77','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fa152626-69ce-438c-9b67-483dbca2deeb','4828695b-8bf0-4f5a-afa9-96a9bc598a77','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5092bea6-f69c-428c-9696-d8f590e236dd','4828695b-8bf0-4f5a-afa9-96a9bc598a77','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('af2eb4c6-b923-4586-a229-cf2a447bbd20','4828695b-8bf0-4f5a-afa9-96a9bc598a77','0f579888-b4aa-405b-a599-e9289b294b65','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('90db5d79-33fe-4141-a5ba-c1d0996701b5','4828695b-8bf0-4f5a-afa9-96a9bc598a77','2b05d279-72e1-45d1-826d-223e095dc639','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('eb3af5c6-993c-48d3-817d-32596736afe7','4828695b-8bf0-4f5a-afa9-96a9bc598a77','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('674841ed-9844-44d6-b277-ea9cdcf99571','4828695b-8bf0-4f5a-afa9-96a9bc598a77','92a6d66d-792f-4695-98d7-0ee1ca73bbbc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8dc3e165-ceec-4138-a1e0-df0eb5d8bea1','4828695b-8bf0-4f5a-afa9-96a9bc598a77','72e79893-cbe1-4927-bcb9-d4dbb8dfe464','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2b4e429d-f4b1-463f-b78e-eeff27f38c36','4828695b-8bf0-4f5a-afa9-96a9bc598a77','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('16ca2d8f-3b26-4b74-95dd-d4f27ba821cf','68a73ce0-f497-4220-97e8-a9eb350003c9','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e87b259f-5311-4625-a8a9-38d2b4bde694','68a73ce0-f497-4220-97e8-a9eb350003c9','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f3c01f6c-a990-4492-a1a4-153df144207b','68a73ce0-f497-4220-97e8-a9eb350003c9','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('faf17c35-da97-40d0-badb-ae782df5a3db','68a73ce0-f497-4220-97e8-a9eb350003c9','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('555dfb61-4996-4d8b-b2fa-cd68d7c42f98','68a73ce0-f497-4220-97e8-a9eb350003c9','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b6df8ead-1ac1-4095-9fc1-ae04c7b098f0','68a73ce0-f497-4220-97e8-a9eb350003c9','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2f549da5-5923-45ac-80c6-1d0f4c7c8f38','68a73ce0-f497-4220-97e8-a9eb350003c9','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3776fe28-ab0a-4765-92fe-cebed10e6d11','68a73ce0-f497-4220-97e8-a9eb350003c9','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c723301e-a378-42c5-aecc-9ebb74a9a838','68a73ce0-f497-4220-97e8-a9eb350003c9','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f3e384f7-2403-4785-a4e4-fb1d0d2975e8','68a73ce0-f497-4220-97e8-a9eb350003c9','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('34ba0468-cc76-42b7-a53f-20019408f606','68a73ce0-f497-4220-97e8-a9eb350003c9','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('41afdabb-76bf-42e6-ab9a-e7b69aa51a11','68a73ce0-f497-4220-97e8-a9eb350003c9','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('949094db-0093-47d8-809c-d383466ccd5f','68a73ce0-f497-4220-97e8-a9eb350003c9','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('87b07489-b3fe-49f1-a2ac-3beb883971fa','68a73ce0-f497-4220-97e8-a9eb350003c9','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('305c22e7-138d-4db1-bd7b-2fecbe6bfc45','68a73ce0-f497-4220-97e8-a9eb350003c9','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('504c39d0-7dec-47a5-b502-0e50413465a9','68a73ce0-f497-4220-97e8-a9eb350003c9','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5ef94574-77a5-4f17-9f5e-e05d7cf3e423','698622c1-df72-44b9-a11a-e390670b222d','638cfc1a-6d78-45b7-833a-d591532c8a2d','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9cd09d0f-179a-4530-ae2c-345924a0e174','698622c1-df72-44b9-a11a-e390670b222d','58ab3c87-e458-4805-8dc8-5a8f43f28146','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7aa9724c-1a57-4963-9606-9f4630969ff3','698622c1-df72-44b9-a11a-e390670b222d','6942f95d-f5cb-4f70-94f3-0d39d5b3365a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('dbc3e56a-b966-4886-8acc-a1264017aadb','698622c1-df72-44b9-a11a-e390670b222d','ebd2e673-31e0-4b47-b7cb-630b6f854e34','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e098f00a-ca10-41c4-b25a-bc0ae8eff224','698622c1-df72-44b9-a11a-e390670b222d','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2a593f88-a8ad-414d-ba88-82770bfef664','698622c1-df72-44b9-a11a-e390670b222d','ef0424a1-7297-47fb-b5e0-461a08796231','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fe454ae3-db22-433b-bf4c-eb0a53e608ca','698622c1-df72-44b9-a11a-e390670b222d','fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('797672a3-80be-45ed-8a37-3ee3dce757aa','698622c1-df72-44b9-a11a-e390670b222d','b5b0e9cd-68e9-419b-ae1a-5043566e84d3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2f6168d1-70c5-4726-a261-1858ac89d293','698622c1-df72-44b9-a11a-e390670b222d','3b263c41-1588-430b-9061-eeddab5b3157','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8f334e59-af32-4c88-88cf-cc5150e13598','698622c1-df72-44b9-a11a-e390670b222d','84b2c305-fd3b-43b4-aa81-80dd5f9fb717','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('30da4e6a-c6cd-422b-b86d-2b8415281510','698622c1-df72-44b9-a11a-e390670b222d','313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9d6d1115-ce00-49c4-91df-f6c7d5a4db0f','698622c1-df72-44b9-a11a-e390670b222d','c4899576-efa9-4487-a165-2abcc82c33d6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4f8aeddc-c283-4ebc-a204-b929b9e72af0','698622c1-df72-44b9-a11a-e390670b222d','89a4c23d-aa6a-4069-a591-015ea516fa78','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('60364fd5-1b74-40c4-9107-a62600e7adf7','698622c1-df72-44b9-a11a-e390670b222d','e5e75575-2ad8-486a-8004-8b067fb23db9','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('10fbd08e-389c-4ee6-89d6-d83e33181b2e','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f753a415-3f5b-486e-a426-5a64739cc19e','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('cafb641c-79a7-44dd-a4ac-a65836ca5e2f','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','07157515-7846-49fd-b1d1-7b5e6875b593','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('010a2762-f719-479c-a4bf-e9bc31625bb6','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('842ed051-b98c-4363-a84f-c5cb4fce8210','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f583d62c-d3c9-4367-841e-586d65c60360','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('094edeba-0b8b-4d91-980f-e0dd8abfcd58','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','0f579888-b4aa-405b-a599-e9289b294b65','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2cda5dc9-38c0-4c31-b361-71a227ac5acf','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','2b05d279-72e1-45d1-826d-223e095dc639','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b9eb9b7e-4165-4e66-8204-195b2b0d3502','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f0f8ac1e-c637-41a3-be2d-66758f9b6588','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','92a6d66d-792f-4695-98d7-0ee1ca73bbbc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('cd56c4ad-adfb-4ce0-8c1c-e1580b8f89f3','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','72e79893-cbe1-4927-bcb9-d4dbb8dfe464','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('469ce92e-5c70-4f80-b253-8a272b841d1b','6d49cdf8-9cbd-43d2-a16a-a9b18674ac4d','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('997230b9-8871-4dd7-b2d3-1f15b7148eaa','741abc49-633e-4a67-9180-881274078fc9','d91b0f1c-7dca-4515-96ed-546e7eacb551','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1a267b4d-1365-42db-870e-e6a9ce866390','741abc49-633e-4a67-9180-881274078fc9','ea9727e3-3872-40eb-a887-e83b4c03ad01','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b3f192b1-b9d0-4203-8707-95883712f0a7','741abc49-633e-4a67-9180-881274078fc9','07157515-7846-49fd-b1d1-7b5e6875b593','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e95ea36b-5d44-484f-950c-dc8e66f45683','741abc49-633e-4a67-9180-881274078fc9','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b31d8630-1a87-470d-b667-4beeb3019001','741abc49-633e-4a67-9180-881274078fc9','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f8bc27f9-6744-4ee3-825a-d34fb42eb065','741abc49-633e-4a67-9180-881274078fc9','6103ae42-29a8-451d-a579-f2d0ac30ed42','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('02c7d0b4-0208-4ddd-be48-07274d3f5b04','741abc49-633e-4a67-9180-881274078fc9','8c089939-7053-45ef-8a85-ff161e736b44','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8366bd62-4fd2-4ea3-ae17-2785548d09c3','741abc49-633e-4a67-9180-881274078fc9','e5e75575-2ad8-486a-8004-8b067fb23db9','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('94464739-8ce6-4bbc-9558-5d7d91061184','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','07157515-7846-49fd-b1d1-7b5e6875b593','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0c816a9b-d947-4436-a57f-28a76fa789be','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e744f6cf-c500-48df-a2c1-e20c9fc9612c','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a3025ec1-a788-4c97-93cc-891e6c3390c1','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('00bc1ac7-ee75-4f99-bfb5-14c6dd9c71d0','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','0f579888-b4aa-405b-a599-e9289b294b65','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('31938321-9b46-4287-9f8e-2da0e557b1f1','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('015a9b1b-bffb-4bfa-9344-94b289cf7187','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('817c9516-8121-4d9f-a16d-34738a6c2067','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','2b05d279-72e1-45d1-826d-223e095dc639','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('158eada9-94b5-41b9-8522-3bc87a4e23e1','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5692ddd8-3d90-46ba-bb3b-65bd7e556a85','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','92a6d66d-792f-4695-98d7-0ee1ca73bbbc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('513d3e98-7671-4b64-a64f-7e9cd8273142','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','72e79893-cbe1-4927-bcb9-d4dbb8dfe464','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9bdd44c5-0a60-48a9-a0d2-5acd9e5d22de','7843a4aa-4276-4bef-9c58-2d4a7be1cb2f','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('60171b68-edaf-4e7c-8104-0207e12e2e04','863ac553-3a13-42c2-93d8-98514e8eae62','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('cd46010f-d0d5-4142-bbd5-e087a2e96255','863ac553-3a13-42c2-93d8-98514e8eae62','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a1db34c1-00b8-4303-a0e2-4d2318cf4615','863ac553-3a13-42c2-93d8-98514e8eae62','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8e6d0678-bcb7-461f-be9e-8667a2c03e1c','863ac553-3a13-42c2-93d8-98514e8eae62','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a1f377aa-8df6-464c-89fc-ebbc3ae37b2a','863ac553-3a13-42c2-93d8-98514e8eae62','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f0f8bdbc-5c51-4a6e-8faf-9bf46dad7a33','863ac553-3a13-42c2-93d8-98514e8eae62','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2a9f5f58-ac4c-4037-a059-eb2d4af56d68','863ac553-3a13-42c2-93d8-98514e8eae62','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('53dad2a8-5b19-485b-8750-49759f2fcf5e','863ac553-3a13-42c2-93d8-98514e8eae62','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('de930887-9e5c-4983-90fa-53ede31920b5','863ac553-3a13-42c2-93d8-98514e8eae62','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('af1561a0-a91f-48cf-8a4f-5ed06a785119','863ac553-3a13-42c2-93d8-98514e8eae62','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c5f4c940-6be6-4040-b869-811476fd42cc','863ac553-3a13-42c2-93d8-98514e8eae62','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1800e835-ce33-4475-9241-80d66e728316','863ac553-3a13-42c2-93d8-98514e8eae62','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('75853216-79b1-4323-8804-f7e96829d653','863ac553-3a13-42c2-93d8-98514e8eae62','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('627d1f0c-6d43-4a6a-887c-fb39a51078d1','863ac553-3a13-42c2-93d8-98514e8eae62','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('345caee2-bc23-4b11-8004-556e8b5c078d','863ac553-3a13-42c2-93d8-98514e8eae62','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ab8b8248-d8d1-4bd4-b4bd-f7d13e5f60b2','863ac553-3a13-42c2-93d8-98514e8eae62','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('25cc3c51-add5-4495-b09e-7fe02841d6cb','8a736308-509e-43ce-ae99-659efdbc6c9f','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e59a7f1e-d05f-4036-8b6a-96e175e0f338','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','d91b0f1c-7dca-4515-96ed-546e7eacb551','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4a2c0cee-5a44-47cb-be30-45ff8cbccc45','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b684b47a-0393-4f6f-bb48-4f8d3967dd86','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f947622a-12d2-40c4-bb31-423d7ca0c31b','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','6fa9fd83-1866-4d99-a960-ede8b22507c5','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2377a934-952e-4b1c-ac1a-c69105dd7713','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','d2f2285c-22db-462e-bc99-d41b97c76562','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9a063727-e75c-4a11-9625-0e38a6b7407b','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','ef221491-34f7-431e-b9f4-addc2d8bcba4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4880043b-1d0c-47fc-a000-4b19c6eb5b1b','8f2e35d4-5791-4bfc-a836-4959e1f9df5b','ea9727e3-3872-40eb-a887-e83b4c03ad01','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2f68363c-c915-40df-9ac2-3d5f4d4a8938','8f3a9586-4aef-4928-874d-f4e8413c2ac1','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('65231f18-0196-48ce-b483-630397221ce3','8f3a9586-4aef-4928-874d-f4e8413c2ac1','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9f768ce6-f1ae-4293-a127-f1b4e0600c5a','8f3a9586-4aef-4928-874d-f4e8413c2ac1','c57548f8-a764-4dd4-b98f-ba8d67dc74c3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('64e34ed5-c5d2-4d52-850f-e4663a75bf27','8f3a9586-4aef-4928-874d-f4e8413c2ac1','664e410d-8f71-4404-95ee-0cd86787bba8','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3d8be445-5485-40a2-ad3c-8f36e09e07bf','8f3a9586-4aef-4928-874d-f4e8413c2ac1','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3671decd-c5fd-4689-bf73-b83063927eb1','8f3a9586-4aef-4928-874d-f4e8413c2ac1','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('40045ee8-f666-4e89-9685-8162011acada','8f3a9586-4aef-4928-874d-f4e8413c2ac1','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('272fb44c-b2b3-43b1-b831-28fede647be5','8f3a9586-4aef-4928-874d-f4e8413c2ac1','8c089939-7053-45ef-8a85-ff161e736b44','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2111dee9-12c2-4402-a397-90780be3959e','8f3a9586-4aef-4928-874d-f4e8413c2ac1','2f71dfab-32c6-4dbf-ba5e-5563f21df499','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c0dda136-fb3c-4d17-b1fa-064ac7721f1d','a39c3b7d-20a9-4823-8604-5ede95422845','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('baef2573-d7fe-4916-bb7d-8381f9da9c6a','a39c3b7d-20a9-4823-8604-5ede95422845','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6e649228-c05c-47f3-b8c3-ca784e238b75','a39c3b7d-20a9-4823-8604-5ede95422845','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4d7adf52-bd1f-40cb-aa1c-e1d8cea1124f','a39c3b7d-20a9-4823-8604-5ede95422845','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9e37e6fa-72f0-4cf3-b469-ba659e61af65','a39c3b7d-20a9-4823-8604-5ede95422845','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('03a1a2bb-7ff6-44c9-a9db-c9ec8af806cc','a39c3b7d-20a9-4823-8604-5ede95422845','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4bd373cb-776a-4a35-be1b-6f3a6f61d454','a39c3b7d-20a9-4823-8604-5ede95422845','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('40863ffa-dc03-4bbb-925b-2891e9c10e40','a39c3b7d-20a9-4823-8604-5ede95422845','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ad0823ce-b574-44af-94c5-12543a938bf4','a39c3b7d-20a9-4823-8604-5ede95422845','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('af418af1-fdfd-41c0-a073-761747ae60d4','a39c3b7d-20a9-4823-8604-5ede95422845','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('4368186b-eb59-4586-890b-e438e97dc047','a39c3b7d-20a9-4823-8604-5ede95422845','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('bf39c3ba-c009-46fe-b3ee-465ad5bd92a9','a39c3b7d-20a9-4823-8604-5ede95422845','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('73a9b907-983b-4b7e-9bba-93c842de3189','a39c3b7d-20a9-4823-8604-5ede95422845','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3a901cd8-c784-418e-b597-adc24768db16','a39c3b7d-20a9-4823-8604-5ede95422845','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e1f12aa5-f9be-4342-8009-6447b91afdb7','a39c3b7d-20a9-4823-8604-5ede95422845','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('03d8ec90-1b5c-406a-9af9-d7cccae38ada','a39c3b7d-20a9-4823-8604-5ede95422845','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e78d776b-2f15-4a23-a56e-438de4de4165','ab917721-28ae-40ee-b459-40e1e47575ad','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a990514a-ff26-44e4-981f-ff1e2646f1c6','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7e3604a6-ce90-40c1-8844-c0dcc9806e89','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('409c7971-5f18-45ef-8582-4447b17d60c1','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2e3a0444-5411-4f94-9d3b-371802c5bbf9','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2739dd8a-5174-4867-ba65-c6d24e8a12c2','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('949bbbb3-c0f0-45ac-b1e1-74038212bc23','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5e73a79d-e9d5-453c-9ec2-eea560b2e4c6','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e5932b07-1ab8-4591-a137-40064805edf4','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('19f5c40d-8136-45b6-b1a9-df5dcecf2bb2','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e9353cd1-2573-4b2e-85c7-aa72eeed6347','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('70de931d-fe91-4d38-b368-94b550832d3c','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('84d77719-27b6-407b-8d9e-2aa1c6cf93b9','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('44e52212-c2ac-4093-bc91-051432188496','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5a19dd4c-c3b9-48fa-bd47-d698e6961d84','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ecfe62d5-7b48-4897-809c-5cb7585f03a4','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('60e5d705-faa2-46b0-a9ac-a8a2d69cad13','ad1941f9-2811-48ae-a215-fe5ae7cbd7f9','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3194a05f-fb9a-4697-b7c1-cce439368952','adc39bc5-ddfb-4731-8e49-e32ced06bf91','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('45415d9d-e238-4665-b4a8-3870c7986717','adc39bc5-ddfb-4731-8e49-e32ced06bf91','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9e7d53d0-8cef-4317-b32f-a07e938413d8','adc39bc5-ddfb-4731-8e49-e32ced06bf91','c57548f8-a764-4dd4-b98f-ba8d67dc74c3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9aa6b145-a2d4-4fd7-84b9-87337d61ddd6','adc39bc5-ddfb-4731-8e49-e32ced06bf91','664e410d-8f71-4404-95ee-0cd86787bba8','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b53ce1d5-f775-42e4-91cd-9d81ae78aced','adc39bc5-ddfb-4731-8e49-e32ced06bf91','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('bd4fabfb-de04-4013-90bc-b86693f213f1','adc39bc5-ddfb-4731-8e49-e32ced06bf91','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d22f5441-2ae0-4343-9f67-b45ff38a6783','adc39bc5-ddfb-4731-8e49-e32ced06bf91','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1fce8fca-62a5-4dfd-b760-b499bd54a978','adc39bc5-ddfb-4731-8e49-e32ced06bf91','8c089939-7053-45ef-8a85-ff161e736b44','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('88d52d13-3a4e-464a-bde7-cd775039ebaf','adc39bc5-ddfb-4731-8e49-e32ced06bf91','2f71dfab-32c6-4dbf-ba5e-5563f21df499','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7d21fa51-9488-4434-bf30-e2aa25fff616','ca5d05b3-aa5b-4b80-a373-22dc63131266','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7e67ec36-5fc6-438a-9ddc-3768418935e5','ca5d05b3-aa5b-4b80-a373-22dc63131266','57e0eb37-c168-44cd-8b83-12f0579b53a1','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d0787057-57da-4156-a9ac-5b29257d6683','ca5d05b3-aa5b-4b80-a373-22dc63131266','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a3d08055-604c-411c-8db2-8c38d75f0bd7','ca5d05b3-aa5b-4b80-a373-22dc63131266','578d2c56-988b-4b44-925b-371b6519dcf3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1b18f223-969c-46eb-9f19-96aa53893796','ca5d05b3-aa5b-4b80-a373-22dc63131266','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('daca03d9-7fc8-4390-b975-167d26d24f96','ca5d05b3-aa5b-4b80-a373-22dc63131266','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b4662953-3f83-4497-95f9-13bb8778e8a6','ca5d05b3-aa5b-4b80-a373-22dc63131266','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('68ea2edb-ad4e-4ec3-b6a7-7598ddad4e43','ca5d05b3-aa5b-4b80-a373-22dc63131266','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('613344c9-e3b2-4df3-b661-56f8c82c803c','ca5d05b3-aa5b-4b80-a373-22dc63131266','017c2ee8-c408-4e02-9040-24980609e6c2','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('52473710-d4e3-414e-a589-c811a31a8d08','ca5d05b3-aa5b-4b80-a373-22dc63131266','d8ed5f5f-8319-4f22-bb26-a940fdbe6df9','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7dde102c-9a35-4033-b635-91f82c4e0eff','ca5d05b3-aa5b-4b80-a373-22dc63131266','cc92be4d-97a9-4060-9b72-8e23f94ce778','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('92bc143e-2e0b-4730-a9de-aa8905b044de','ca5d05b3-aa5b-4b80-a373-22dc63131266','6c815f90-525e-483d-ae6d-28e0f692be95','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ae4078e3-e5f9-493d-af7f-95770bc452a5','ca5d05b3-aa5b-4b80-a373-22dc63131266','de891181-0531-4df4-955c-863ef1a15a7b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('16e36618-3abd-4181-8b90-6789181780ff','ca5d05b3-aa5b-4b80-a373-22dc63131266','9d774cb8-b310-4b70-a208-a64061833efc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e5097d1b-6fec-4733-a0d6-14952217011c','ca5d05b3-aa5b-4b80-a373-22dc63131266','5cd0ea63-92b9-4f20-aebf-a287f041a851','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b27c3386-cacd-4276-9844-a3c233203c5e','ca5d05b3-aa5b-4b80-a373-22dc63131266','23de3d8d-de6a-418b-a8e0-0b8bbc80f054','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e3abff2c-cd43-47b0-9fe5-8184f1b7326f','d578f04a-5845-422c-a721-7c7dac4d43bf','07157515-7846-49fd-b1d1-7b5e6875b593','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c5e10466-74ef-47e0-9e3f-7f2f7ba9c19a','d578f04a-5845-422c-a721-7c7dac4d43bf','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('37d6ac9c-b448-4dae-b569-fe67cb7b0f2d','d578f04a-5845-422c-a721-7c7dac4d43bf','71544cd9-44ea-41ab-8156-16cf856b611b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fd056435-6962-49f3-9b52-c9c9bead7373','d578f04a-5845-422c-a721-7c7dac4d43bf','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('7b79be3e-2482-4f22-9528-82fe7d40a47b','d578f04a-5845-422c-a721-7c7dac4d43bf','748f5ce2-1526-4d20-8bd2-2a8d61d9826a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c6062a5e-0a47-42d1-a528-e1f9b0bb0657','d578f04a-5845-422c-a721-7c7dac4d43bf','e72b8c83-372f-4bac-9348-248b1cd9259a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('591dc015-fefd-46b1-8640-61f76430aa0a','d578f04a-5845-422c-a721-7c7dac4d43bf','0f579888-b4aa-405b-a599-e9289b294b65','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0cabd90e-83d4-4997-93a0-41742f53a36e','d578f04a-5845-422c-a721-7c7dac4d43bf','2b05d279-72e1-45d1-826d-223e095dc639','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('effad8f4-733b-45a3-a5f2-b642c5e1246d','d578f04a-5845-422c-a721-7c7dac4d43bf','aa3fd3dc-8f2f-4b43-8b1f-de634ccfef5b','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('88a87e0d-972a-4fa6-af25-86c18b0ec072','d578f04a-5845-422c-a721-7c7dac4d43bf','92a6d66d-792f-4695-98d7-0ee1ca73bbbc','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e1299119-3c77-44e9-a7f4-dc2c7cd7d8e8','d578f04a-5845-422c-a721-7c7dac4d43bf','72e79893-cbe1-4927-bcb9-d4dbb8dfe464','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c087c4c8-d4b9-49df-8662-90896bb667c0','d578f04a-5845-422c-a721-7c7dac4d43bf','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('96d89b76-b25b-4a3c-9a5b-0252eb537a68','e125f2de-c215-4a71-8eba-fdc48a3f7248','d91b0f1c-7dca-4515-96ed-546e7eacb551','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b4521606-6fe6-4a87-8d65-c5adef67653c','e125f2de-c215-4a71-8eba-fdc48a3f7248','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f23cb877-cded-4606-9a09-6b3a2dda0048','e125f2de-c215-4a71-8eba-fdc48a3f7248','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5c297828-22b9-45da-91e4-6d4499e4b283','e125f2de-c215-4a71-8eba-fdc48a3f7248','6fa9fd83-1866-4d99-a960-ede8b22507c5','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('34803c3f-8969-43df-aa38-b29206ccf929','e125f2de-c215-4a71-8eba-fdc48a3f7248','d2f2285c-22db-462e-bc99-d41b97c76562','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('77991060-26d4-4249-a9a1-cb8e9cecd84d','e125f2de-c215-4a71-8eba-fdc48a3f7248','ef221491-34f7-431e-b9f4-addc2d8bcba4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b611bba6-b222-4f82-8a89-6959d0196f36','e125f2de-c215-4a71-8eba-fdc48a3f7248','ea9727e3-3872-40eb-a887-e83b4c03ad01','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c1ecd835-0618-40a4-97fe-766f997893d4','e125f2de-c215-4a71-8eba-fdc48a3f7248','bfe6265b-8749-4158-87d8-c336c855ab15','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9ef1412f-7bdc-4a3f-ae5e-3db02da35a85','e125f2de-c215-4a71-8eba-fdc48a3f7248','e83c260e-8a62-4e49-b5fe-8705744d6531','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c50a242c-6dd1-4878-b2c4-fe4325fd97e2','eaa372e6-5959-4465-8344-bee963a17952','ea9727e3-3872-40eb-a887-e83b4c03ad01','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('96256b28-bf6f-4b0a-ab3b-de67d85a152d','eaa372e6-5959-4465-8344-bee963a17952','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('53314310-49e3-4ca4-965e-349ed3c1b903','eaa372e6-5959-4465-8344-bee963a17952','c57548f8-a764-4dd4-b98f-ba8d67dc74c3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ceb46da6-4141-44eb-9758-18f0c51468e6','eaa372e6-5959-4465-8344-bee963a17952','664e410d-8f71-4404-95ee-0cd86787bba8','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('88090101-aa1d-4e7a-a7e3-51af438c13dd','eaa372e6-5959-4465-8344-bee963a17952','34be5f14-dd0f-41c2-adef-f020dcd38dda','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a130357c-bfb0-4077-b0e1-4ee97d498122','eaa372e6-5959-4465-8344-bee963a17952','c8f92242-5e06-4c9b-abc2-ffdcbd1e5753','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f0d540d2-79bb-4f33-a4c5-4a6dcd048523','eaa372e6-5959-4465-8344-bee963a17952','cb2aa510-b45d-4b82-902f-2144764960c4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b02c9777-629f-4c50-9311-2705997e2901','eaa372e6-5959-4465-8344-bee963a17952','8c089939-7053-45ef-8a85-ff161e736b44','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('2d65f413-1656-4486-9c94-6f1c244cb8e0','eaa372e6-5959-4465-8344-bee963a17952','2f71dfab-32c6-4dbf-ba5e-5563f21df499','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e06360e9-c492-48ae-b0cb-9a59dfa98653','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','638cfc1a-6d78-45b7-833a-d591532c8a2d','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('a07bcd4a-e37e-4a3b-9e2e-be92375a7322','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','58ab3c87-e458-4805-8dc8-5a8f43f28146','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b74a83b1-482f-4592-8a7b-1d2c03f5de0f','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','6942f95d-f5cb-4f70-94f3-0d39d5b3365a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('59cd32fc-fdc7-4563-8d7b-f7e484d17e30','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','ebd2e673-31e0-4b47-b7cb-630b6f854e34','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('314b0ca6-3e3f-4a49-b49d-cf4fbc844e43','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8ff81d8c-62df-4b31-98be-f5a66bb87f14','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','ef0424a1-7297-47fb-b5e0-461a08796231','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f14aed65-db04-4901-ad61-11d1fad4206b','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('25ea2b9f-ddf2-40f1-82fe-b115c548288f','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','b5b0e9cd-68e9-419b-ae1a-5043566e84d3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fb7c1798-7c1f-4c62-a238-c9a01c60372f','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('ffa893d9-84a5-4572-88ed-43328e61ef0d','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','3b263c41-1588-430b-9061-eeddab5b3157','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('51d53a53-0bfd-496b-b7d2-e1af09281a2a','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','c4899576-efa9-4487-a165-2abcc82c33d6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('c34979d5-7e23-48aa-a5cc-b0dcce613b64','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','84b2c305-fd3b-43b4-aa81-80dd5f9fb717','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('61375b96-e22e-4862-bf07-6e5c7a27643f','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','89a4c23d-aa6a-4069-a591-015ea516fa78','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('efdfe478-4dbb-47c1-a2bc-24b97630143e','ef41a365-ffa1-4859-9a6e-1ba597fe5dbf','e5e75575-2ad8-486a-8004-8b067fb23db9','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('68f9d5c1-3d88-4580-99a1-6f3d23533e27','f5fa899e-96e6-4987-812f-eb263fe6d678','6103ae42-29a8-451d-a579-f2d0ac30ed42','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b5377c96-7720-41f3-b12f-5f8f07f78b7c','f5fa899e-96e6-4987-812f-eb263fe6d678','b61775d4-b124-4ba8-a113-9052962e51f3','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('9c7e74ce-9c04-441d-b889-1dd1c600b285','f5fa899e-96e6-4987-812f-eb263fe6d678','d91b0f1c-7dca-4515-96ed-546e7eacb551','lead') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3b227470-b2ba-4746-a863-69a4bc5075e3','f5fa899e-96e6-4987-812f-eb263fe6d678','6fa9fd83-1866-4d99-a960-ede8b22507c5','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('f44f625c-2983-4dc7-a7b5-062ee845ee40','f5fa899e-96e6-4987-812f-eb263fe6d678','d2f2285c-22db-462e-bc99-d41b97c76562','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('e3a5d883-555a-45bb-a21d-5ea8076f26d6','f5fa899e-96e6-4987-812f-eb263fe6d678','ef221491-34f7-431e-b9f4-addc2d8bcba4','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0b73413e-75ed-4a24-b3ae-3e0dc0bc9698','f5fa899e-96e6-4987-812f-eb263fe6d678','ea9727e3-3872-40eb-a887-e83b4c03ad01','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d6e4253f-5cb7-49aa-9659-d5c1648d7c7a','f5fa899e-96e6-4987-812f-eb263fe6d678','e79cebf3-66b6-45a7-88f8-791e2d75a045','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('8a6e341d-78c1-4145-8b7f-81fd331c6ee3','fd91d787-8e14-486d-b7d9-027fcbb01fef','638cfc1a-6d78-45b7-833a-d591532c8a2d','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d55febbe-530d-40a1-a302-bbbe9c4ab628','fd91d787-8e14-486d-b7d9-027fcbb01fef','6942f95d-f5cb-4f70-94f3-0d39d5b3365a','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('0c28d9f1-c807-4c91-9ebb-2529442a8ee8','fd91d787-8e14-486d-b7d9-027fcbb01fef','b346b6a1-2c27-4c44-a0df-7fd6789b76c6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1c2b5a96-3e14-493d-9244-d6600cc34ca0','fd91d787-8e14-486d-b7d9-027fcbb01fef','fbd09a15-ff4e-42b4-8dd6-1d3c01b8e649','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('379350f0-66c4-41b1-80b1-0b7b1745f694','fd91d787-8e14-486d-b7d9-027fcbb01fef','58ab3c87-e458-4805-8dc8-5a8f43f28146','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('fd9f770b-5124-412a-85e7-dad119a1ef02','fd91d787-8e14-486d-b7d9-027fcbb01fef','ebd2e673-31e0-4b47-b7cb-630b6f854e34','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('499731ce-2c57-4a12-9c8b-381397031dc1','fd91d787-8e14-486d-b7d9-027fcbb01fef','ef0424a1-7297-47fb-b5e0-461a08796231','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('6992c7a6-06a6-4550-8ec2-ed8b7a8364c7','fd91d787-8e14-486d-b7d9-027fcbb01fef','b5b0e9cd-68e9-419b-ae1a-5043566e84d3','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('5a181fbf-7e04-494b-83d7-a2ed3bef7218','fd91d787-8e14-486d-b7d9-027fcbb01fef','313bda7b-ddd1-4e9f-8a6b-18e4dcf1727c','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('1923be7e-b1f0-497f-b0a8-b2f89e89a609','fd91d787-8e14-486d-b7d9-027fcbb01fef','3b263c41-1588-430b-9061-eeddab5b3157','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('3e95627a-0246-48e3-9267-d109cda7639f','fd91d787-8e14-486d-b7d9-027fcbb01fef','c4899576-efa9-4487-a165-2abcc82c33d6','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('d21f0bd3-e5da-444c-a1ed-8d5c93f60160','fd91d787-8e14-486d-b7d9-027fcbb01fef','84b2c305-fd3b-43b4-aa81-80dd5f9fb717','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('704a66e4-00bf-4983-897c-c1440197e48b','fd91d787-8e14-486d-b7d9-027fcbb01fef','89a4c23d-aa6a-4069-a591-015ea516fa78','member') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.squad_members (id,squad_id,user_id,role) VALUES ('b295a800-25d3-412f-bae6-a54929ed1de8','fd91d787-8e14-486d-b7d9-027fcbb01fef','e5e75575-2ad8-486a-8004-8b067fb23db9','lead') ON CONFLICT (id) DO NOTHING;

SET session_replication_role = DEFAULT; -- restore FK enforcement


-- ============================================================
-- STUDENT APP: MLP FEATURE TABLES (from 202604250001_mlp_student_feature_tables)
-- student_notes, student_checkins, field_tasks, lms_courses, lms_assignments
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.student_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Untitled note',
  body text NOT NULL DEFAULT '',
  context_type text NOT NULL DEFAULT 'general'
    CHECK (context_type IN ('school', 'field', 'general')),
  context_ref_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.student_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  location text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.field_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_at timestamptz,
  supervisor_update text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.lms_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL,
  name text NOT NULL,
  progress_percent integer NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  deep_link text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.lms_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  title text NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'submitted')),
  course_name text,
  deep_link text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_student_notes_student_updated ON public.student_notes (student_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_checkins_student_checked ON public.student_checkins (student_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_tasks_student_due ON public.field_tasks (student_id, due_at);
CREATE INDEX IF NOT EXISTS idx_field_tasks_status ON public.field_tasks (status);
CREATE INDEX IF NOT EXISTS idx_lms_courses_cohort_name ON public.lms_courses (cohort_id, name);
CREATE INDEX IF NOT EXISTS idx_lms_assignments_student_due ON public.lms_assignments (student_id, due_at);
CREATE INDEX IF NOT EXISTS idx_lms_assignments_status ON public.lms_assignments (status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_tasks_external_id ON public.field_tasks (external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_courses_external_id ON public.lms_courses (cohort_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lms_assignments_external_id ON public.lms_assignments (student_id, external_id) WHERE external_id IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sis_students')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='student_notes_student_id_fkey') THEN
    ALTER TABLE public.student_notes ADD CONSTRAINT student_notes_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.sis_students(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sis_students')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='student_checkins_student_id_fkey') THEN
    ALTER TABLE public.student_checkins ADD CONSTRAINT student_checkins_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.sis_students(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sis_students')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='field_tasks_student_id_fkey') THEN
    ALTER TABLE public.field_tasks ADD CONSTRAINT field_tasks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.sis_students(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cohorts')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lms_courses_cohort_id_fkey') THEN
    ALTER TABLE public.lms_courses ADD CONSTRAINT lms_courses_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.cohorts(id) ON DELETE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='sis_students')
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lms_assignments_student_id_fkey') THEN
    ALTER TABLE public.lms_assignments ADD CONSTRAINT lms_assignments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.sis_students(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_student_notes_set_updated_at') THEN
    CREATE TRIGGER trg_student_notes_set_updated_at BEFORE UPDATE ON public.student_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_field_tasks_set_updated_at') THEN
    CREATE TRIGGER trg_field_tasks_set_updated_at BEFORE UPDATE ON public.field_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_lms_courses_set_updated_at') THEN
    CREATE TRIGGER trg_lms_courses_set_updated_at BEFORE UPDATE ON public.lms_courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_lms_assignments_set_updated_at') THEN
    CREATE TRIGGER trg_lms_assignments_set_updated_at BEFORE UPDATE ON public.lms_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.student_notes; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.student_checkins; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.field_tasks; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lms_courses; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.lms_assignments; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;


-- ============================================================
-- STUDENT APP: WALMART SKILLBRIDGE FOUNDATION (from 202605270001_walmart_skillbridge_foundation)
-- app_user_roles, walmart_cohorts, walmart_candidate_events, walmart_student_readiness,
-- walmart_schedule_imports, walmart_schedule_import_rows, walmart_nccer_document_requirements,
-- walmart_curriculum_modules, walmart_quiz_answers, walmart_quiz_retake_overrides,
-- walmart_student_test_scores, walmart_partner_updates
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'uhp_staff', 'walmart_recruiter', 'walmart_academy', 'walmart_pmo', 'admin')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_roles_email_role_unique ON public.app_user_roles (lower(email), role);

CREATE TABLE IF NOT EXISTS public.walmart_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.partner_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date,
  end_date date,
  rotation_label text,
  target_role text NOT NULL DEFAULT 'Developmental Technician',
  target_seats integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'recruiting', 'ready', 'active', 'complete', 'paused')),
  legal_status text NOT NULL DEFAULT 'unknown'
    CHECK (legal_status IN ('unknown', 'pending', 'approved', 'blocked')),
  curriculum_status text NOT NULL DEFAULT 'unknown'
    CHECK (curriculum_status IN ('unknown', 'draft', 'ready', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS walmart_cohorts_program_name_unique ON public.walmart_cohorts (program_id, name);

-- Update walmart_candidates to add cohort FK now that walmart_cohorts exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_candidates_cohort_id_fkey') THEN
    ALTER TABLE public.walmart_candidates ADD CONSTRAINT walmart_candidates_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.walmart_cohorts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.walmart_candidate_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.walmart_candidates(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_value text,
  to_value text,
  note text,
  actor_email text,
  source_system text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.walmart_student_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  cohort_id uuid NOT NULL REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE,
  onboarding_percent integer NOT NULL DEFAULT 0 CHECK (onboarding_percent >= 0 AND onboarding_percent <= 100),
  documents_status text NOT NULL DEFAULT 'missing' CHECK (documents_status IN ('missing', 'pending_review', 'approved', 'blocked')),
  schedule_status text NOT NULL DEFAULT 'not_published' CHECK (schedule_status IN ('not_published', 'published', 'changed', 'blocked')),
  assessment_status text NOT NULL DEFAULT 'not_started' CHECK (assessment_status IN ('not_started', 'in_progress', 'passed', 'failed', 'blocked')),
  ojt_status text NOT NULL DEFAULT 'not_started' CHECK (ojt_status IN ('not_started', 'in_progress', 'ready', 'blocked')),
  travel_status text NOT NULL DEFAULT 'unknown' CHECK (travel_status IN ('unknown', 'pending', 'confirmed', 'blocked')),
  overall_status text NOT NULL DEFAULT 'not_ready' CHECK (overall_status IN ('not_ready', 'at_risk', 'ready', 'complete')),
  blocker text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS walmart_student_readiness_student_cohort_unique ON public.walmart_student_readiness (student_id, cohort_id);

CREATE TABLE IF NOT EXISTS public.walmart_schedule_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('excel', 'csv', 'google_sheet', 'google_api')),
  source_name text,
  source_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'published', 'failed')),
  row_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  imported_by text,
  imported_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.walmart_schedule_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.walmart_schedule_imports(id) ON DELETE CASCADE,
  external_row_id text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapped_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_shift_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Update walmart_schedule_sessions to add source_import_id column + FK now that walmart_schedule_imports exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='walmart_schedule_sessions' AND column_name='source_import_id') THEN
    ALTER TABLE public.walmart_schedule_sessions ADD COLUMN source_import_id uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_schedule_sessions_source_import_id_fkey') THEN
    ALTER TABLE public.walmart_schedule_sessions ADD CONSTRAINT walmart_schedule_sessions_source_import_id_fkey FOREIGN KEY (source_import_id) REFERENCES public.walmart_schedule_imports(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.walmart_nccer_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  title text NOT NULL,
  description text,
  required boolean NOT NULL DEFAULT true,
  student_upload_allowed boolean NOT NULL DEFAULT true,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS walmart_nccer_requirements_type_unique ON public.walmart_nccer_document_requirements (cohort_id, document_type);

-- Update walmart_nccer_documents to add cohort_id column + FK now that walmart_cohorts exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='walmart_nccer_documents' AND column_name='cohort_id') THEN
    ALTER TABLE public.walmart_nccer_documents ADD COLUMN cohort_id uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_nccer_documents_cohort_id_fkey') THEN
    ALTER TABLE public.walmart_nccer_documents ADD CONSTRAINT walmart_nccer_documents_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.walmart_curriculum_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'trades',
  sequence integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  hours_estimate numeric,
  assessment_type text,
  pass_threshold numeric,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Update walmart_quiz_imports and walmart_quizzes: add missing columns + FKs now that walmart_curriculum_modules exists
DO $$ BEGIN
  -- walmart_quiz_imports: add cohort_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='walmart_quiz_imports' AND column_name='cohort_id') THEN
    ALTER TABLE public.walmart_quiz_imports ADD COLUMN cohort_id uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_quiz_imports_cohort_id_fkey') THEN
    ALTER TABLE public.walmart_quiz_imports ADD CONSTRAINT walmart_quiz_imports_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE;
  END IF;
  -- walmart_quiz_imports: add module_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='walmart_quiz_imports' AND column_name='module_id') THEN
    ALTER TABLE public.walmart_quiz_imports ADD COLUMN module_id uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_quiz_imports_module_id_fkey') THEN
    ALTER TABLE public.walmart_quiz_imports ADD CONSTRAINT walmart_quiz_imports_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.walmart_curriculum_modules(id) ON DELETE SET NULL;
  END IF;
  -- walmart_quizzes: add cohort_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='walmart_quizzes' AND column_name='cohort_id') THEN
    ALTER TABLE public.walmart_quizzes ADD COLUMN cohort_id uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_quizzes_cohort_id_fkey') THEN
    ALTER TABLE public.walmart_quizzes ADD CONSTRAINT walmart_quizzes_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE;
  END IF;
  -- walmart_quizzes: add module_id if missing
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='walmart_quizzes' AND column_name='module_id') THEN
    ALTER TABLE public.walmart_quizzes ADD COLUMN module_id uuid NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='walmart_quizzes_module_id_fkey') THEN
    ALTER TABLE public.walmart_quizzes ADD CONSTRAINT walmart_quizzes_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.walmart_curriculum_modules(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.walmart_quiz_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.walmart_quiz_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.walmart_quiz_questions(id) ON DELETE CASCADE,
  answer jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_correct boolean,
  points_awarded numeric,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.walmart_quiz_retake_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id uuid NOT NULL REFERENCES public.walmart_quizzes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  granted_attempts integer NOT NULL DEFAULT 1,
  reason text NOT NULL,
  granted_by text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.walmart_student_test_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  quiz_id uuid NOT NULL REFERENCES public.walmart_quizzes(id) ON DELETE CASCADE,
  module_id uuid NULL REFERENCES public.walmart_curriculum_modules(id) ON DELETE SET NULL,
  trades_competency text,
  latest_attempt_id uuid NULL REFERENCES public.walmart_quiz_attempts(id) ON DELETE SET NULL,
  latest_score numeric,
  best_score numeric,
  pass_threshold numeric NOT NULL DEFAULT 70,
  pass_fail text CHECK (pass_fail IN ('pass', 'fail')),
  attempts_used integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 2,
  retakes_remaining integer NOT NULL DEFAULT 0,
  next_retake_available_at timestamptz,
  retake_status text NOT NULL DEFAULT 'not_assigned'
    CHECK (retake_status IN ('available', 'locked_waiting_period', 'locked_max_attempts', 'locked_staff_review', 'not_assigned', 'passed')),
  counts_toward_readiness boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS walmart_student_test_scores_student_quiz_unique ON public.walmart_student_test_scores (student_id, quiz_id);

CREATE TABLE IF NOT EXISTS public.walmart_partner_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id uuid NOT NULL REFERENCES public.walmart_cohorts(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'blocked', 'done')),
  owner_email text,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Seed: Walmart SkillBridge pilot program + cohort + NCCER document requirements
DO $$
DECLARE
  walmart_program_id uuid;
  pilot_cohort_id uuid;
BEGIN
  INSERT INTO public.partner_programs (slug, name, partner_name, go_live_date, status)
  VALUES ('walmart-skillbridge', 'Walmart SkillBridge', 'Walmart', '2026-06-30', 'planning')
  ON CONFLICT (slug) DO UPDATE SET go_live_date = EXCLUDED.go_live_date, updated_at = timezone('utc', now())
  RETURNING id INTO walmart_program_id;

  SELECT id INTO walmart_program_id FROM public.partner_programs WHERE slug = 'walmart-skillbridge';

  INSERT INTO public.walmart_cohorts (program_id, name, start_date, end_date, rotation_label, target_role, target_seats, status)
  VALUES (walmart_program_id, 'Walmart SkillBridge Pilot', '2026-06-30', '2026-08-04', 'Pilot Rotation', 'Developmental Technician', 20, 'planning')
  ON CONFLICT (program_id, name) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, target_seats = EXCLUDED.target_seats, updated_at = timezone('utc', now())
  RETURNING id INTO pilot_cohort_id;

  SELECT id INTO pilot_cohort_id FROM public.walmart_cohorts WHERE program_id = walmart_program_id AND name = 'Walmart SkillBridge Pilot';

  INSERT INTO public.walmart_nccer_document_requirements (cohort_id, document_type, title, description, required)
  VALUES
    (pilot_cohort_id, 'nccer_registration', 'NCCER Registration / ID', 'NCCER learner registration or ID record.', true),
    (pilot_cohort_id, 'testing_authorization', 'Testing Authorization', 'Authorization to sit for required Trades testing.', true),
    (pilot_cohort_id, 'exam_result', 'Exam Result', 'NCCER or related exam result documentation.', true),
    (pilot_cohort_id, 'performance_profile', 'Performance Profile', 'Hands-on performance profile or equivalent testing artifact.', true)
  ON CONFLICT (cohort_id, document_type) DO NOTHING;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'app_user_roles', 'walmart_cohorts', 'walmart_student_readiness',
    'walmart_schedule_imports', 'walmart_schedule_sessions', 'walmart_nccer_document_requirements',
    'walmart_nccer_documents', 'walmart_curriculum_modules', 'walmart_quiz_imports',
    'walmart_quizzes', 'walmart_quiz_attempts', 'walmart_student_test_scores', 'walmart_partner_updates'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || tbl || '_set_updated_at') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp()', 'trg_' || tbl || '_set_updated_at', tbl);
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Migration 20260531091938_squashed applied at %', now();
END $$;


-- ============================================================
-- SOURCE: 035_programs_lookup.sql
-- ============================================================
-- 035_programs_lookup.sql
-- Move program taxonomy from code constants to a lookup table.
-- Adding a new program now means inserting a row, not editing TypeScript.
--
-- Reversibility:
--   DROP TABLE programs;
--   ALTER TABLE sis_enrollments
--     ADD CONSTRAINT sis_enrollments_program_check
--     CHECK (program IN ('CPT','IHC','CNC','Trades','Patriot','Leadership','Corporate'));
--   UPDATE onboarding_templates SET program = 'Patriot Pathway' WHERE program = 'Patriot';

CREATE TABLE IF NOT EXISTS programs (
  code           TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  hubspot_value  TEXT UNIQUE,
  team_slug      TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_hubspot_value ON programs(hubspot_value);
CREATE INDEX IF NOT EXISTS idx_programs_team_slug ON programs(team_slug);

-- Seed with the current taxonomy (derived from sis_enrollments CHECK + lib/sis.ts PROGRAM_TEAM).
-- hubspot_value comes from HubSpot's "which_program_are_you_most_interested_in_new" enum.
-- NULL hubspot_value means the program exists in UHP but isn't a HubSpot deal option.
INSERT INTO programs (code, display_name, hubspot_value, team_slug) VALUES
  ('CPT',        'Certified Personal Trainer',   'Certified Personal Training (CPT)',  'health'),
  ('IHC',        'Integrative Health Coach',     'Integrative Health Course (IHC)',    'health'),
  ('CNC',        'Culinary Nutrition Coach',     'Culinary Nutrition Coach (CNC)',     'culinary'),
  ('Patriot',    'Patriot Pathway',              NULL,                                 'health'),
  ('Trades',     'Trades',                       NULL,                                 'trades'),
  ('Leadership', 'Leadership',                   NULL,                                 'ops'),
  ('Corporate',  'Corporate',                    NULL,                                 'ops')
ON CONFLICT (code) DO NOTHING;

-- Drop the hardcoded CHECK constraint on sis_enrollments.program.
-- The programs table is now the source of truth; application code validates against it.
-- Without this drop, "adding a program by inserting a row" is a half-truth — new
-- programs would still be rejected at enrollment time by Postgres.
ALTER TABLE sis_enrollments DROP CONSTRAINT IF EXISTS sis_enrollments_program_check;

-- Fix existing drift: onboarding_templates seeded 'Patriot Pathway' but sis_enrollments
-- stores 'Patriot'. That mismatch silently blocks the pre-arrival checklist for Patriot
-- students (the template lookup never matches). Align on the canonical code.
UPDATE onboarding_templates SET program = 'Patriot' WHERE program = 'Patriot Pathway';


-- ============================================================
-- SOURCE: 036_trades_dashboard.sql
-- ============================================================
-- ============================================================
-- Trades dashboard: instructor ownership + student interactions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.trades_instructor_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES public.sis_students(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.sis_enrollments(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  trade_track text CHECK (trade_track IN ('HVAC','Electrical','Plumbing','Carpentry','Welding','General')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','transferred')),
  assigned_by uuid REFERENCES public.user_profiles(id),
  assigned_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  notes text,
  UNIQUE(enrollment_id, instructor_id)
);

CREATE TABLE IF NOT EXISTS public.trades_student_interactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id uuid NOT NULL REFERENCES public.sis_students(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL REFERENCES public.sis_enrollments(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  interaction_type text NOT NULL DEFAULT 'note' CHECK (interaction_type IN (
    'note','coaching','lab','safety','attendance','milestone','follow_up','concern'
  )),
  summary text NOT NULL,
  notes text,
  follow_up_required boolean DEFAULT false,
  follow_up_date date,
  visible_to_student boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_assignments_student ON public.trades_instructor_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_trades_assignments_enrollment ON public.trades_instructor_assignments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_trades_assignments_instructor ON public.trades_instructor_assignments(instructor_id);
CREATE INDEX IF NOT EXISTS idx_trades_interactions_student ON public.trades_student_interactions(student_id);
CREATE INDEX IF NOT EXISTS idx_trades_interactions_enrollment ON public.trades_student_interactions(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_trades_interactions_instructor ON public.trades_student_interactions(instructor_id);
CREATE INDEX IF NOT EXISTS idx_trades_interactions_follow_up ON public.trades_student_interactions(follow_up_required, follow_up_date);

ALTER TABLE public.trades_instructor_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades_student_interactions DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- SOURCE: 037_program_import_center.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent - Flexible Program Uploads + Import Center
-- ============================================================

CREATE TABLE IF NOT EXISTS program_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type TEXT NOT NULL CHECK (import_type IN ('roster', 'schedule', 'plan')),
  team_slug TEXT,
  program TEXT,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  cohort_name TEXT,
  source_name TEXT,
  source_format TEXT,
  status TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'committed', 'failed')),
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_program_import_batches_created_at ON program_import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_program_import_batches_team_program ON program_import_batches(team_slug, program);
CREATE INDEX IF NOT EXISTS idx_program_import_batches_cohort_id ON program_import_batches(cohort_id);

CREATE TABLE IF NOT EXISTS program_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES program_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'imported', 'skipped', 'failed')),
  target_table TEXT,
  target_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_import_rows_batch_id ON program_import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_program_import_rows_status ON program_import_rows(status);

CREATE TABLE IF NOT EXISTS program_plan_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_slug TEXT,
  program TEXT,
  cohort_id UUID REFERENCES cohorts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  storage_path TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'student_candidate', 'student_visible')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_plan_documents_created_at ON program_plan_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_program_plan_documents_team_program ON program_plan_documents(team_slug, program);
CREATE INDEX IF NOT EXISTS idx_program_plan_documents_cohort_id ON program_plan_documents(cohort_id);

ALTER TABLE program_import_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE program_import_rows DISABLE ROW LEVEL SECURITY;
ALTER TABLE program_plan_documents DISABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'program-plan-docs',
  'program-plan-docs',
  false,
  104857600,
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/tab-separated-values',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ============================================================
-- SOURCE: 038_morgan_vaultiq_inventory.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent - Morgan to VaultIQ Inventory Bridge
-- ============================================================

CREATE TABLE IF NOT EXISTS public.morgan_inventory_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor text NOT NULL,
  staff_email text,
  staff_name text,
  team_slug text,
  team_name text,
  intent text NOT NULL CHECK (intent IN ('issue', 'receive', 'adjustment', 'check', 'move', 'qr_create', 'reorder')),
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('draft', 'previewed', 'needs_clarification', 'confirmed', 'cancelled', 'failed', 'expired')),
  source text NOT NULL DEFAULT 'morgan',
  source_text text,
  vaultiq_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  preview_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  commit_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_morgan_inventory_actions_user_created ON public.morgan_inventory_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_morgan_inventory_actions_status ON public.morgan_inventory_actions(status);
CREATE INDEX IF NOT EXISTS idx_morgan_inventory_actions_intent ON public.morgan_inventory_actions(intent);

CREATE TABLE IF NOT EXISTS public.morgan_inventory_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid REFERENCES public.morgan_inventory_actions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor text,
  team_slug text,
  file_name text NOT NULL,
  file_size integer,
  mime_type text,
  storage_path text NOT NULL,
  vaultiq_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  parsed_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsed', 'previewed', 'confirmed', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_morgan_inventory_documents_user_created ON public.morgan_inventory_documents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_morgan_inventory_documents_action_id ON public.morgan_inventory_documents(action_id);

ALTER TABLE public.morgan_inventory_actions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.morgan_inventory_documents DISABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'morgan-inventory-docs',
  'morgan-inventory-docs',
  false,
  104857600,
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/tab-separated-values',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ============================================================
-- SOURCE: 039_drop_uhp_attendance.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent - Drop uhp_attendance Table
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.uhp_attendance) > 0 THEN
    RAISE EXCEPTION 'uhp_attendance still has rows — run data migration first';
  END IF;
END $$;

DROP TABLE IF EXISTS public.uhp_attendance;

COMMIT;

-- ============================================================
-- SOURCE: 045_workspace_projects.sql
-- ============================================================
-- ============================================================
-- UHP Ops Agent — Workspace > Projects backing table
-- Phase 2 follow-up. Pairs with /workspace Projects tab.
--
-- Single-team-friendly v1: an owner user + optional owner team. Status
-- is a small enum. Counts (issues/tasks/notes) are derived elsewhere
-- and not stored here. Archive is a soft-delete via archived_at.
--
-- RLS disabled to match staff_tasks / morgan_action_requests precedent
-- (app-admin tables, service-role API enforces access in code).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.workspace_projects (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text,
  owner_user_id   uuid REFERENCES public.user_profiles(id),
  owner_team_slug text,
  status          text NOT NULL DEFAULT 'planning'
                    CHECK (status IN ('planning','active','blocked','done','archived')),
  progress        integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  start_date      date,
  target_date     date,
  archived_at     timestamptz,
  created_by      uuid REFERENCES public.user_profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_owner_user
  ON public.workspace_projects(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_owner_team
  ON public.workspace_projects(owner_team_slug);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_status
  ON public.workspace_projects(status);

CREATE INDEX IF NOT EXISTS idx_workspace_projects_target_date
  ON public.workspace_projects(target_date);

ALTER TABLE public.workspace_projects DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Supabase role grants — must run after all tables are created
-- Restores default privileges that Supabase normally seeds.
-- Without these, anon/authenticated get 42501 on every table.
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

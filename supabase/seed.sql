-- ============================================================
-- E2E Test Seed
--
-- Creates a local admin user for Playwright E2E tests.
-- Applied automatically by: supabase db reset --local
--
-- Add to .env.local before running tests:
--   TEST_USER_EMAIL=joaquim@uhp.com
--   TEST_USER_PASSWORD=Test1234!
-- ============================================================

DO $$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000001';
  v_email   text := 'joaquim@uhp.com';
  v_pw      text := 'Test1234!';
BEGIN

  -- 1. Auth user (email confirmed so sign-in works immediately)
  -- All TEXT columns must be '' not NULL — GoTrue v2.189+ scans them as non-nullable strings
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    email_change_token_current,
    phone,
    phone_change,
    phone_change_token,
    reauthentication_token
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_pw, gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    FALSE,
    '', -- confirmation_token
    '', -- recovery_token
    '', -- email_change
    '', -- email_change_token_new
    '', -- email_change_token_current
    '', -- phone
    '', -- phone_change
    '', -- phone_change_token
    ''  -- reauthentication_token
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Auth identity (required for email/password sign-in flow)
  INSERT INTO auth.identities (
    id,
    user_id,
    provider,
    provider_id,
    identity_data,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    'email',
    v_email,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT DO NOTHING;

  -- 3. User profile — is_admin:true so authenticated tests have full access
  INSERT INTO public.user_profiles (id, email, display_name, is_admin)
  VALUES (v_user_id, v_email, 'E2E Test Admin', TRUE)
  ON CONFLICT (id) DO UPDATE
    SET is_admin = TRUE, updated_at = NOW();

  -- 4. UHP role record
  INSERT INTO public.uhp_user_roles (id, role, email, display_name)
  VALUES (v_user_id, 'admin', v_email, 'E2E Test Admin')
  ON CONFLICT (id) DO NOTHING;

END $$;

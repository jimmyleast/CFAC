import { createClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from '@/lib/supabase/config'

// Built-in admins for CFAC, so admin access works without depending on a Railway env
// var being set. ADMIN_EMAILS env (if set) is merged on top. Keep this list tiny.
const DEFAULT_ADMIN_EMAILS = ['jimmyleast@gmail.com', 'melanie@cfacbentonco.com']

function getAdminEmails(): string[] {
  const fromEnv = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set([...DEFAULT_ADMIN_EMAILS, ...fromEnv]))
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase())
}

/** Returns the service-role Supabase client (server-only). */
export function getAdminClient() {
  const { url } = getSupabasePublicConfig()
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Upserts a user_profiles row.
 * Called after successful auth so the profile always exists.
 */
export async function upsertUserProfile(
  userId: string,
  email: string,
  displayName?: string
) {
  const adminClient = getAdminClient()
  const admin = isAdminEmail(email)
  await adminClient.from('user_profiles').upsert(
    {
      id: userId,
      email: email.toLowerCase(),
      display_name: displayName || null,
      is_admin: admin,
    },
    { onConflict: 'id', ignoreDuplicates: false }
  )
}

/**
 * Returns whether a given user has platform admin access.
 * Admin = email in the ADMIN_EMAILS/ADMIN_EMAIL env list, OR user_profiles.is_admin.
 */
export async function checkIsAdmin(userId: string, email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true
  const adminClient = getAdminClient()
  const { data: profile } = await adminClient
    .from('user_profiles').select('is_admin').eq('id', userId).single()
  return profile?.is_admin === true
}

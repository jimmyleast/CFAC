import { createClient as createSupabaseClient, type User } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/admin'

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

// Bulletproof request auth: cookie session first, bearer token fallback.
export async function getRequestUser(request: Request): Promise<User | null> {
  const serverClient = createServerClient()
  const { data } = await serverClient.auth.getUser()
  if (data.user) return data.user

  const token = extractBearerToken(request)
  if (!token) return null

  const { url, anonKey } = getSupabasePublicConfig()
  const anonClient = createSupabaseClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: anonData } = await anonClient.auth.getUser(token)
  if (anonData.user) return anonData.user

  const adminClient = getAdminClient()
  const { data: adminData } = await adminClient.auth.getUser(token)
  return adminData.user || null
}

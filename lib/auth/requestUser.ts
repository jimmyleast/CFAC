import { createClient as createSupabaseClient, type User } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { getAdminClient } from '@/lib/admin'

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

function jwtClaim(token: string, claim: string): unknown {
  try {
    const part = token.split('.')[1] || ''
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json)?.[claim]
  } catch { return undefined }
}

function hasVerifiedFactor(user: User): boolean {
  const factors = (user as unknown as { factors?: { status?: string }[] }).factors
  return Array.isArray(factors) && factors.some((f) => f?.status === 'verified')
}

// Bulletproof request auth: cookie session first, bearer token fallback.
export async function getRequestUser(request: Request): Promise<User | null> {
  return (await getRequestAuth(request)).user
}

/**
 * Like getRequestUser, but also reports whether MFA step-up is required:
 * mfaRequired=true when the user has a verified 2FA factor but this session is
 * NOT elevated to AAL2. Sensitive routes must reject (403) when mfaRequired.
 */
export async function getRequestAuth(request: Request): Promise<{ user: User | null; mfaRequired: boolean }> {
  // Cookie session first.
  const serverClient = createServerClient()
  const { data: cookieData } = await serverClient.auth.getUser()
  if (cookieData.user) {
    let mfaRequired = false
    try {
      const { data: aal, error } = await serverClient.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error || !aal) {
        mfaRequired = true // fail CLOSED: can't confirm AAL → force step-up
      } else {
        mfaRequired = aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2'
      }
    } catch {
      mfaRequired = true // fail CLOSED on AAL read error
    }
    return { user: cookieData.user, mfaRequired }
  }

  // Bearer token fallback.
  const token = extractBearerToken(request)
  if (!token) return { user: null, mfaRequired: false }

  const { url, anonKey } = getSupabasePublicConfig()
  const anonClient = createSupabaseClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  let user = (await anonClient.auth.getUser(token)).data.user
  if (!user) user = (await getAdminClient().auth.getUser(token)).data.user
  if (!user) return { user: null, mfaRequired: false }

  // Enrolled-but-not-elevated: token's aal claim must be aal2.
  const mfaRequired = hasVerifiedFactor(user) && jwtClaim(token, 'aal') !== 'aal2'
  return { user, mfaRequired }
}

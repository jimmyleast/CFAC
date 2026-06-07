import { NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/auth/requestUser'
import type { User } from '@supabase/supabase-js'

/**
 * Resolve the request user and enforce MFA step-up. Returns either the user, or
 * a Response to return immediately (401 unauthenticated / 403 mfa_required).
 * Use on sensitive (data/admin) routes so 2FA is enforced server-side, not just
 * in the browser.
 */
export async function requireUserMfa(request: Request): Promise<{ user: User } | { response: Response }> {
  const { user, mfaRequired } = await getRequestAuth(request)
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (mfaRequired) return { response: NextResponse.json({ error: 'mfa_required' }, { status: 403 }) }
  return { user }
}

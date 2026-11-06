import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getSupabasePublicConfig } from '@/lib/supabase/config'
import { upsertUserProfile, isAdminEmail } from '@/lib/admin'
import { isLoginAllowed } from '@/lib/auth/allowlist'
import { authEmailRateLimit, clientIp } from '@/lib/auth/ratelimit'
import { emitAppEvent } from '@/lib/telemetry/events'

const MIN_PASSWORD_LENGTH = 10

function trackFailed(status: string) {
  void emitAppEvent({ eventName: 'auth.register.failed', category: 'auth', route: '/api/auth/register', status })
}

// Self-service sign-up with no email verification. The allowlist (CFAC domain
// + admin emails) is the only gate, so it is enforced before any Supabase call.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const email = String(body?.email || '').trim().toLowerCase()
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, { status: 400 })
    }

    if (!isLoginAllowed(email)) {
      trackFailed('not_allowed')
      return NextResponse.json({ error: 'This email isn’t permitted to sign up. Use your CFAC email or ask an admin.' }, { status: 403 })
    }

    // Admin addresses are never self-registerable (no email proof + admin flag would
    // be a takeover); an existing admin or Supabase dashboard provisions those.
    if (isAdminEmail(email)) {
      trackFailed('admin_email_blocked')
      return NextResponse.json({ error: 'This account must be created by an administrator.' }, { status: 403 })
    }

    if (!authEmailRateLimit(clientIp(request)).ok) {
      trackFailed('rate_limited')
      return NextResponse.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      trackFailed('auth_not_configured')
      return NextResponse.json({ error: 'Server auth is not configured.' }, { status: 500 })
    }

    const { url } = getSupabasePublicConfig()
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    let userId = created.data?.user?.id

    if (created.error) {
      if (!/already|exists|registered/i.test(`${(created.error as { code?: string }).code || ''} ${created.error.message}`)) {
        trackFailed('create_user_error')
        console.error('Register createUser failed:', created.error.message)
        return NextResponse.json({ error: 'Could not create the account. Please try again.' }, { status: 500 })
      }

      // Existing account: only adopt one that was never confirmed (stuck from the old
      // Sign Up tab). A confirmed account is never overwritten.
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existing = list.data?.users?.find((u) => u.email?.toLowerCase() === email)
      if (!existing || existing.email_confirmed_at) {
        trackFailed('already_registered')
        return NextResponse.json({ error: 'An account already exists for this email. Use Sign In, or “Forgot password?”.' }, { status: 409 })
      }

      // Re-fetch right before updating so an account confirmed in the meantime is never overwritten.
      const fresh = await admin.auth.admin.getUserById(existing.id)
      if (fresh.error || !fresh.data?.user || fresh.data.user.email_confirmed_at) {
        trackFailed('already_registered')
        return NextResponse.json({ error: 'An account already exists for this email. Use Sign In, or “Forgot password?”.' }, { status: 409 })
      }

      const updated = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
      if (updated.error) {
        trackFailed('adopt_user_error')
        console.error('Register updateUser failed:', updated.error.message)
        return NextResponse.json({ error: 'Could not create the account. Please try again.' }, { status: 500 })
      }
      userId = existing.id
    }

    if (userId) await upsertUserProfile(userId, email)

    void emitAppEvent({ eventName: 'auth.register.created', category: 'auth', userId, route: '/api/auth/register' })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Register error:', error instanceof Error ? error.message : String(error))
    trackFailed('unexpected_error')
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 })
  }
}

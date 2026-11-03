import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/config', () => ({ getSupabasePublicConfig: () => ({ url: 'https://x.supabase.co', anonKey: 'anon' }) }))
vi.mock('@/lib/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin')>()),
  getAdminClient: vi.fn(),
  upsertUserProfile: vi.fn(async () => {}),
}))

import { POST as loginPost } from '@/app/api/auth/login/route'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { createClient as createServerClient } from '@/lib/supabase/server'

const mServer = createServerClient as unknown as ReturnType<typeof vi.fn>

function serverClientWith(user: { id: string; email: string } | null, extra: Record<string, unknown> = {}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
      mfa: { getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { nextLevel: 'aal1', currentLevel: 'aal1' }, error: null })) },
      signOut: vi.fn(async () => ({ error: null })),
      ...extra,
    },
  }
}

const saved = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ALLOWED_EMAIL_DOMAINS
  delete process.env.ADMIN_EMAILS
})
afterEach(() => { process.env = { ...saved } })

describe('password login route — server-side allowlist', () => {
  function login(email: string, password = 'pw') {
    return loginPost(new Request('https://app/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }))
  }

  it('valid credentials for an off-domain account do NOT grant a session (generic 401, signed out)', async () => {
    const client = serverClientWith(null, {
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'u-x', email: 'stranger@gmail.com' } }, error: null })),
    })
    mServer.mockReturnValue(client)
    const res = await login('stranger@gmail.com')
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid email or password.')
    expect(client.auth.signOut).toHaveBeenCalled()
  })

  it('an org-domain account signs in normally', async () => {
    const client = serverClientWith(null, {
      signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'u-m', email: 'melanie@cfacbentonco.com' } }, error: null })),
    })
    mServer.mockReturnValue(client)
    const res = await login('melanie@cfacbentonco.com')
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })
})

describe('getRequestAuth — session-level allowlist (covers sessions created by ANY path)', () => {
  const req = () => new Request('https://app/api/anything')

  it('treats a cookie session for an off-domain, non-admin email as unauthenticated', async () => {
    mServer.mockReturnValue(serverClientWith({ id: 'u-x', email: 'stranger@gmail.com' }))
    const { user } = await getRequestAuth(req())
    expect(user).toBeNull()
  })

  it('keeps an org-domain cookie session authenticated', async () => {
    mServer.mockReturnValue(serverClientWith({ id: 'u-m', email: 'melanie@cfacbentonco.com' }))
    const { user } = await getRequestAuth(req())
    expect(user?.id).toBe('u-m')
  })

  it('keeps the off-domain admin (owner) session authenticated', async () => {
    mServer.mockReturnValue(serverClientWith({ id: 'u-o', email: 'jimmyleast@gmail.com' }))
    const { user } = await getRequestAuth(req())
    expect(user?.id).toBe('u-o')
  })
})

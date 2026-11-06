import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/config', () => ({ getSupabasePublicConfig: () => ({ url: 'https://x.supabase.co', anonKey: 'anon' }) }))
vi.mock('@/lib/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin')>()),
  upsertUserProfile: vi.fn(async () => {}),
}))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST } from '@/app/api/auth/register/route'
import { createClient } from '@supabase/supabase-js'
import { upsertUserProfile } from '@/lib/admin'
import { resetAuthEmailRateLimit } from '@/lib/auth/ratelimit'

const mCreateClient = createClient as unknown as ReturnType<typeof vi.fn>
const mUpsert = upsertUserProfile as unknown as ReturnType<typeof vi.fn>

function post(email: unknown, password: unknown = 'a-long-password') {
  return POST(new Request('https://app/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
}

const saved = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  resetAuthEmailRateLimit()
  delete process.env.ALLOWED_EMAIL_DOMAINS
  delete process.env.ADMIN_EMAILS
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
})
afterEach(() => { process.env = { ...saved } })

describe('register route — allowlist is the only gate', () => {
  it('refuses a non-allowlisted email with 403 and never touches Supabase admin', async () => {
    const res = await post('stranger@gmail.com')
    expect(res.status).toBe(403)
    expect(mCreateClient).not.toHaveBeenCalled()
  })

  it('rejects malformed email and short passwords with 400', async () => {
    expect((await post('not-an-email')).status).toBe(400)
    expect((await post('stuck.user@cfacbentonco.com', 'short')).status).toBe(400)
    expect(mCreateClient).not.toHaveBeenCalled()
  })

  it('refuses admin addresses (on or off domain) without touching Supabase', async () => {
    expect((await post('melanie@cfacbentonco.com')).status).toBe(403)
    expect((await post('jimmyleast@gmail.com')).status).toBe(403)
    expect(mCreateClient).not.toHaveBeenCalled()
  })

  it('rejects a multi-@ address that tries to smuggle an allowed domain', async () => {
    expect((await post('a@cfacbentonco.com@evil.com')).status).toBe(403)
    expect(mCreateClient).not.toHaveBeenCalled()
  })

  it('rate-limits repeated requests from one IP with 429', async () => {
    mCreateClient.mockReturnValue({ auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } }, error: null }) } } })
    let res: Response | undefined
    for (let i = 0; i < 6; i += 1) res = await post('stuck.user@cfacbentonco.com')
    expect(res!.status).toBe(429)
  })
})

describe('register route — allowed staff email', () => {
  it('creates a confirmed user with the lowercased email and upserts the profile', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u-new' } }, error: null })
    mCreateClient.mockReturnValue({ auth: { admin: { createUser } } })

    const res = await post('  New.Staffer@CFACBentonCo.com ')
    expect(res.status).toBe(200)
    expect(createUser).toHaveBeenCalledWith({ email: 'new.staffer@cfacbentonco.com', password: 'a-long-password', email_confirm: true })
    expect(mUpsert).toHaveBeenCalledWith('u-new', 'new.staffer@cfacbentonco.com')
  })

  it('adopts a stuck unconfirmed account by setting password and confirming it', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } })
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [{ id: 'u-old', email: 'stuck.user@cfacbentonco.com', email_confirmed_at: null }] } })
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: 'u-old', email_confirmed_at: null } }, error: null })
    mCreateClient.mockReturnValue({ auth: { admin: { createUser, listUsers, updateUserById, getUserById } } })

    const res = await post('stuck.user@cfacbentonco.com')
    expect(res.status).toBe(200)
    expect(updateUserById).toHaveBeenCalledWith('u-old', { password: 'a-long-password', email_confirm: true })
    expect(mUpsert).toHaveBeenCalledWith('u-old', 'stuck.user@cfacbentonco.com')
  })

  it('aborts adoption if the account got confirmed between lookup and update (409)', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } })
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [{ id: 'u-old', email: 'stuck.user@cfacbentonco.com', email_confirmed_at: null }] } })
    const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: 'u-old', email_confirmed_at: '2026-01-01' } }, error: null })
    const updateUserById = vi.fn()
    mCreateClient.mockReturnValue({ auth: { admin: { createUser, listUsers, updateUserById, getUserById } } })

    const res = await post('stuck.user@cfacbentonco.com')
    expect(res.status).toBe(409)
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it('never overwrites a CONFIRMED existing account (409)', async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already registered' } })
    const listUsers = vi.fn().mockResolvedValue({ data: { users: [{ id: 'u-old', email: 'stuck.user@cfacbentonco.com', email_confirmed_at: '2026-01-01' }] } })
    const updateUserById = vi.fn()
    mCreateClient.mockReturnValue({ auth: { admin: { createUser, listUsers, updateUserById } } })

    const res = await post('stuck.user@cfacbentonco.com')
    expect(res.status).toBe(409)
    expect(updateUserById).not.toHaveBeenCalled()
  })
})

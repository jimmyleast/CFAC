import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/config', () => ({ getSupabasePublicConfig: () => ({ url: 'https://x.supabase.co', anonKey: 'anon' }) }))
vi.mock('@/lib/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin')>()),
  upsertUserProfile: vi.fn(async () => {}),
}))
vi.mock('@/lib/url', () => ({ resolveAppBaseUrl: () => 'https://app' }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST } from '@/app/api/auth/magic-link/route'
import { sendEmail } from '@/lib/email'
import { createClient } from '@supabase/supabase-js'
import { upsertUserProfile } from '@/lib/admin'
import { resetAuthEmailRateLimit } from '@/lib/auth/ratelimit'

const mSend = sendEmail as unknown as ReturnType<typeof vi.fn>
const mCreateClient = createClient as unknown as ReturnType<typeof vi.fn>
const mUpsert = upsertUserProfile as unknown as ReturnType<typeof vi.fn>

function post(email: unknown) {
  return POST(new Request('https://app/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }))
}

const saved = { ...process.env }
beforeEach(() => {
  vi.clearAllMocks()
  resetAuthEmailRateLimit()
  delete process.env.ALLOWED_EMAIL_DOMAINS
  delete process.env.ADMIN_EMAILS
  delete process.env.ENABLE_EMAIL_SENDING
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  process.env.RESEND_API_KEY = 'rk'
  process.env.RESEND_FROM_EMAIL = 'noreply@cfacbentonco.com'
})
afterEach(() => { process.env = { ...saved } })

describe('magic-link route — allowlist denial (the only public account-creation path)', () => {
  it('refuses a non-allowlisted email with 403 and never touches Supabase admin', async () => {
    const res = await post('stranger@gmail.com')
    expect(res.status).toBe(403)
    expect(mCreateClient).not.toHaveBeenCalled() // no admin client → no generateLink/createUser
    expect(mSend).not.toHaveBeenCalled()
  })

  it('rejects a malformed email with 400', async () => {
    const res = await post('not-an-email')
    expect(res.status).toBe(400)
    expect(mCreateClient).not.toHaveBeenCalled()
  })

  it('returns 503 when email sending is force-disabled', async () => {
    process.env.ENABLE_EMAIL_SENDING = 'false'
    const res = await post('melanie@cfacbentonco.com')
    expect(res.status).toBe(503)
    expect(mCreateClient).not.toHaveBeenCalled()
  })

  it('rate-limits repeated requests from one IP with 429 before any email work', async () => {
    process.env.ENABLE_EMAIL_SENDING = 'false' // allowed email, stops at 503 after the limiter
    let res: Response | undefined
    for (let i = 0; i < 6; i += 1) res = await post('melanie@cfacbentonco.com')
    expect(res!.status).toBe(429)
    expect(mCreateClient).not.toHaveBeenCalled()
    expect(mSend).not.toHaveBeenCalled()
  })
})

describe('magic-link route — allowed staff email', () => {
  it('auto-provisions a NEW user confirmed, upserts the profile, and emails the lowercased address', async () => {
    const generateLink = vi.fn()
      // First attempt: user does not exist yet.
      .mockResolvedValueOnce({ data: null, error: { message: 'User not found' } })
      // Retry after creation succeeds.
      .mockResolvedValueOnce({ data: { properties: { action_link: 'https://x.supabase.co/verify?token=t' }, user: { id: 'u-new' } }, error: null })
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u-new' } }, error: null })
    mCreateClient.mockReturnValue({ auth: { admin: { generateLink, createUser } } })
    mSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })

    const res = await post('  New.Staffer@CFACBentonCo.com ')
    expect(res.status).toBe(200)
    expect(createUser).toHaveBeenCalledWith({ email: 'new.staffer@cfacbentonco.com', email_confirm: true })
    expect(mUpsert).toHaveBeenCalledWith('u-new', 'new.staffer@cfacbentonco.com')
    expect(mSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'new.staffer@cfacbentonco.com' }))
  })

  it('sends the link for an EXISTING user without creating anything', async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { action_link: 'https://x.supabase.co/verify?token=t' }, user: { id: 'u-old' } },
      error: null,
    })
    const createUser = vi.fn()
    mCreateClient.mockReturnValue({ auth: { admin: { generateLink, createUser } } })
    mSend.mockResolvedValue({ data: { id: 'email-2' }, error: null })

    const res = await post('melanie@cfacbentonco.com')
    expect(res.status).toBe(200)
    expect(createUser).not.toHaveBeenCalled()
    expect(mSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'melanie@cfacbentonco.com' }))
  })

  it('surfaces a send failure as 500 (never a false success)', async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { action_link: 'https://x.supabase.co/verify?token=t' } },
      error: null,
    })
    mCreateClient.mockReturnValue({ auth: { admin: { generateLink, createUser: vi.fn() } } })
    mSend.mockResolvedValue({ error: { message: 'provider down' } })

    const res = await post('melanie@cfacbentonco.com')
    expect(res.status).toBe(500)
  })
})

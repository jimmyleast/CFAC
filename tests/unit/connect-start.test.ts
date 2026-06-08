import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/url', () => ({ resolveAppBaseUrl: () => 'https://app' }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { GET } from '@/app/api/connect/[provider]/start/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mReq = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

function start(provider: string) {
  return GET(new Request(`https://app/api/connect/${provider}/start`), { params: { provider } })
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CONNECTOR_ENC_KEY
  delete process.env.PHI_GATE_READY
  process.env.MS_CLIENT_ID = 'cid'; process.env.MS_CLIENT_SECRET = 'sec'
  mReq.mockResolvedValue({ user: { id: 'admin-A', email: 'a@cfac.org' } })
})

describe('OAuth start — PHI key guard', () => {
  it('BLOCKS a phiGated provider (gate open, no env key) with 503 and never starts the handshake', async () => {
    process.env.PHI_GATE_READY = 'true' // gate open, but only the DB key would be available
    const res = await start('microsoft_mail_intake')
    expect(res.status).toBe(503)
    expect(mAdmin).not.toHaveBeenCalled() // no oauth_states row written — no consent redirect
  })

  it('PROCEEDS to the provider consent redirect once the strong env key is in force', async () => {
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    mAdmin.mockReturnValue({
      from: () => ({
        delete: () => ({ lt: () => ({ then: (ok: () => void) => ok() }) }), // opportunistic GC
        insert: async () => ({ error: null }),
      }),
    })
    const res = await start('microsoft_mail_intake')
    expect(res.status).toBe(307) // redirect to the IdP consent page
    expect(res.headers.get('location') || '').toContain('login.microsoftonline.com')
  })
})

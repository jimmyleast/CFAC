import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST } from '@/app/api/connect-invites/[token]/route'
import { getAdminClient } from '@/lib/admin'

const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

function adminMock({ invite, claim, upsertError }: { invite: unknown; claim?: unknown; upsertError?: unknown }) {
  const eqResult = {
    is: () => ({ select: () => ({ maybeSingle: async () => ({ data: claim }) }) }),
    then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }), // release path
  }
  return {
    from: (table: string) => {
      if (table === 'connect_invites') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: invite }) }) }),
          update: () => ({ eq: () => eqResult }),
        }
      }
      return { upsert: async () => ({ error: upsertError || null }) } // connections
    },
  }
}

let ipSeq = 0
function req(body: unknown) {
  ipSeq += 1
  return new Request('https://app/api/connect-invites/tok', { method: 'POST', headers: { 'x-forwarded-for': `10.0.0.${ipSeq}` }, body: JSON.stringify(body) })
}
const future = () => new Date(Date.now() + 86_400_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
})

describe('POST /api/connect-invites/[token] — public credential accept', () => {
  it('404 when the token is unknown', async () => {
    mAdmin.mockReturnValue(adminMock({ invite: null }))
    expect((await POST(req({ apiKey: 'k' }), { params: { token: 'tok' } })).status).toBe(404)
  })

  it('410 when the invite was already used', async () => {
    mAdmin.mockReturnValue(adminMock({ invite: { provider: 'bloomerang', expires_at: future(), used_at: future() } }))
    expect((await POST(req({ apiKey: 'k' }), { params: { token: 'tok' } })).status).toBe(410)
  })

  it('400 when no key is supplied', async () => {
    mAdmin.mockReturnValue(adminMock({ invite: { provider: 'bloomerang', expires_at: future(), used_at: null } }))
    expect((await POST(req({ apiKey: '' }), { params: { token: 'tok' } })).status).toBe(400)
  })

  it('410 when the atomic claim loses the race (no row claimed)', async () => {
    mAdmin.mockReturnValue(adminMock({ invite: { provider: 'bloomerang', expires_at: future(), used_at: null }, claim: null }))
    const res = await POST(req({ apiKey: 'k' }), { params: { token: 'tok' } })
    expect(res.status).toBe(410)
  })

  it('200 on success: claims the invite + stores the connection', async () => {
    mAdmin.mockReturnValue(adminMock({ invite: { provider: 'bloomerang', expires_at: future(), used_at: null }, claim: { token: 'tok' } }))
    const res = await POST(req({ apiKey: 'real-key', name: 'Jane' }), { params: { token: 'tok' } })
    expect(res.status).toBe(200)
    expect((await res.json()).provider).toBe('Bloomerang')
  })

  it('500 + releases the claim when the connection store fails', async () => {
    mAdmin.mockReturnValue(adminMock({ invite: { provider: 'bloomerang', expires_at: future(), used_at: null }, claim: { token: 'tok' }, upsertError: { message: 'db down' } }))
    expect((await POST(req({ apiKey: 'k' }), { params: { token: 'tok' } })).status).toBe(500)
  })

  it('503 when the encryption key cannot be provisioned (storage unavailable)', async () => {
    delete process.env.CONNECTOR_ENC_KEY // force the DB-backed key path
    mAdmin.mockReturnValue({ from: () => { throw new Error('db down') } }) // ensureEncryptionKey() → false
    expect((await POST(req({ apiKey: 'k' }), { params: { token: 'tok' } })).status).toBe(503)
  })
})

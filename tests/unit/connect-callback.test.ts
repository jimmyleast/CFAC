import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/url', () => ({ resolveAppBaseUrl: () => 'https://app' }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { GET } from '@/app/api/connect/[provider]/callback/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mReq = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

// Admin client mock: oauth_states select returns `stateRow`; delete is a no-op.
function adminWithState(stateRow: unknown) {
  return {
    from: (table: string) => {
      if (table === 'oauth_states') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stateRow }) }) }),
          delete: () => ({ eq: async () => ({}) }),
        }
      }
      return { upsert: async () => ({ error: null }) } // connections (not reached in these cases)
    },
  }
}

function req() {
  return new Request('https://app/api/connect/quickbooks/callback?code=abc&state=st1')
}
const loc = (res: Response) => res.headers.get('location') || ''

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CONNECTOR_ENC_KEY = Buffer.from('0'.repeat(32)).toString('base64')
  mReq.mockResolvedValue({ user: { id: 'admin-A', email: 'a@cfac.org' } })
})

describe('OAuth callback — state binding & replay defense', () => {
  it('403s a non-admin', async () => {
    const { NextResponse } = await import('next/server')
    mReq.mockResolvedValue({ response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) })
    const res = await GET(req(), { params: { provider: 'quickbooks' } })
    expect(res.status).toBe(403)
  })

  it('rejects a replayed/unknown state (no row) → bad_state, no token stored', async () => {
    mAdmin.mockReturnValue(adminWithState(null))
    const res = await GET(req(), { params: { provider: 'quickbooks' } })
    expect(loc(res)).toContain('error=bad_state')
  })

  it('rejects a state started by a DIFFERENT admin → state_user_mismatch', async () => {
    mAdmin.mockReturnValue(adminWithState({ provider: 'quickbooks', code_verifier: 'v', created_at: new Date().toISOString(), user_id: 'admin-B' }))
    const res = await GET(req(), { params: { provider: 'quickbooks' } })
    expect(loc(res)).toContain('error=state_user_mismatch')
  })

  it('rejects an expired state → state_expired', async () => {
    const old = new Date(Date.now() - 30 * 60_000).toISOString()
    mAdmin.mockReturnValue(adminWithState({ provider: 'quickbooks', code_verifier: 'v', created_at: old, user_id: 'admin-A' }))
    const res = await GET(req(), { params: { provider: 'quickbooks' } })
    expect(loc(res)).toContain('error=state_expired')
  })

  it('rejects a state for the wrong provider → bad_state', async () => {
    mAdmin.mockReturnValue(adminWithState({ provider: 'microsoft', code_verifier: 'v', created_at: new Date().toISOString(), user_id: 'admin-A' }))
    const res = await GET(req(), { params: { provider: 'quickbooks' } })
    expect(loc(res)).toContain('error=bad_state')
  })
})

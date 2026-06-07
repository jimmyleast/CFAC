import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/auth/aal', () => ({ requireUserMfa: vi.fn(), requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST } from '@/app/api/connections/route'
import { requireAdmin } from '@/lib/auth/aal'

const mGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const req = (body: unknown) => new Request('http://t/api/connections', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mGate.mockResolvedValue({ user: { id: 'admin1', email: 'a@cfac.org' } })
  process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
  delete process.env.PHI_GATE_READY
})

describe('POST /api/connections — PHI gate on API-key connect', () => {
  it('403s a PHI-gated provider (Qualtrics) while the PHI gate is closed', async () => {
    const res = await POST(req({ provider: 'qualtrics', apiKey: 'k' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/PHI/)
  })

  it('still rejects an OAuth provider via the api-key path (400)', async () => {
    expect((await POST(req({ provider: 'quickbooks', apiKey: 'k' }))).status).toBe(400)
  })
})

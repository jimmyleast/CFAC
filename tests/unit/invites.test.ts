import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inviteStatus } from '@/lib/connectors/invites'

const NOW = new Date('2026-06-07T00:00:00Z').getTime()

describe('inviteStatus', () => {
  it('ok for an unused, unexpired invite', () => {
    expect(inviteStatus({ provider: 'bloomerang', expires_at: new Date(NOW + 86_400_000).toISOString(), used_at: null }, NOW)).toBe('ok')
  })
  it('used when already consumed', () => {
    expect(inviteStatus({ provider: 'bloomerang', expires_at: new Date(NOW + 86_400_000).toISOString(), used_at: new Date(NOW).toISOString() }, NOW)).toBe('used')
  })
  it('expired when past expiry', () => {
    expect(inviteStatus({ provider: 'bloomerang', expires_at: new Date(NOW - 1000).toISOString(), used_at: null }, NOW)).toBe('expired')
  })
  it('not_found for missing / bad-date', () => {
    expect(inviteStatus(null, NOW)).toBe('not_found')
    expect(inviteStatus({ provider: 'x', expires_at: 'nope', used_at: null }, NOW)).toBe('expired')
  })
})

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn(), requireUserMfa: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/url', () => ({ resolveAppBaseUrl: () => 'https://app' }))

import { POST } from '@/app/api/connect-invites/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

const adminMock = () => ({
  from: () => ({
    delete: () => ({ eq: () => ({ is: async () => ({}) }) }),
    insert: async () => ({ error: null }),
  }),
})
const req = (body: unknown) => new Request('https://app/api/connect-invites', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mGate.mockResolvedValue({ user: { id: 'admin1', email: 'a@cfac.org' } })
  mAdmin.mockReturnValue(adminMock())
})

describe('POST /api/connect-invites — eligibility', () => {
  it('403 non-admin', async () => {
    const { NextResponse } = await import('next/server')
    mGate.mockResolvedValue({ response: NextResponse.json({ error: 'no' }, { status: 403 }) })
    expect((await POST(req({ provider: 'bloomerang' }))).status).toBe(403)
  })
  it('400 unknown provider', async () => {
    expect((await POST(req({ provider: 'nope' }))).status).toBe(400)
  })
  it('400 for an OAuth provider (invites are api-key only)', async () => {
    expect((await POST(req({ provider: 'quickbooks' }))).status).toBe(400)
  })
  it('400 for a PHI-bearing provider', async () => {
    expect((await POST(req({ provider: 'microsoft' }))).status).toBe(400)
  })
  it('creates an invite link for an api-key, non-PHI provider', async () => {
    const res = await POST(req({ provider: 'bloomerang', label: 'Dir of Development' }))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d.link).toMatch(/^https:\/\/app\/connect\//)
  })
})

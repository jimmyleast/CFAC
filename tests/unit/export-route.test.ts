import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireUserMfa: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { GET } from '@/app/api/export/metrics/route'
import { requireUserMfa } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mAuth = requireUserMfa as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('GET /api/export/metrics — auth gate', () => {
  it('does not reach the DB when MFA gate rejects', async () => {
    const { NextResponse } = await import('next/server')
    mAuth.mockResolvedValue({ response: NextResponse.json({ error: 'mfa_required' }, { status: 403 }) })
    const res = await GET(new Request('http://t/api/export/metrics'))
    expect(res.status).toBe(403)
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('streams CSV with a download header on success', async () => {
    mAuth.mockResolvedValue({ user: { id: 'u1' } })
    mAdmin.mockReturnValue({
      from: () => ({ select: () => ({ not: () => ({ order: () => ({ order: () => ({ limit: async () => ({
        data: [{ metric_key: 'reach', label: 'Reach', value: 21082, unit: 'count', period_label: '2025', period_start: '2025-01-01', data_sources: { name: 'Impact Sheet' } }],
        error: null,
      }) }) }) }) }) }),
    })
    const res = await GET(new Request('http://t/api/export/metrics'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/)
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename=/)
    const body = await res.text()
    expect(body).toContain('Source,Metric Key,Label,Period,Value,Unit')
    expect(body).toContain('Impact Sheet,reach,Reach,2025,21082,count')
  })
})

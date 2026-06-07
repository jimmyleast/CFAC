import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/requestUser', () => ({ getRequestAuth: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn(), checkIsAdmin: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST } from '@/app/api/mappings/route'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { emitAppEvent } from '@/lib/telemetry/events'

const mAuth = getRequestAuth as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>
const mIsAdmin = checkIsAdmin as unknown as ReturnType<typeof vi.fn>
const mEmit = emitAppEvent as unknown as ReturnType<typeof vi.fn>

// Branching admin mock: definition/metrics existence checks + mappings upsert.
function adminMock({ defRow, keyRow, upsertError }: { defRow: unknown; keyRow: unknown; upsertError?: unknown }) {
  return {
    from: (table: string) => {
      if (table === 'metric_definitions') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: defRow }) }) }) }
      if (table === 'metrics') return { select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: keyRow }) }) }) }) }
      return { upsert: async () => ({ error: upsertError || null }) } // metric_mappings
    },
  }
}

function req(body: unknown) {
  return new Request('http://t/api/mappings', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockResolvedValue({ user: { id: 'u1', email: 'a@cfac.org' }, mfaRequired: false })
  mIsAdmin.mockResolvedValue(true)
})

describe('POST /api/mappings — guards the lineage', () => {
  it('401 when unauthenticated', async () => {
    mAuth.mockResolvedValue({ user: null, mfaRequired: false })
    expect((await POST(req({ definition_key: 'reach', source_metric_key: 'reach' }))).status).toBe(401)
  })

  it('403 when MFA step-up required', async () => {
    mAuth.mockResolvedValue({ user: { id: 'u1', email: 'a@cfac.org' }, mfaRequired: true })
    expect((await POST(req({ definition_key: 'reach', source_metric_key: 'reach' }))).status).toBe(403)
  })

  it('403 when not an admin', async () => {
    mIsAdmin.mockResolvedValue(false)
    expect((await POST(req({ definition_key: 'reach', source_metric_key: 'reach' }))).status).toBe(403)
  })

  it('400 on unknown definition_key (no dangling lineage)', async () => {
    mAdmin.mockReturnValue(adminMock({ defRow: null, keyRow: { metric_key: 'reach' } }))
    const res = await POST(req({ definition_key: 'ghost', source_metric_key: 'reach' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/definition_key/)
  })

  it('400 on unknown source_metric_key', async () => {
    mAdmin.mockReturnValue(adminMock({ defRow: { key: 'reach' }, keyRow: null }))
    const res = await POST(req({ definition_key: 'reach', source_metric_key: 'ghost' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/source_metric_key/)
  })

  it('400 on invalid agg', async () => {
    const res = await POST(req({ definition_key: 'reach', source_metric_key: 'reach', agg: 'median' }))
    expect(res.status).toBe(400)
  })

  it('200 + audit event when both keys exist', async () => {
    mAdmin.mockReturnValue(adminMock({ defRow: { key: 'reach' }, keyRow: { metric_key: 'reach' } }))
    const res = await POST(req({ definition_key: 'reach', source_metric_key: 'reach' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mEmit).toHaveBeenCalledTimes(1)
  })
})

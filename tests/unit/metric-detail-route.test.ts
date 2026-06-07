import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireUserMfa: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))

import { GET } from '@/app/api/metrics/[key]/route'
import { requireUserMfa } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mAuth = requireUserMfa as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

function adminMock({ rows, sources, maps, def }: { rows: unknown[]; sources?: unknown[]; maps?: unknown[]; def?: unknown }) {
  return {
    from: (table: string) => {
      if (table === 'metrics') return { select: () => ({ eq: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }) }) }
      if (table === 'data_sources') return { select: async () => ({ data: sources || [] }) }
      if (table === 'metric_mappings') return { select: () => ({ eq: () => ({ eq: async () => ({ data: maps || [] }) }) }) }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: def || null }) }) }) } // metric_definitions
    },
  }
}
const req = () => new Request('http://t/api/metrics/reach')

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockResolvedValue({ user: { id: 'u1' } })
})

describe('GET /api/metrics/[key]', () => {
  it('401s when unauthenticated', async () => {
    const { NextResponse } = await import('next/server')
    mAuth.mockResolvedValue({ response: NextResponse.json({ error: 'no' }, { status: 401 }) })
    expect((await GET(req(), { params: { key: 'reach' } })).status).toBe(401)
  })

  it('404s when the key has no series', async () => {
    mAdmin.mockReturnValue(adminMock({ rows: [] }))
    expect((await GET(req(), { params: { key: 'reach' } })).status).toBe(404)
  })

  it('returns series, latest, sources, and lineage', async () => {
    mAdmin.mockReturnValue(adminMock({
      rows: [
        { metric_key: 'reach', label: 'Reach', value: 100, period_label: '2024', period_start: '2024-01-01', source_id: 's1', dimension: {} },
        { metric_key: 'reach', label: 'Reach', value: 150, period_label: '2025', period_start: '2025-01-01', source_id: 's1', dimension: {} },
      ],
      sources: [{ id: 's1', name: 'Impact Sheet' }],
      maps: [{ definition_key: 'reach' }],
      def: { key: 'reach', display_name: 'Reach', definition: 'Total community impact.' },
    }))
    const d = await (await GET(req(), { params: { key: 'reach' } })).json()
    expect(d.found).toBe(true)
    expect(d.value).toBe(150)
    expect(d.deltaPct).toBe(50)
    expect(d.series).toHaveLength(2)
    expect(d.sources).toContain('Impact Sheet')
    expect(d.feedsInto).toContain('reach')
    expect(d.definition.display_name).toBe('Reach')
  })
})

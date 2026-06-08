import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildOperationsSummary } from '@/lib/operations/summary'

describe('buildOperationsSummary', () => {
  it('summarizes only the latest period and rolls up aggregate buckets', () => {
    const summary = buildOperationsSummary([
      { metric_key: 'maintenance_requests_total', value: 99, period_label: '2026-01', period_start: '2026-01-01', dimension: {} },
      { metric_key: 'maintenance_requests_total', value: 2, period_label: '2026-02', period_start: '2026-02-01', dimension: {} },
      { metric_key: 'maintenance_requests_by_type', value: 1, period_label: '2026-02', period_start: '2026-02-01', dimension: { request_type: 'Plumbing' } },
      { metric_key: 'maintenance_requests_by_type', value: 3, period_label: '2026-02', period_start: '2026-02-01', dimension: { request_type: 'HVAC' } },
      { metric_key: 'fleet_trips_by_purpose', value: 4, period_label: '2026-02', period_start: '2026-02-01', dimension: { purpose: 'Residential Client' } },
    ])
    expect(summary.period).toBe('2026-02')
    expect(summary.totals.maintenance_requests_total).toBe(2)
    expect(summary.maintenance.byType).toEqual([{ label: 'HVAC', value: 3 }, { label: 'Plumbing', value: 1 }])
    expect(summary.fleet.byPurpose).toEqual([{ label: 'Residential Client', value: 4 }])
  })

  it('does not expose non-aggregate dimension fields as special outputs', () => {
    const summary = buildOperationsSummary([
      { metric_key: 'fleet_trips_by_vehicle_type', value: 1, period_label: '2026-02', period_start: '2026-02-01', dimension: { driver: 'Jane', vehicle_type: 'Van', location: 'Court' } },
    ])
    expect(JSON.stringify(summary)).toContain('Van')
    expect(JSON.stringify(summary)).not.toContain('Jane')
    expect(JSON.stringify(summary)).not.toContain('Court')
  })
})

vi.mock('@/lib/auth/aal', () => ({ requireUserMfa: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))

import { GET } from '@/app/api/operations/summary/route'
import { requireUserMfa } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mAuth = requireUserMfa as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockResolvedValue({ user: { id: 'u1' } })
})

describe('GET /api/operations/summary', () => {
  it('queries the aggregate metrics table with the operations key allowlist', async () => {
    const seen: { table?: string; keys?: string[]; select?: string } = {}
    const chain: Record<string, unknown> = {
      select: (s: string) => { seen.select = s; return chain },
      in: (_col: string, keys: string[]) => { seen.keys = keys; return chain },
      not: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
    }
    mAdmin.mockReturnValue({ from: (table: string) => { seen.table = table; return chain } })
    const res = await GET(new Request('http://t/api/operations/summary'))
    expect(res.status).toBe(200)
    expect(seen.table).toBe('metrics')
    expect(seen.select).not.toContain('raw')
    expect(seen.keys).toContain('maintenance_requests_total')
    expect(seen.keys).toContain('fleet_trips_by_purpose')
  })
})

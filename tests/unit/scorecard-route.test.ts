import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireUserMfa: vi.fn(), requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { GET } from '@/app/api/scorecard/route'
import { requireUserMfa } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mMfa = requireUserMfa as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mMfa.mockResolvedValue({ user: { id: 'u1', email: 'a@cfac.org' } })
})

describe('GET /api/scorecard — metrics read truncation guard', () => {
  it('reads metrics windowed + DESC + capped, so the 5000-row cap drops the OLDEST periods', async () => {
    const q: { gte?: { col: string; val: string }; order?: { col: string; opts: { ascending?: boolean } }; limit?: number } = {}
    mAdmin.mockReturnValue({
      from: (table: string) => {
        if (table === 'scorecard_metrics') return {
          // one active measurable linked to metric_key 'k' → triggers the metrics read
          select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: '1', name: 'M', owner: null, goal_value: null, goal_direction: 'at_least', unit: 'count', metric_key: 'k', component_id: null, sort_order: 1, active: true }], error: null }) }) }),
        }
        if (table === 'metrics') {
          const node: Record<string, unknown> = {}
          node.select = () => node
          node.in = () => node
          node.gte = (col: string, val: string) => { q.gte = { col, val }; return node }
          node.order = (col: string, opts: { ascending?: boolean }) => { q.order = { col, opts }; return node }
          node.limit = (n: number) => { q.limit = n; return Promise.resolve({ data: [] }) }
          return node
        }
        return {}
      },
    })

    const res = await GET(new Request('http://t/api/scorecard'))
    expect(res.status).toBe(200)
    // DESC order so truncation drops oldest, not newest:
    expect(q.order).toMatchObject({ col: 'period_start', opts: { ascending: false } })
    expect(q.limit).toBe(5000)
    // bounded to a recent window (a past timestamp on period_start):
    expect(q.gte?.col).toBe('period_start')
    expect(new Date(q.gte!.val).getTime()).toBeLessThan(Date.now())
  })
})

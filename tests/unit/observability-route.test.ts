import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/requestUser', () => ({ getRequestAuth: vi.fn() }))
vi.mock('@/lib/admin', () => ({ checkIsAdmin: vi.fn(), getAdminClient: vi.fn() }))
vi.mock('@/lib/compliance/phi', () => ({ redactPHI: (s: string) => s }))

import { GET } from '@/app/api/admin/observability/route'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'

const mAuth = getRequestAuth as unknown as ReturnType<typeof vi.fn>
const mIsAdmin = checkIsAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

let seq = 0
// `events` are passed in DB order (newest-first), mirroring the route's
// .order('created_at', { ascending: false }) query.
function syncEvent(over: Record<string, unknown>) {
  return {
    id: `e${seq++}`, event_name: 'connection.synced', category: 'system', user_id: null,
    process_id: null, route: '/api/connections/x/sync', status: 'ok', duration_ms: null,
    metadata: {}, created_at: '2026-06-07T12:00:00.000Z', ...over,
  }
}

function mockClient(events: unknown[]) {
  mAdmin.mockReturnValue({
    from: (table: string) => {
      if (table === 'app_events') return {
        select: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: events, error: null }) }) }) }),
      }
      if (table === 'data_sources') return { select: async () => ({ data: [] }) }
      return {}
    },
  })
}

async function call() {
  const res = await GET(new Request('http://t/api/admin/observability?days=7'))
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks(); seq = 0
  mAuth.mockResolvedValue({ user: { id: 'u1', email: 'a@cfac.org' }, mfaRequired: false })
  mIsAdmin.mockResolvedValue(true)
})

describe('GET /api/admin/observability — connector sync health', () => {
  it('403s a non-admin (never reads events)', async () => {
    mIsAdmin.mockResolvedValue(false)
    mockClient([])
    const res = await GET(new Request('http://t/api/admin/observability'))
    expect(res.status).toBe(403)
  })

  it('flags a provider whose MOST RECENT sync errored (newest-first wins)', async () => {
    mockClient([
      syncEvent({ status: 'error', category: 'error', metadata: { provider: 'quickbooks', error: 'token expired' } }),
      syncEvent({ status: 'ok', metadata: { provider: 'quickbooks' } }),
    ])
    const d = await call()
    expect(d.connectors.failingProviders).toEqual(['quickbooks'])
    expect(d.connectors.failures).toBe(1)
    expect(d.connectors.alerts.some((a: string) => a.includes('quickbooks') && /failing/i.test(a))).toBe(true)
  })

  it('does NOT flag a provider that failed earlier but whose latest sync recovered', async () => {
    mockClient([
      syncEvent({ status: 'ok', metadata: { provider: 'quickbooks' } }),          // newest
      syncEvent({ status: 'error', category: 'error', metadata: { provider: 'quickbooks' } }),
    ])
    const d = await call()
    expect(d.connectors.failingProviders).toEqual([])
    expect(d.connectors.failures).toBe(1)   // a failure still happened in-window…
    expect(d.connectors.alerts).toEqual([]) // …but the latest state is healthy, so no alert
  })

  it('surfaces an empty pull (ok_empty) as a distinct data alert, not a failure', async () => {
    mockClient([syncEvent({ status: 'ok_empty', metadata: { provider: 'bloomerang' } })])
    const d = await call()
    expect(d.connectors.emptyPulls).toBe(1)
    expect(d.connectors.failingProviders).toEqual([])
    expect(d.connectors.alerts.some((a: string) => a.includes('bloomerang') && /no data/i.test(a))).toBe(true)
  })

  it('counts both error and partial statuses as failures', async () => {
    mockClient([
      syncEvent({ status: 'error', category: 'error', metadata: { provider: 'qgiv' } }),
      syncEvent({ status: 'partial', category: 'error', metadata: {} }), // legacy batch shape, no provider
    ])
    const d = await call()
    expect(d.connectors.failures).toBe(2)
    expect(d.connectors.failingProviders).toEqual(['qgiv']) // partial w/o provider isn't attributed
  })

  it('ignores a connection.synced event with no/invalid provider without crashing', async () => {
    mockClient([syncEvent({ status: 'error', category: 'error', metadata: { provider: 42 } })])
    const d = await call()
    expect(d.connectors.failingProviders).toEqual([]) // no phantom entry
    expect(d.connectors.syncs).toBe(1)
  })

  it('returns the zeroed connectors shape when there are no events', async () => {
    mockClient([])
    const d = await call()
    expect(d.connectors).toMatchObject({ syncs: 0, failures: 0, emptyPulls: 0, failingProviders: [], alerts: [] })
  })
})

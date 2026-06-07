import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/connectors/sync', () => ({ runSync: vi.fn() }))

import { POST } from '@/app/api/connections/sync-all/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'
import { runSync } from '@/lib/connectors/sync'

const mGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>
const mRun = runSync as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mGate.mockResolvedValue({ user: { id: 'admin1', email: 'a@cfac.org' } })
  // bloomerang + qgiv are connected (both have connectors)
  mAdmin.mockReturnValue({ from: () => ({ select: () => ({ eq: async () => ({ data: [{ provider: 'bloomerang' }, { provider: 'qgiv' }] }) }) }) })
})

describe('POST /api/connections/sync-all', () => {
  it('403s a non-admin', async () => {
    const { NextResponse } = await import('next/server')
    mGate.mockResolvedValue({ response: NextResponse.json({ error: 'no' }, { status: 403 }) })
    expect((await POST(new Request('http://t/api/connections/sync-all', { method: 'POST' }))).status).toBe(403)
  })

  it('aggregates partial results without aborting on one failure', async () => {
    mRun.mockImplementation(async (_a: unknown, provider: string) =>
      provider === 'bloomerang' ? { ok: true, rows: 2 } : { ok: false, error: 'qgiv needs verification' })
    const res = await POST(new Request('http://t/api/connections/sync-all', { method: 'POST' }))
    const d = await res.json()
    expect(d.synced).toBe(1)
    expect(d.total).toBe(2)
    expect(mRun).toHaveBeenCalledTimes(2) // both attempted, no early abort
  })

  it('counts a lock-skip as skipped (not a failure) and emits a per-provider neutral event', async () => {
    const { emitAppEvent } = await import('@/lib/telemetry/events')
    mRun.mockImplementation(async (_a: unknown, provider: string) =>
      provider === 'bloomerang' ? { ok: true, rows: 2 } : { ok: false, skipped: true, error: 'sync already running' })
    const res = await POST(new Request('http://t/api/connections/sync-all', { method: 'POST' }))
    const d = await res.json()
    expect(d.synced).toBe(1)
    expect(d.skipped).toBe(1)
    expect(d.total).toBe(2)
    // Per-provider, attributable events — so the dashboard can name the source.
    const calls = (emitAppEvent as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    const qgiv = calls.find((e) => e.metadata.provider === 'qgiv')
    expect(qgiv).toMatchObject({ category: 'system', status: 'skipped', metadata: { batch: true } })
    // A benign overlap must NOT raise any error-category event.
    expect(calls.some((e) => e.category === 'error')).toBe(false)
  })

  it('emits a per-provider error event naming the failing source (attributable)', async () => {
    const { emitAppEvent } = await import('@/lib/telemetry/events')
    mRun.mockImplementation(async (_a: unknown, provider: string) =>
      provider === 'bloomerang' ? { ok: true, rows: 2 } : { ok: false, error: 'qgiv needs verification' })
    await POST(new Request('http://t/api/connections/sync-all', { method: 'POST' }))
    const calls = (emitAppEvent as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    const qgiv = calls.find((e) => e.metadata.provider === 'qgiv')
    expect(qgiv).toMatchObject({ category: 'error', status: 'error' })
    expect(qgiv.metadata.error).toBe('qgiv needs verification')
  })
})

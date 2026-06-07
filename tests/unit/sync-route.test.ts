import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/connectors/sync', () => ({ runSync: vi.fn() }))
vi.mock('@/lib/connectors/impl', () => ({ CONNECTORS: {} }))

import { POST } from '@/app/api/connections/[provider]/sync/route'
import { requireAdmin } from '@/lib/auth/aal'
import { runSync } from '@/lib/connectors/sync'
import { emitAppEvent } from '@/lib/telemetry/events'

const mGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mRun = runSync as unknown as ReturnType<typeof vi.fn>
const mEmit = emitAppEvent as unknown as ReturnType<typeof vi.fn>

const req = () => new Request('http://t/api/connections/bloomerang/sync', { method: 'POST' })
const lastEvent = () => mEmit.mock.calls[mEmit.mock.calls.length - 1][0]

beforeEach(() => {
  vi.clearAllMocks()
  mGate.mockResolvedValue({ user: { id: 'admin1', email: 'a@cfac.org' } })
})

describe('POST /api/connections/[provider]/sync', () => {
  it('403s a non-admin (and never runs a sync)', async () => {
    const { NextResponse } = await import('next/server')
    mGate.mockResolvedValue({ response: NextResponse.json({ error: 'no' }, { status: 403 }) })
    const res = await POST(req(), { params: { provider: 'bloomerang' } })
    expect(res.status).toBe(403)
    expect(mRun).not.toHaveBeenCalled()
  })

  it('404s an invalid provider param before touching the DB', async () => {
    const res = await POST(req(), { params: { provider: 'Bad Provider!' } })
    expect(res.status).toBe(404)
    expect(mRun).not.toHaveBeenCalled()
  })

  it('200s on a successful sync and logs status ok', async () => {
    mRun.mockResolvedValue({ ok: true, rows: 3 })
    const res = await POST(req(), { params: { provider: 'bloomerang' } })
    expect(res.status).toBe(200)
    expect((await res.json()).rows).toBe(3)
    expect(lastEvent()).toMatchObject({ category: 'system', status: 'ok' })
  })

  it('409s a lock-skip (benign) and logs it as neutral system/skipped, not an error', async () => {
    mRun.mockResolvedValue({ ok: false, skipped: true, error: 'sync already running' })
    const res = await POST(req(), { params: { provider: 'bloomerang' } })
    expect(res.status).toBe(409)
    expect((await res.json()).skipped).toBe(true)
    const evt = lastEvent()
    expect(evt.category).toBe('system') // must NOT desensitize on-call
    expect(evt.status).toBe('skipped')
  })

  it('400s a real failure and logs status error', async () => {
    mRun.mockResolvedValue({ ok: false, error: 'api 500' })
    const res = await POST(req(), { params: { provider: 'bloomerang' } })
    expect(res.status).toBe(400)
    const evt = lastEvent()
    expect(evt.category).toBe('error')
    expect(evt.status).toBe('error')
    expect(evt.metadata.error).toBe('api 500')
  })

  it('logs an empty pull as ok_empty (watchable) while still returning 200', async () => {
    mRun.mockResolvedValue({ ok: true, rows: 0, empty: true })
    const res = await POST(req(), { params: { provider: 'bloomerang' } })
    expect(res.status).toBe(200)
    expect(lastEvent().status).toBe('ok_empty')
  })
})

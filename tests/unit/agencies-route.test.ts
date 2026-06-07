import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireUserMfa: vi.fn(), requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST, PATCH } from '@/app/api/agencies/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

function adminMock({ existing, insertError, onInsert }: { existing: unknown; insertError?: unknown; onInsert?: (r: Record<string, unknown>) => void }) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }),
      insert: async (row: Record<string, unknown>) => { onInsert?.(row); return { error: insertError || null } },
    }),
  }
}
const req = (body: unknown) => new Request('http://t/api/agencies', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mGate.mockResolvedValue({ user: { id: 'a1', email: 'a@cfac.org' } })
})

describe('POST /api/agencies', () => {
  it('403s a non-admin', async () => {
    const { NextResponse } = await import('next/server')
    mGate.mockResolvedValue({ response: NextResponse.json({ error: 'no' }, { status: 403 }) })
    expect((await POST(req({ name: 'X' }))).status).toBe(403)
  })

  it('400s a missing name', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: null }))
    expect((await POST(req({ name: '' }))).status).toBe(400)
  })

  it('409s a duplicate name', async () => {
    mAdmin.mockReturnValue(adminMock({ existing: { id: 'dup' } }))
    expect((await POST(req({ name: 'Sheriff' }))).status).toBe(409)
  })

  it('clamps an unknown type to other and creates', async () => {
    let inserted: Record<string, unknown> = {}
    mAdmin.mockReturnValue(adminMock({ existing: null, onInsert: (r) => { inserted = r } }))
    const res = await POST(req({ name: 'Prosecutor', type: 'bogus' }))
    expect(res.status).toBe(200)
    expect(inserted.type).toBe('other')
    expect(inserted.name).toBe('Prosecutor')
  })
})

function patchAdmin({ updated, captured, error }: { updated: unknown; captured?: (p: Record<string, unknown>) => void; error?: unknown }) {
  return { from: () => ({ update: (p: Record<string, unknown>) => { captured?.(p); return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updated, error: error || null }) }) }) } } }) }
}
const preq = (body: unknown) => new Request('http://t/api/agencies', { method: 'PATCH', body: JSON.stringify(body) })

describe('PATCH /api/agencies', () => {
  it('403s a non-admin', async () => {
    const { NextResponse } = await import('next/server')
    mGate.mockResolvedValue({ response: NextResponse.json({ error: 'no' }, { status: 403 }) })
    expect((await PATCH(preq({ id: 'a1', active: false }))).status).toBe(403)
  })
  it('400s a missing id', async () => {
    expect((await PATCH(preq({ active: false }))).status).toBe(400)
  })
  it('400s an empty patch (no allowlisted fields)', async () => {
    expect((await PATCH(preq({ id: 'x', name: 'hacked' }))).status).toBe(400) // name not writable
  })
  it('400s when name is not allowlisted and type is rejected by the enum', async () => {
    let updateCalled = false
    mAdmin.mockReturnValue(patchAdmin({ updated: null, captured: () => { updateCalled = true } }))
    const res = await PATCH(preq({ id: 'x', name: 'x', type: 'bogus' }))
    expect(res.status).toBe(400) // name dropped, bogus type rejected -> nothing to update
    expect(updateCalled).toBe(false) // allowlist short-circuits before any DB write
  })
  it('404s an unknown id', async () => {
    mAdmin.mockReturnValue(patchAdmin({ updated: null }))
    expect((await PATCH(preq({ id: 'ghost', active: false }))).status).toBe(404)
  })
  it('500s on a db error', async () => {
    mAdmin.mockReturnValue(patchAdmin({ updated: null, error: { message: 'boom' } }))
    expect((await PATCH(preq({ id: 'a1', active: false }))).status).toBe(500)
  })
  it('updates only allowlisted fields (active/type)', async () => {
    let captured: Record<string, unknown> = {}
    mAdmin.mockReturnValue(patchAdmin({ updated: { id: 'a1' }, captured: (p) => { captured = p } }))
    const res = await PATCH(preq({ id: 'a1', active: false, type: 'dhs', name: 'hacked' }))
    expect(res.status).toBe(200)
    expect(captured).toEqual({ active: false, type: 'dhs' }) // name dropped
  })
  it('patches active in isolation (only active reaches the update)', async () => {
    let captured: Record<string, unknown> = {}
    mAdmin.mockReturnValue(patchAdmin({ updated: { id: 'a1' }, captured: (p) => { captured = p } }))
    const res = await PATCH(preq({ id: 'a1', active: false }))
    expect(res.status).toBe(200)
    expect(captured).toEqual({ active: false }) // nothing smuggled in alongside active
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/requestUser', () => ({ getRequestAuth: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { PATCH } from '@/app/api/cases/[id]/route'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { getAdminClient } from '@/lib/admin'

const mAuth = getRequestAuth as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

// Admin mock: cases.select→caseRow; cases.update chain→updRow; case_events.insert ok.
function adminMock({ caseRow, updRow }: { caseRow: unknown; updRow?: unknown }) {
  return {
    from: (table: string) => {
      if (table === 'cases') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: caseRow }) }) }),
        update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updRow ?? null, error: null }) }) }) }) }),
      }
      return { insert: async () => ({ error: null }) } // case_events
    },
  }
}
const req = (body: unknown) => new Request('http://t/api/cases/c1', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockResolvedValue({ user: { id: 'u1', email: 'a@cfac.org' }, mfaRequired: false })
  process.env.PHI_GATE_READY = 'true' // gate open for most tests
})

describe('PATCH /api/cases/[id] — case-status move', () => {
  it('401 unauthenticated', async () => {
    mAuth.mockResolvedValue({ user: null, mfaRequired: false })
    expect((await PATCH(req({ to: 'pending' }), { params: { id: 'c1' } })).status).toBe(401)
  })

  it('403 when the PHI gate is closed (case workflow locked)', async () => {
    delete process.env.PHI_GATE_READY
    expect((await PATCH(req({ to: 'pending' }), { params: { id: 'c1' } })).status).toBe(403)
  })

  it('400 on an invalid target status', async () => {
    expect((await PATCH(req({ to: 'bogus' }), { params: { id: 'c1' } })).status).toBe(400)
  })

  it('404 when the case does not exist', async () => {
    mAdmin.mockReturnValue(adminMock({ caseRow: null }))
    expect((await PATCH(req({ to: 'pending' }), { params: { id: 'c1' } })).status).toBe(404)
  })

  it('409 on a disallowed transition (new → new)', async () => {
    mAdmin.mockReturnValue(adminMock({ caseRow: { id: 'c1', status: 'new', summary: '' } }))
    expect((await PATCH(req({ to: 'new' }), { params: { id: 'c1' } })).status).toBe(409)
  })

  it('409 when the conditional update finds no row (concurrent change)', async () => {
    mAdmin.mockReturnValue(adminMock({ caseRow: { id: 'c1', status: 'new', summary: '' }, updRow: null }))
    expect((await PATCH(req({ to: 'pending' }), { params: { id: 'c1' } })).status).toBe(409)
  })

  it('200 on a valid move', async () => {
    mAdmin.mockReturnValue(adminMock({ caseRow: { id: 'c1', status: 'new', summary: '' }, updRow: { id: 'c1' } }))
    const res = await PATCH(req({ to: 'pending', note: 'CPS opened' }), { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })
})

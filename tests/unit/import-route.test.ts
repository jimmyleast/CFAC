import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/requestUser', () => ({ getRequestAuth: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn(), checkIsAdmin: vi.fn() }))
vi.mock('xlsx', () => ({
  read: () => ({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  }),
  utils: {
    sheet_to_json: () => [
      ['Year', 'Reach', 'Children Served'],
      [2025, 21082, 895],
    ],
  },
}))

import { POST } from '@/app/api/data/import/route'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'

const mAuth = getRequestAuth as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>
const mCheck = checkIsAdmin as unknown as ReturnType<typeof vi.fn>

function request(sourceSlug = 'impact-history') {
  const fd = new FormData()
  fd.append('sourceSlug', sourceSlug)
  fd.append('file', new File(['fake'], 'impact.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  return new Request('http://t/api/data/import', { method: 'POST', body: fd })
}

function adminMock(sourceProfileKey: string | null) {
  const calls: { rpc?: string; inserted?: unknown[] } = {}
  const admin = {
    calls,
    rpc: async (fn: string) => { calls.rpc = fn; return { error: null } },
    from: (table: string) => {
      if (table === 'data_sources') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'src1', source_profile_key: sourceProfileKey }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'metrics') {
        return {
          insert: async (rows: unknown[]) => { calls.inserted = rows; return { error: null } },
        }
      }
      if (table === 'import_rows') return { insert: async () => ({ error: null }) }
      return {}
    },
  }
  return admin
}

beforeEach(() => {
  vi.clearAllMocks()
  mAuth.mockResolvedValue({ user: { id: 'u1', email: 'admin@cfac.test' }, mfaRequired: false })
  mCheck.mockResolvedValue(true)
})

describe('POST /api/data/import', () => {
  it('uses the atomic replace_source_metrics RPC for profiled sources', async () => {
    const admin = adminMock('impact_history')
    mAdmin.mockReturnValue(admin)
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(admin.calls.rpc).toBe('replace_source_metrics')
    expect(admin.calls.inserted).toBeUndefined()
  })

  it('falls back to generic insert when a source has no profile', async () => {
    const admin = adminMock(null)
    mAdmin.mockReturnValue(admin)
    const res = await POST(request('generic-source'))
    expect(res.status).toBe(200)
    expect(admin.calls.rpc).toBeUndefined()
    expect(admin.calls.inserted).toBeDefined()
  })
})

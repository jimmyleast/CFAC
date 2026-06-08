import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/aal', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { POST } from '@/app/api/sharepoint/workbooks/route'
import { requireAdmin } from '@/lib/auth/aal'
import { getAdminClient } from '@/lib/admin'

const mAdminGate = requireAdmin as unknown as ReturnType<typeof vi.fn>
const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

const req = (body: unknown) => new Request('http://t/api/sharepoint/workbooks', { method: 'POST', body: JSON.stringify(body) })

function adminMock(capture: (row: Record<string, unknown>) => void) {
  return {
    from: (table: string) => {
      if (table === 'data_sources') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'src1' }, error: null }) }) }) }
      if (table === 'connected_workbooks') return {
        insert: (row: Record<string, unknown>) => {
          capture(row)
          return { select: () => ({ maybeSingle: async () => ({ data: { id: 'wb1' }, error: null }) }) }
        },
      }
      return {}
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mAdminGate.mockResolvedValue({ user: { id: 'admin1', email: 'admin@cfac.test' } })
})

describe('POST /api/sharepoint/workbooks', () => {
  it('requires a known source profile and either table or worksheet range', async () => {
    expect((await POST(req({ sourceSlug: 'impact-history', profileKey: 'bogus', displayName: 'X', driveId: 'd', itemId: 'i', tableName: 'T' }))).status).toBe(400)
    expect((await POST(req({ sourceSlug: 'impact-history', profileKey: 'impact_history', displayName: 'X', driveId: 'd', itemId: 'i' }))).status).toBe(400)
  })

  it('registers metadata only, not workbook values', async () => {
    let inserted: Record<string, unknown> = {}
    mAdmin.mockReturnValue(adminMock((row) => { inserted = row }))
    const res = await POST(req({
      sourceSlug: 'impact-history',
      profileKey: 'impact_history',
      displayName: 'Impact',
      driveId: 'drive-id',
      itemId: 'item-id',
      worksheetName: 'Sheet1',
      rangeAddress: 'A1:C20',
    }))
    expect(res.status).toBe(200)
    expect(inserted).toMatchObject({
      provider: 'microsoft_sharepoint',
      source_id: 'src1',
      source_profile_key: 'impact_history',
      drive_id: 'drive-id',
      item_id: 'item-id',
      worksheet_name: 'Sheet1',
      range_address: 'A1:C20',
    })
    expect(JSON.stringify(inserted)).not.toContain('21082')
  })
})

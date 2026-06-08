import { describe, it, expect } from 'vitest'
import { syncSharePointProfiledWorkbooks, workbookRangeUrl, type SharePointWorkbookBinding } from '@/lib/connectors/sharepointExcel'

const binding: SharePointWorkbookBinding = {
  id: 'wb1',
  source_id: 'src1',
  source_profile_key: 'impact_history',
  display_name: 'Impact workbook',
  drive_id: 'drive 1',
  item_id: 'item 1',
  worksheet_name: 'Sheet1',
  range_address: 'A1:C2',
  table_name: null,
}

describe('SharePoint Excel connector helpers', () => {
  it('builds Graph workbook range URLs without Mail.Read or raw-row endpoints', () => {
    const url = workbookRangeUrl(binding)
    expect(url).toContain('/workbook/worksheets/Sheet1/range')
    expect(url).toContain("address='A1:C2'")
    expect(url).not.toContain('mail')
  })

  it('prefers table range when table_name is configured', () => {
    expect(workbookRangeUrl({ ...binding, table_name: 'ImpactTable' })).toContain('/workbook/tables/ImpactTable/range')
  })

  it('syncs registered workbook values through source profiles and atomic metric replacement', async () => {
    const calls: { rpc?: string; rows?: unknown[]; imported?: unknown[] } = {}
    const admin = {
      rpc: async (fn: string, args: { p_rows: unknown[] }) => { calls.rpc = fn; calls.rows = args.p_rows; return { error: null } },
      from: (table: string) => {
        if (table === 'connected_workbooks') return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: [binding], error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
        if (table === 'import_rows') return { insert: async (rows: unknown[]) => { calls.imported = rows; return { error: null } } }
        if (table === 'data_sources') return { update: () => ({ eq: async () => ({ error: null }) }) }
        return {}
      },
    } as never
    const result = await syncSharePointProfiledWorkbooks(admin, 'token', 'user1', async () => [
      ['Year', 'Reach', 'Children Served'],
      [2025, 21082, 895],
    ])
    expect(result).toMatchObject({ ok: true, workbooks: 1, rows: 1, metrics: 2 })
    expect(calls.rpc).toBe('replace_source_metrics')
    expect(JSON.stringify(calls.rows)).toContain('clients_served')
    expect(calls.imported).toBeDefined()
  })
})

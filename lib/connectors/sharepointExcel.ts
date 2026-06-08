import type { SupabaseClient } from '@supabase/supabase-js'
import { importWithSourceProfile } from '@/lib/data/profileImport'

export type SharePointWorkbookBinding = {
  id: string
  source_id: string
  source_profile_key: string
  display_name: string
  drive_id: string
  item_id: string
  worksheet_name: string | null
  range_address: string | null
  table_name: string | null
}

export type WorkbookValueFetcher = (binding: SharePointWorkbookBinding, accessToken: string) => Promise<unknown[][]>
export type SharePointSyncResult = {
  ok: boolean
  workbooks: number
  rows: number
  metrics: number
  errors: { id: string; name: string; error: string }[]
}

function graphString(value: string): string {
  return value.replace(/'/g, "''")
}

export function workbookRangeUrl(binding: Pick<SharePointWorkbookBinding, 'drive_id' | 'item_id' | 'worksheet_name' | 'range_address' | 'table_name'>): string {
  const base = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(binding.drive_id)}/items/${encodeURIComponent(binding.item_id)}/workbook`
  if (binding.table_name) return `${base}/tables/${encodeURIComponent(binding.table_name)}/range`
  if (!binding.worksheet_name || !binding.range_address) throw new Error('worksheet_name and range_address are required when table_name is absent')
  return `${base}/worksheets/${encodeURIComponent(binding.worksheet_name)}/range(address='${graphString(binding.range_address)}')`
}

export async function fetchWorkbookValues(binding: SharePointWorkbookBinding, accessToken: string): Promise<unknown[][]> {
  const res = await fetch(workbookRangeUrl(binding), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Graph workbook range ${res.status}`)
  const body = await res.json() as { values?: unknown[][] }
  if (!Array.isArray(body.values)) throw new Error('Graph workbook response did not include values')
  return body.values
}

function splitValues(values: unknown[][]): { header: string[]; dataRows: unknown[][] } {
  const first = values.findIndex((r) => Array.isArray(r) && r.filter((c) => String(c ?? '').trim()).length >= 2)
  if (first < 0) throw new Error('workbook range has no header row')
  const header = values[first].map((c) => String(c ?? '').trim())
  const dataRows = values.slice(first + 1).filter((r) => r.some((c) => String(c ?? '').trim()))
  return { header, dataRows }
}

export async function syncSharePointProfiledWorkbooks(
  admin: SupabaseClient,
  accessToken: string,
  userId: string,
  fetcher: WorkbookValueFetcher = fetchWorkbookValues,
): Promise<SharePointSyncResult> {
  const { data, error } = await admin
    .from('connected_workbooks')
    .select('id, source_id, source_profile_key, display_name, drive_id, item_id, worksheet_name, range_address, table_name')
    .eq('provider', 'microsoft_sharepoint')
    .eq('enabled', true)
  if (error) return { ok: false, workbooks: 0, rows: 0, metrics: 0, errors: [{ id: 'query', name: 'connected_workbooks', error: error.message }] }

  const bindings = (data || []) as SharePointWorkbookBinding[]
  let rows = 0
  let metrics = 0
  const errors: SharePointSyncResult['errors'] = []

  for (const binding of bindings) {
    try {
      const values = await fetcher(binding, accessToken)
      const { header, dataRows } = splitValues(values)
      const batchId = crypto.randomUUID()
      const profiled = importWithSourceProfile({
        profileKey: binding.source_profile_key,
        sourceId: binding.source_id,
        importedBy: userId,
        batchId,
        header,
        dataRows,
      })
      if (!profiled.handled) throw new Error(`no source profile handler for ${binding.source_profile_key}`)
      if (profiled.metrics.length) {
        const { error: swapErr } = await admin.rpc('replace_source_metrics', { p_source_id: binding.source_id, p_rows: profiled.metrics })
        if (swapErr) throw new Error(`metrics swap failed: ${swapErr.message}`)
      }
      if (profiled.importRows.length) await admin.from('import_rows').insert(profiled.importRows)
      await Promise.all([
        admin.from('data_sources').update({ last_imported_at: new Date().toISOString() }).eq('id', binding.source_id),
        admin.from('connected_workbooks').update({ last_sync_at: new Date().toISOString(), last_error: null }).eq('id', binding.id),
      ])
      rows += dataRows.length
      metrics += profiled.metrics.length
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'sync failed'
      errors.push({ id: binding.id, name: binding.display_name, error: msg })
      await admin.from('connected_workbooks').update({ last_error: msg.slice(0, 300) }).eq('id', binding.id).then(() => {}, () => {})
    }
  }

  return { ok: errors.length === 0, workbooks: bindings.length, rows, metrics, errors }
}

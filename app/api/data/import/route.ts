import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { redactPHI } from '@/lib/compliance/phi'
import { importWithSourceProfile, slugifyKey, toNum } from '@/lib/data/profileImport'
import { profileForSourceSlug } from '@/lib/data/sourceProfiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_DATA_ROWS = 50_000
const ALLOWED_EXT = ['.xlsx', '.xls', '.csv']

const PERIOD_NAMES = ['year', 'month', 'date', 'period', 'quarter', 'week']

export async function POST(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  // Importing writes via the service-role client (bypasses RLS) — admin only.
  if (!(await checkIsAdmin(user.id, user.email || ''))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  const file = form.get('file') as File | null
  const sourceSlug = String(form.get('sourceSlug') || '').trim()
  const sheetName = String(form.get('sheet') || '').trim()
  const periodColInput = String(form.get('periodColumn') || '').trim()
  const periodLabelInput = String(form.get('periodLabel') || '').trim()
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (!sourceSlug) return NextResponse.json({ error: 'sourceSlug required' }, { status: 400 })
  // Validate upload: size + extension (defends against memory/CPU DoS).
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` }, { status: 413 })
  }
  const lowerName = (file.name || '').toLowerCase()
  if (!ALLOWED_EXT.some(ext => lowerName.endsWith(ext))) {
    return NextResponse.json({ error: `Unsupported file type. Allowed: ${ALLOWED_EXT.join(', ')}` }, { status: 415 })
  }

  const admin = getAdminClient()
  const { data: src, error: srcErr } = await admin.from('data_sources').select('id, source_profile_key').eq('slug', sourceSlug).maybeSingle()
  if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 })
  if (!src) return NextResponse.json({ error: `Unknown source: ${sourceSlug}` }, { status: 404 })
  const sourceId = src.id

  // parse
  let rows: any[][]
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: 'buffer' })
    const ws = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]]
    rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' }) as any[][]
  } catch (e: any) {
    return NextResponse.json({ error: 'Could not parse file: ' + e.message }, { status: 400 })
  }
  if (!rows.length) return NextResponse.json({ error: 'No rows found' }, { status: 400 })

  // header = first row with >=2 non-empty cells
  let hi = rows.findIndex(r => r.filter(c => String(c).trim()).length >= 2)
  if (hi < 0) hi = 0
  const header = rows[hi].map(c => String(c).trim())
  const dataRows = rows.slice(hi + 1).filter(r => r.some(c => String(c).trim()))
  if (dataRows.length > MAX_DATA_ROWS) {
    return NextResponse.json({ error: `Too many rows (${dataRows.length}); max ${MAX_DATA_ROWS}` }, { status: 413 })
  }

  // period column
  let periodIdx = -1
  if (periodColInput) periodIdx = header.findIndex(h => h.toLowerCase() === periodColInput.toLowerCase())
  if (periodIdx < 0) periodIdx = header.findIndex(h => PERIOD_NAMES.includes(h.toLowerCase()))

  const batchId = crypto.randomUUID()
  const metrics: any[] = []
  const importRows: any[] = []
  const profileKey = src.source_profile_key || profileForSourceSlug(sourceSlug)?.key || null

  const profiled = importWithSourceProfile({
    profileKey,
    sourceId,
    importedBy: user.id,
    batchId,
    header,
    dataRows,
    fallbackPeriodLabel: periodLabelInput || null,
    contextLabel: sheetName || file.name || sourceSlug,
  })
  if (profiled.handled) {
    if (profiled.metrics.length) {
      const { error } = await admin.rpc('replace_source_metrics', { p_source_id: sourceId, p_rows: profiled.metrics })
      if (error) return NextResponse.json({ error: 'metrics swap failed: ' + error.message }, { status: 500 })
    }
    if (profiled.importRows.length) await admin.from('import_rows').insert(profiled.importRows)
    await admin.from('data_sources').update({ last_imported_at: new Date().toISOString() }).eq('id', sourceId)

    return NextResponse.json({
      ok: true, batchId,
      profileKey,
      rowsParsed: dataRows.length, metricsInserted: profiled.metrics.length,
      metricKeys: profiled.metricKeys,
      periodColumn: null,
    })
  }

  dataRows.forEach((r, idx) => {
    const periodLabel = periodIdx >= 0 ? String(r[periodIdx] ?? '').trim() : (periodLabelInput || '')
    const yearMatch = periodLabel.match(/(\d{4})/)
    const periodStart = yearMatch ? `${yearMatch[1]}-01-01` : null
    const rawObj: Record<string, any> = {}
    let added = 0
    header.forEach((h, i) => {
      // Defense-in-depth: strip structured PII (email/SSN/DOB/phone/address) from
      // verbatim cells before they land in import_rows.raw. The platform is
      // aggregate-only; case-level PHI uploads wait for the HIPAA infra (§5).
      rawObj[h || `col${i}`] = typeof r[i] === 'string' ? redactPHI(r[i]) : r[i]
      if (i === periodIdx) return
      const val = toNum(r[i])
      if (val === null) return
      metrics.push({
        source_id: sourceId, metric_key: slugifyKey(h) || `col_${i}`, label: h,
        value: val, unit: 'count', period_label: periodLabel || null, period_start: periodStart,
        dimension: {},
      })
      added++
    })
    importRows.push({
      source_id: sourceId, imported_by: user.id, batch_id: batchId, row_index: idx,
      raw: rawObj, status: added > 0 ? 'ok' : 'missing',
      issues: added > 0 ? [] : ['no numeric metric values in row'],
    })
  })

  if (metrics.length) {
    const { error } = await admin.from('metrics').insert(metrics)
    if (error) return NextResponse.json({ error: 'metrics insert failed: ' + error.message }, { status: 500 })
  }
  if (importRows.length) await admin.from('import_rows').insert(importRows)
  await admin.from('data_sources').update({ last_imported_at: new Date().toISOString() }).eq('id', sourceId)

  return NextResponse.json({
    ok: true, batchId,
    rowsParsed: dataRows.length, metricsInserted: metrics.length,
    metricKeys: Array.from(new Set(metrics.map(m => m.metric_key))),
    periodColumn: periodIdx >= 0 ? header[periodIdx] : null,
  })
}

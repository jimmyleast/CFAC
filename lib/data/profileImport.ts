import { getSourceProfile, type SourceProfile } from '@/lib/data/sourceProfiles'
import { redactPHI } from '@/lib/compliance/phi'

type MetricRow = {
  source_id: string
  metric_key: string
  label: string
  value: number
  unit: string
  period_label: string | null
  period_start: string | null
  dimension: Record<string, string>
}

type ImportAuditRow = {
  source_id: string
  imported_by: string
  batch_id: string
  row_index: number
  raw: Record<string, unknown>
  status: 'ok' | 'missing' | 'mismatch' | 'error'
  issues: string[]
}

export type ProfileImportResult = {
  handled: boolean
  metrics: MetricRow[]
  importRows: ImportAuditRow[]
  metricKeys: string[]
}

type ProfileImportInput = {
  profileKey: string | null | undefined
  sourceId: string
  importedBy: string
  batchId: string
  header: string[]
  dataRows: unknown[][]
}

function slugifyKey(h: string) {
  return h.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[$,%\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function idx(header: string[], aliases: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  return aliases.map((a) => lower.indexOf(a.toLowerCase())).find((i) => i >= 0) ?? -1
}

function cell(row: unknown[], index: number): unknown {
  return index >= 0 ? row[index] : ''
}

function cleanBucket(value: unknown, fallback = 'Unspecified'): string {
  const s = String(value ?? '').trim()
  if (!s) return fallback
  return redactPHI(s).slice(0, 80)
}

function monthFrom(value: unknown): { label: string; start: string } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    return { label: `${y}-${m}`, start: `${y}-${m}-01` }
  }
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear()
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0')
    return { label: `${y}-${m}`, start: `${y}-${m}-01` }
  }
  const y = raw.match(/\b(20\d{2}|19\d{2})\b/)?.[1]
  return y ? { label: y, start: `${y}-01-01` } : null
}

function metric(sourceId: string, metricKey: string, label: string, value: number, period: { label: string; start: string } | null, dimension: Record<string, string> = {}, unit = 'count'): MetricRow {
  return {
    source_id: sourceId,
    metric_key: metricKey,
    label,
    value,
    unit,
    period_label: period?.label ?? null,
    period_start: period?.start ?? null,
    dimension,
  }
}

function aggregateBy(metrics: MetricRow[], sourceId: string, period: { label: string; start: string } | null, key: string, label: string, dimensionName: string, bucket: string, value = 1) {
  const existing = metrics.find((m) =>
    m.metric_key === key &&
    m.period_label === (period?.label ?? null) &&
    m.dimension[dimensionName] === bucket
  )
  if (existing) existing.value += value
  else metrics.push(metric(sourceId, key, label, value, period, { [dimensionName]: bucket }))
}

function audit(sourceId: string, importedBy: string, batchId: string, rowIndex: number, raw: Record<string, unknown>, issues: string[] = []): ImportAuditRow {
  return {
    source_id: sourceId,
    imported_by: importedBy,
    batch_id: batchId,
    row_index: rowIndex,
    raw,
    status: issues.length ? 'missing' : 'ok',
    issues,
  }
}

function importImpact(profile: SourceProfile, input: ProfileImportInput): ProfileImportResult {
  const yearIdx = idx(input.header, ['Year'])
  const fields = profile.fields.filter((f) => f.canonical !== 'year')
  const metrics: MetricRow[] = []
  const importRows: ImportAuditRow[] = []

  input.dataRows.forEach((row, rowIndex) => {
    const year = String(cell(row, yearIdx)).trim()
    const period = /^\d{4}$/.test(year) ? { label: year, start: `${year}-01-01` } : null
    const issues = period ? [] : ['missing year']
    const safeRaw: Record<string, unknown> = { Year: year }

    for (const field of fields) {
      const col = idx(input.header, field.aliases)
      const val = toNum(cell(row, col))
      if (val === null) continue
      const label = field.aliases[0] || field.canonical
      safeRaw[label] = val
      metrics.push(metric(input.sourceId, field.canonical, label, val, period))
    }
    importRows.push(audit(input.sourceId, input.importedBy, input.batchId, rowIndex, safeRaw, issues))
  })

  return { handled: true, metrics, importRows, metricKeys: Array.from(new Set(metrics.map((m) => m.metric_key))) }
}

function importMaintenance(input: ProfileImportInput): ProfileImportResult {
  const dateIdx = idx(input.header, ['Date', 'Start time'])
  const typeIdx = idx(input.header, ['Request Type'])
  const priorityIdx = idx(input.header, ['Priority'])
  const statusIdx = idx(input.header, ['Status'])
  const onTimeIdx = idx(input.header, ['On Time?'])
  const costIdx = idx(input.header, ['Actual Cost'])
  const metrics: MetricRow[] = []
  const importRows: ImportAuditRow[] = []

  input.dataRows.forEach((row, rowIndex) => {
    const period = monthFrom(cell(row, dateIdx))
    const issues = period ? [] : ['missing usable date']
    metrics.push(metric(input.sourceId, 'maintenance_requests_total', 'Maintenance requests', 1, period))
    aggregateBy(metrics, input.sourceId, period, 'maintenance_requests_by_type', 'Maintenance requests by type', 'request_type', cleanBucket(cell(row, typeIdx)))
    aggregateBy(metrics, input.sourceId, period, 'maintenance_requests_by_priority', 'Maintenance requests by priority', 'priority', cleanBucket(cell(row, priorityIdx)))
    aggregateBy(metrics, input.sourceId, period, 'maintenance_requests_by_status', 'Maintenance requests by status', 'status', cleanBucket(cell(row, statusIdx)))
    if (/^yes$/i.test(String(cell(row, onTimeIdx)).trim())) metrics.push(metric(input.sourceId, 'maintenance_on_time_yes', 'Maintenance completed on time', 1, period))
    const cost = toNum(cell(row, costIdx))
    if (cost !== null) metrics.push(metric(input.sourceId, 'maintenance_actual_cost', 'Maintenance actual cost', cost, period, {}, 'usd'))
    importRows.push(audit(input.sourceId, input.importedBy, input.batchId, rowIndex, {
      profile: 'maintenance_request_2026',
      period: period?.label ?? null,
      request_type: cleanBucket(cell(row, typeIdx)),
      priority: cleanBucket(cell(row, priorityIdx)),
      status: cleanBucket(cell(row, statusIdx)),
      stored_raw: 'aggregate_only',
    }, issues))
  })

  return { handled: true, metrics, importRows, metricKeys: Array.from(new Set(metrics.map((m) => m.metric_key))) }
}

function importFleet(input: ProfileImportInput): ProfileImportResult {
  const dateIdx = idx(input.header, ['Date of Vehicle Use', 'Start time'])
  const vehicleIdx = idx(input.header, ['Vehicle Type'])
  const purposeIdx = idx(input.header, ['Purpose of Travel'])
  const milesIdx = idx(input.header, ['Miles Driven'])
  const fuelIdx = idx(input.header, ['1/2 Tank of Fuel?'])
  const issueIdx = idx(input.header, ['List and describe any maintenance issues'])
  const metrics: MetricRow[] = []
  const importRows: ImportAuditRow[] = []

  input.dataRows.forEach((row, rowIndex) => {
    const period = monthFrom(cell(row, dateIdx))
    const issues = period ? [] : ['missing usable vehicle-use date']
    metrics.push(metric(input.sourceId, 'fleet_trips_total', 'Fleet trips', 1, period))
    aggregateBy(metrics, input.sourceId, period, 'fleet_trips_by_vehicle_type', 'Fleet trips by vehicle type', 'vehicle_type', cleanBucket(cell(row, vehicleIdx)))
    aggregateBy(metrics, input.sourceId, period, 'fleet_trips_by_purpose', 'Fleet trips by purpose', 'purpose', cleanBucket(cell(row, purposeIdx)))
    const miles = toNum(cell(row, milesIdx))
    if (miles !== null) metrics.push(metric(input.sourceId, 'fleet_miles_driven', 'Fleet miles driven', miles, period, {}, 'miles'))
    if (/^no$/i.test(String(cell(row, fuelIdx)).trim())) metrics.push(metric(input.sourceId, 'fleet_low_fuel_returns', 'Fleet returns below half tank', 1, period))
    if (String(cell(row, issueIdx)).trim()) metrics.push(metric(input.sourceId, 'fleet_maintenance_issue_reports', 'Fleet maintenance issue reports', 1, period))
    importRows.push(audit(input.sourceId, input.importedBy, input.batchId, rowIndex, {
      profile: 'fleet_management_2026',
      period: period?.label ?? null,
      vehicle_type: cleanBucket(cell(row, vehicleIdx)),
      purpose: cleanBucket(cell(row, purposeIdx)),
      stored_raw: 'aggregate_only',
    }, issues))
  })

  return { handled: true, metrics, importRows, metricKeys: Array.from(new Set(metrics.map((m) => m.metric_key))) }
}

export function importWithSourceProfile(input: ProfileImportInput): ProfileImportResult {
  const profile = getSourceProfile(input.profileKey)
  if (!profile) return { handled: false, metrics: [], importRows: [], metricKeys: [] }
  if (profile.key === 'impact_history') return importImpact(profile, input)
  if (profile.key === 'maintenance_request_2026') return importMaintenance(input)
  if (profile.key === 'fleet_management_2026') return importFleet(input)
  return { handled: false, metrics: [], importRows: [], metricKeys: [] }
}

export { slugifyKey, toNum }

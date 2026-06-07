import { getAdminClient } from '@/lib/admin'

const METRICS_LIMIT = 5000

export type DataCatalog = { text: string; metricKeys: string[]; hasData: boolean; staleDays: number | null }

function dimKey(d: unknown): string {
  if (!d || typeof d !== 'object' || Object.keys(d as object).length === 0) return ''
  try { return JSON.stringify(d) } catch { return '' }
}

/**
 * Builds the grounding context Hope reasons over: CFAC components, data sources,
 * and metrics (aggregate, non-PII). Hope answers ONLY from this; the critique
 * step verifies every figure against it.
 *
 * Series are grouped per (metric_key + source + dimension) so figures from
 * different sources/breakdowns are NEVER merged into one misleading trend.
 */
export async function buildDataCatalog(componentSlug?: string): Promise<DataCatalog> {
  const admin = getAdminClient()

  const { data: components } = await admin.from('components').select('name, slug').order('name')
  const { data: sources } = await admin
    .from('data_sources')
    .select('id, name, slug, kind, last_imported_at, component_id, components(slug, name)')
    .order('name')

  // Restrict to the requested component's sources (filter pushed to the metrics query).
  const scopedSources = (sources || []).filter((s: any) => !componentSlug || s.components?.slug === componentSlug)
  const allowedSourceIds = scopedSources.map((s: any) => s.id)
  const srcById = new Map<string, any>((sources || []).map((s: any) => [s.id, s]))

  let metricsQuery = admin
    .from('metrics')
    .select('metric_key, label, value, period_label, period_start, source_id, dimension')
    .not('period_start', 'is', null)
    .order('period_start', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(METRICS_LIMIT)
  if (componentSlug) {
    if (!allowedSourceIds.length) {
      return { text: catalogText(components, scopedSources, {}), metricKeys: [], hasData: false, staleDays: null }
    }
    metricsQuery = metricsQuery.in('source_id', allowedSourceIds)
  }
  const { data: metrics } = await metricsQuery

  // Group by a composite identity → one clean series each.
  const byKey: Record<string, { metricKey: string; label: string; source: string; dim: string; series: { period: string; value: number }[] }> = {}
  const contributingSourceIds = new Set<string>()
  for (const m of metrics || []) {
    const v = Number(m.value)
    if (!Number.isFinite(v)) continue
    const dim = dimKey(m.dimension)
    const id = `${m.metric_key}|${m.source_id}|${dim}`
    if (!byKey[id]) byKey[id] = { metricKey: m.metric_key, label: m.label || m.metric_key, source: srcById.get(m.source_id)?.name || '—', dim, series: [] }
    byKey[id].series.push({ period: m.period_label || '', value: v })
    contributingSourceIds.add(m.source_id)
  }

  const metricKeys = Array.from(new Set(Object.values(byKey).map((g) => g.metricKey))).sort()
  const staleDays = computeStaleDays(contributingSourceIds, srcById)
  return { text: catalogText(components, scopedSources, byKey), metricKeys, hasData: Object.keys(byKey).length > 0, staleDays }
}

function computeStaleDays(sourceIds: Set<string>, srcById: Map<string, any>): number | null {
  let maxDays: number | null = null
  for (const id of sourceIds) {
    const li = srcById.get(id)?.last_imported_at
    if (!li) return 99999 // a contributing source with no import date = treat as very stale
    const days = Math.floor((Date.now() - new Date(li).getTime()) / 86_400_000)
    maxDays = maxDays === null ? days : Math.max(maxDays, days)
  }
  return maxDays
}

function catalogText(components: any[] | null, sources: any[], byKey: Record<string, any>): string {
  const lines: string[] = []
  lines.push('CFAC COMPONENTS: ' + (components || []).map((c: any) => c.name).join(', '))
  lines.push('')
  lines.push('DATA SOURCES:')
  for (const s of sources) {
    lines.push(`- ${s.name} (${s.kind}; component: ${s.components?.name || '—'}; last imported: ${s.last_imported_at ? new Date(s.last_imported_at).toISOString().slice(0, 10) : 'never'})`)
  }
  lines.push('')
  lines.push('METRICS (only these numbers exist — do not invent others):')
  const groups = Object.values(byKey).sort((a: any, b: any) => a.label.localeCompare(b.label))
  for (const g of groups as any[]) {
    const latest = g.series[g.series.length - 1]
    const prior = g.series.length > 1 ? g.series[g.series.length - 2] : null
    const trend = g.series.map((p: any) => `${p.period}=${p.value}`).join(', ')
    lines.push(`- ${g.label} [${g.metricKey}] (source: ${g.source}${g.dim ? `; breakdown: ${g.dim}` : ''}): latest ${latest?.period}=${latest?.value}` +
      (prior ? `; prior ${prior.period}=${prior.value}` : '') + `; series: ${trend}`)
  }
  if (!groups.length) lines.push('- (no metrics imported yet for this scope)')
  return lines.join('\n')
}

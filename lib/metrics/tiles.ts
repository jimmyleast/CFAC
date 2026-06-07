import type { SupabaseClient } from '@supabase/supabase-js'

// Shared metric-series logic used by Hope view cards and the component dashboards.
// Aggregate, non-PII. Values always come from the metrics table, never a model.

export type MetricPoint = { period: string; value: number }
export type MetricSeries = { key: string; label: string; series: MetricPoint[] }
export type MetricTile = {
  key: string
  label: string
  value: number
  period: string
  priorValue: number | null
  priorPeriod: string | null
  deltaPct: number | null
  series: MetricPoint[]
}

export type MetricRow = {
  metric_key: string
  label?: string | null
  value?: number | string | null
  period_label?: string | null
  period_start?: string | null
  source_id?: string | null
  dimension?: unknown
}

const ROW_LIMIT = 5000

/**
 * Group rows into one clean series per metric_key. Rows are grouped by the
 * composite identity (key|source|dimension) so a metric broken down by
 * agency/source is never merged; for each metric_key we keep only the DOMINANT
 * (most-complete) series rather than concatenating breakdowns. Assumes rows are
 * pre-ordered by period_start ascending.
 */
export function dominantSeriesByKey(rows: MetricRow[]): Record<string, MetricSeries> {
  const groups: Record<string, MetricSeries> = {}
  for (const m of rows) {
    const v = Number(m.value)
    if (!Number.isFinite(v)) continue
    let dim = ''
    try {
      dim = m.dimension && typeof m.dimension === 'object' && Object.keys(m.dimension as object).length ? JSON.stringify(m.dimension) : ''
    } catch {
      dim = ''
    }
    const id = `${m.metric_key}|${m.source_id || ''}|${dim}`
    ;(groups[id] ||= { key: m.metric_key, label: m.label || m.metric_key, series: [] }).series.push({
      period: m.period_label || '',
      value: v,
    })
  }
  const byKey: Record<string, MetricSeries> = {}
  for (const g of Object.values(groups)) {
    const cur = byKey[g.key]
    if (!cur || g.series.length > cur.series.length) byKey[g.key] = g
  }
  return byKey
}

/** Build a KPI tile (latest value + change vs prior period) from a series. */
export function seriesToTile(s: MetricSeries): MetricTile {
  const latest = s.series[s.series.length - 1]
  const prior = s.series.length > 1 ? s.series[s.series.length - 2] : null
  const deltaPct = prior && prior.value ? Math.round(((latest.value - prior.value) / prior.value) * 100) : null
  return {
    key: s.key,
    label: s.label,
    value: latest.value,
    period: latest.period,
    priorValue: prior?.value ?? null,
    priorPeriod: prior?.period ?? null,
    deltaPct,
    series: s.series,
  }
}

/** All metrics → KPI tiles, alphabetised by label. */
export function rowsToTiles(rows: MetricRow[]): MetricTile[] {
  return Object.values(dominantSeriesByKey(rows))
    .filter((s) => s.series.length > 0)
    .map(seriesToTile)
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Resolve KPI tiles for a single component (by slug), scoped to its sources. */
export async function resolveComponentTiles(admin: SupabaseClient, slug: string): Promise<MetricTile[]> {
  const { data: srcs } = await admin.from('data_sources').select('id, components(slug)')
  const sourceIds = (srcs || [])
    .filter((s) => (s as { components?: { slug?: string } }).components?.slug === slug)
    .map((s) => (s as { id: string }).id)
  if (!sourceIds.length) return []

  const { data } = await admin
    .from('metrics')
    .select('metric_key, label, value, period_label, period_start, source_id, dimension')
    .in('source_id', sourceIds)
    .not('period_start', 'is', null)
    .order('period_start', { ascending: true })
    .limit(ROW_LIMIT)

  return rowsToTiles((data || []) as MetricRow[])
}

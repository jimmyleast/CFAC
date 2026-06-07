import type { MetricSeries } from '@/lib/metrics/tiles'

// Computes the three impact metrics (build-spec §4) from editable Metric Mappings,
// never hardcoded (§8). Each impact definition sums the resolved value of its
// active source mappings. Pure + unit-tested; the API supplies DB data.

export type Mapping = {
  definition_key: string
  source_metric_key: string
  agg: 'latest' | 'sum' | 'count' | 'avg' | string
  status: string
}

export type DefinitionLite = {
  key: string
  display_name: string
  definition: string
  category: string
  is_dedup_rule: boolean
}

export type ImpactSource = { key: string; agg: string; value: number | null }
export type ImpactMetric = {
  key: string
  label: string
  definition: string
  isDedup: boolean
  mapped: boolean
  value: number | null
  period: string | null
  sources: ImpactSource[]
}

/** Resolve a single source series to a scalar per its aggregation rule. */
export function resolveAgg(series: { period: string; value: number }[] | undefined, agg: string): number | null {
  if (!series || !series.length) return null
  switch (agg) {
    case 'sum': return series.reduce((a, b) => a + b.value, 0)
    case 'count': return series.length
    case 'avg': return series.reduce((a, b) => a + b.value, 0) / series.length
    default: return series[series.length - 1].value // 'latest'
  }
}

/** Latest period label across a metric's mapped source series (for display). */
function latestPeriod(byKey: Record<string, MetricSeries>, sourceKeys: string[]): string | null {
  let p: string | null = null
  for (const k of sourceKeys) {
    const s = byKey[k]?.series
    if (s?.length) p = s[s.length - 1].period || p
  }
  return p
}

/**
 * Compute impact metrics. `byKey` is the dominant series per source metric_key
 * (from dominantSeriesByKey). Only `category==='impact'` definitions are returned,
 * each summing its active mappings. A definition with no active mapping → mapped:false,
 * value:null (surfaced as "unmapped").
 */
export function computeImpact(
  defs: DefinitionLite[],
  mappings: Mapping[],
  byKey: Record<string, MetricSeries>,
): ImpactMetric[] {
  return defs
    .filter((d) => d.category === 'impact')
    .map((d) => {
      const active = mappings.filter((m) => m.definition_key === d.key && m.status === 'active')
      const sources: ImpactSource[] = active.map((m) => ({
        key: m.source_metric_key,
        agg: m.agg,
        value: resolveAgg(byKey[m.source_metric_key]?.series, m.agg),
      }))
      const present = sources.filter((s) => s.value !== null)
      const value = present.length ? present.reduce((a, s) => a + (s.value as number), 0) : null
      return {
        key: d.key,
        label: d.display_name,
        definition: d.definition,
        isDedup: d.is_dedup_rule,
        mapped: active.length > 0,
        value,
        period: latestPeriod(byKey, active.map((m) => m.source_metric_key)),
        sources,
      }
    })
}

/** Definitions (any category) that have zero active mappings — the lineage gaps. */
export function unmappedDefinitions(defs: DefinitionLite[], mappings: Mapping[]): string[] {
  const mapped = new Set(mappings.filter((m) => m.status === 'active').map((m) => m.definition_key))
  return defs.filter((d) => !mapped.has(d.key)).map((d) => d.key)
}

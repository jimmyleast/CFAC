// Exception engine (build-spec §10.5, Phase 3). Pure detection rules over the
// aggregate data layer — surfaces bad/missing/stale/duplicated data instead of
// staff combing 12 spreadsheets by hand. Aggregate metadata only (no client PII).
// Computed live (always current); the API supplies DB data + a clock.

import { canonicalDimKey } from '@/lib/metrics/dimension'

export type ExSeverity = 'error' | 'warning'
export type Exception = {
  rule: string
  severity: ExSeverity
  sourceId: string | null
  sourceName: string | null
  metricKey: string | null
  fieldRef: string | null
  message: string
}

export type ExMetricRow = {
  source_id: string | null
  metric_key: string
  label: string | null
  value: number | string | null
  period_label: string | null
  period_start: string | null
  dimension?: unknown
}
export type ExSource = { id: string; name: string; last_imported_at: string | null }
export type ExDefinition = { key: string; category: string }
export type ExMapping = { definition_key: string; status: string }

export type DetectInput = {
  metrics: ExMetricRow[]
  sources: ExSource[]
  definitions: ExDefinition[]
  mappings: ExMapping[]
  nowMs: number
}

export const STALE_DAYS = 180
const OUTLIER_HI = 5 // latest ≥ 5× prior
const OUTLIER_LO = 0.2 // or ≤ 1/5× prior

// Shared with the scorecard so both model "the same series" identically (sorted,
// key-order-independent). Divergent hashing would let a collision the scorecard
// merges go unflagged here.
const dimKey = canonicalDimKey
function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
}

export function detectExceptions(input: DetectInput): Exception[] {
  const { metrics, sources, definitions, mappings, nowMs } = input
  const out: Exception[] = []
  const nameById = new Map(sources.map((s) => [s.id, s.name]))

  // 1. Duplicate facts: same (source, metric, period, dimension) more than once → double-count risk.
  const dupCount = new Map<string, number>()
  for (const m of metrics) {
    if (!m.period_label) continue
    const id = `${m.source_id || ''}|${m.metric_key}|${m.period_label}|${dimKey(m.dimension)}`
    dupCount.set(id, (dupCount.get(id) || 0) + 1)
  }
  for (const [id, n] of dupCount) {
    if (n > 1) {
      const [sid, key, period] = id.split('|')
      out.push({ rule: 'duplicate_metric', severity: 'error', sourceId: sid || null, sourceName: nameById.get(sid) || null, metricKey: key, fieldRef: period, message: `Duplicate: ${key} for ${period} appears ${n}× — risks double-counting.` })
    }
  }

  // 1b. Cross-source duplicate: the SAME total (dimension-empty) metric_key + period
  // emitted by MORE THAN ONE source. The dashboard/scorecard SUM totals across
  // sources, so this double-counts (e.g. the same workbook loaded under two source
  // slugs). The within-source rule above can't see this (different source_id).
  // Identical values → almost certainly an accidental duplicate (error); differing
  // values → may be a legitimate multi-source sum, flag to confirm (warning).
  // Group on period_start (NOT period_label) because the scorecard buckets/sums on
  // period_start — two sources labelling the same period differently ("2025" vs
  // "FY2025") still double-count, and must be caught.
  const crossSource = new Map<string, { label: string; sources: Set<string>; values: Set<number> }>()
  for (const m of metrics) {
    if (!m.period_start || isMissing(m.value)) continue
    if (dimKey(m.dimension) !== '') continue // totals only — breakdowns legitimately repeat
    const id = `${m.metric_key}|${m.period_start}`
    const g = crossSource.get(id) || { label: m.period_label || m.period_start, sources: new Set<string>(), values: new Set<number>() }
    g.sources.add(m.source_id || '')
    g.values.add(Number(m.value))
    crossSource.set(id, g)
  }
  for (const [id, g] of crossSource) {
    if (g.sources.size > 1) {
      const key = id.split('|')[0]
      const identical = g.values.size === 1
      const names = [...g.sources].map((s) => nameById.get(s) || 'unknown').join(', ')
      out.push({
        rule: 'duplicate_cross_source',
        // Identical totals from >1 source = almost certainly the same data loaded
        // twice (error). Differing values = possibly a legitimate multi-source sum
        // (warning). The error message asks to verify rather than prescribe deletion,
        // since two real sources could coincidentally match.
        severity: identical ? 'error' : 'warning',
        sourceId: null, sourceName: names, metricKey: key, fieldRef: g.label,
        message: identical
          ? `Possible double-count: ${key} for ${g.label} is reported identically by ${g.sources.size} sources (${names}) — the dashboard sums these. Verify this isn't the same data loaded twice.`
          : `${key} for ${g.label} comes from ${g.sources.size} sources (${names}) with different values — the dashboard sums them; confirm that's intended, not a duplicate.`,
      })
    }
  }

  // 2. Missing value: a row with a period but no usable numeric value.
  for (const m of metrics) {
    if (m.period_label && isMissing(m.value)) {
      out.push({ rule: 'missing_value', severity: 'error', sourceId: m.source_id, sourceName: nameById.get(m.source_id || '') || null, metricKey: m.metric_key, fieldRef: m.period_label, message: `Missing value: ${m.metric_key} for ${m.period_label} has no number.` })
    }
  }

  // 3. Inconsistent label: one metric_key carrying more than one display label → definition drift.
  const labelsByKey = new Map<string, Set<string>>()
  for (const m of metrics) {
    const l = (m.label || '').trim()
    if (!l) continue
    if (!labelsByKey.has(m.metric_key)) labelsByKey.set(m.metric_key, new Set())
    labelsByKey.get(m.metric_key)!.add(l)
  }
  for (const [key, labels] of labelsByKey) {
    if (labels.size > 1) {
      out.push({ rule: 'inconsistent_label', severity: 'warning', sourceId: null, sourceName: null, metricKey: key, fieldRef: null, message: `Inconsistent labels for ${key}: ${[...labels].map((l) => `"${l}"`).join(', ')} — pick one operational definition.` })
    }
  }

  // 4. Stale / never-imported sources → Quality (currency).
  for (const s of sources) {
    if (!s.last_imported_at) {
      out.push({ rule: 'stale_source', severity: 'warning', sourceId: s.id, sourceName: s.name, metricKey: null, fieldRef: null, message: `${s.name} has no data imported yet.` })
      continue
    }
    const days = Math.floor((nowMs - new Date(s.last_imported_at).getTime()) / 86_400_000)
    if (days > STALE_DAYS) {
      out.push({ rule: 'stale_source', severity: 'warning', sourceId: s.id, sourceName: s.name, metricKey: null, fieldRef: null, message: `${s.name} hasn't been updated in ${days} days.` })
    }
  }

  // 5. Unmapped impact metric → blank headline / broken lineage.
  const activeMapped = new Set(mappings.filter((m) => m.status === 'active').map((m) => m.definition_key))
  for (const d of definitions) {
    if (d.category === 'impact' && !activeMapped.has(d.key)) {
      out.push({ rule: 'unmapped_impact', severity: 'warning', sourceId: null, sourceName: null, metricKey: d.key, fieldRef: null, message: `Impact metric "${d.key}" has no mapped source — its headline will be blank.` })
    }
  }

  // 6. Value outlier: latest vs prior in a series jumps ≥5× or ≤1/5 → likely keying error.
  const series = new Map<string, { ps: string; v: number }[]>()
  for (const m of metrics) {
    if (isMissing(m.value) || !m.period_start) continue
    const id = `${m.source_id || ''}|${m.metric_key}|${dimKey(m.dimension)}`
    if (!series.has(id)) series.set(id, [])
    series.get(id)!.push({ ps: m.period_start, v: Number(m.value) })
  }
  for (const [id, pts] of series) {
    if (pts.length < 3) continue
    pts.sort((a, b) => a.ps.localeCompare(b.ps))
    const last = pts[pts.length - 1].v
    const prev = pts[pts.length - 2].v
    if (prev > 0) {
      const ratio = last / prev
      if (ratio >= OUTLIER_HI || ratio <= OUTLIER_LO) {
        const [sid, key] = id.split('|')
        out.push({ rule: 'value_outlier', severity: 'warning', sourceId: sid || null, sourceName: nameById.get(sid) || null, metricKey: key, fieldRef: null, message: `Possible keying error: ${key} changed ${ratio >= OUTLIER_HI ? '↑' : '↓'} ${ratio.toFixed(1)}× (${prev} → ${last}).` })
      }
    }
  }

  return out
}

export function summarize(exceptions: Exception[]) {
  return {
    total: exceptions.length,
    errors: exceptions.filter((e) => e.severity === 'error').length,
    warnings: exceptions.filter((e) => e.severity === 'warning').length,
    byRule: exceptions.reduce<Record<string, number>>((acc, e) => { acc[e.rule] = (acc[e.rule] || 0) + 1; return acc }, {}),
  }
}

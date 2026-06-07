import { describe, it, expect } from 'vitest'
import { detectExceptions, summarize, STALE_DAYS, type DetectInput } from '@/lib/integrity/rules'

const NOW = new Date('2026-06-07T00:00:00Z').getTime()

function base(overrides: Partial<DetectInput> = {}): DetectInput {
  return {
    metrics: [],
    sources: [],
    definitions: [],
    mappings: [],
    nowMs: NOW,
    ...overrides,
  }
}
const rulesOf = (input: DetectInput) => detectExceptions(input).map((e) => e.rule)

describe('detectExceptions', () => {
  it('flags duplicate (source, metric, period, dimension)', () => {
    const ex = detectExceptions(base({
      metrics: [
        { source_id: 's1', metric_key: 'reach', label: 'Reach', value: 100, period_label: '2025', period_start: '2025-01-01', dimension: {} },
        { source_id: 's1', metric_key: 'reach', label: 'Reach', value: 100, period_label: '2025', period_start: '2025-01-01', dimension: {} },
      ],
    }))
    expect(ex.filter((e) => e.rule === 'duplicate_metric')).toHaveLength(1)
    expect(ex[0].severity).toBe('error')
  })

  it('does NOT flag same metric across different periods as duplicate', () => {
    expect(rulesOf(base({
      metrics: [
        { source_id: 's1', metric_key: 'reach', label: 'Reach', value: 1, period_label: '2024', period_start: '2024-01-01', dimension: {} },
        { source_id: 's1', metric_key: 'reach', label: 'Reach', value: 2, period_label: '2025', period_start: '2025-01-01', dimension: {} },
      ],
    }))).not.toContain('duplicate_metric')
  })

  it('flags missing value when a period has no usable number', () => {
    const ex = rulesOf(base({ metrics: [{ source_id: 's1', metric_key: 'reach', label: 'Reach', value: null, period_label: '2025', period_start: '2025-01-01', dimension: {} }] }))
    expect(ex).toContain('missing_value')
  })

  it('flags inconsistent labels for one metric_key', () => {
    const ex = rulesOf(base({
      metrics: [
        { source_id: 's1', metric_key: 'reach', label: 'Reach', value: 1, period_label: '2024', period_start: '2024-01-01', dimension: {} },
        { source_id: 's1', metric_key: 'reach', label: 'Total Reach', value: 2, period_label: '2025', period_start: '2025-01-01', dimension: {} },
      ],
    }))
    expect(ex).toContain('inconsistent_label')
  })

  it('flags stale + never-imported sources', () => {
    const stale = new Date(NOW - (STALE_DAYS + 10) * 86_400_000).toISOString()
    const fresh = new Date(NOW - 5 * 86_400_000).toISOString()
    const ex = detectExceptions(base({
      sources: [
        { id: 'a', name: 'Old Sheet', last_imported_at: stale },
        { id: 'b', name: 'New Sheet', last_imported_at: fresh },
        { id: 'c', name: 'Empty Sheet', last_imported_at: null },
      ],
    }))
    const stales = ex.filter((e) => e.rule === 'stale_source')
    expect(stales.map((e) => e.sourceName).sort()).toEqual(['Empty Sheet', 'Old Sheet'])
  })

  it('flags an impact definition with no active mapping', () => {
    const ex = rulesOf(base({
      definitions: [{ key: 'reach', category: 'impact' }, { key: 'svc_medical', category: 'service' }],
      mappings: [{ definition_key: 'reach', status: 'draft' }], // draft does not count
    }))
    expect(ex.filter((r) => r === 'unmapped_impact')).toHaveLength(1) // only reach (impact); svc is not impact
  })

  it('flags a value outlier (≥5× jump)', () => {
    const ex = rulesOf(base({
      metrics: [
        { source_id: 's1', metric_key: 'm', label: 'M', value: 10, period_label: '2023', period_start: '2023-01-01', dimension: {} },
        { source_id: 's1', metric_key: 'm', label: 'M', value: 12, period_label: '2024', period_start: '2024-01-01', dimension: {} },
        { source_id: 's1', metric_key: 'm', label: 'M', value: 600, period_label: '2025', period_start: '2025-01-01', dimension: {} },
      ],
    }))
    expect(ex).toContain('value_outlier')
  })

  it('value=0 is NOT missing; empty-string and non-numeric ARE missing', () => {
    const row = (value: unknown) => ({ source_id: 's1', metric_key: 'm', label: 'M', value: value as number, period_label: '2025', period_start: '2025-01-01', dimension: {} })
    expect(rulesOf(base({ metrics: [row(0)] }))).not.toContain('missing_value') // legit zero kept
    expect(rulesOf(base({ metrics: [row('')] }))).toContain('missing_value')
    expect(rulesOf(base({ metrics: [row('abc')] }))).toContain('missing_value')
    expect(rulesOf(base({ metrics: [row(null)] }))).toContain('missing_value')
  })

  it('same source/metric/period but DIFFERENT dimension is not a duplicate', () => {
    expect(rulesOf(base({
      metrics: [
        { source_id: 's1', metric_key: 'm', label: 'M', value: 1, period_label: '2025', period_start: '2025-01-01', dimension: { agency: 'DCFS' } },
        { source_id: 's1', metric_key: 'm', label: 'M', value: 2, period_label: '2025', period_start: '2025-01-01', dimension: { agency: 'CACD' } },
      ],
    }))).not.toContain('duplicate_metric')
  })

  it('outlier down-jump (≤1/5×) is flagged; prev=0 never throws and is not flagged', () => {
    const down = rulesOf(base({ metrics: [
      { source_id: 's', metric_key: 'm', label: 'M', value: 500, period_label: '2023', period_start: '2023-01-01', dimension: {} },
      { source_id: 's', metric_key: 'm', label: 'M', value: 480, period_label: '2024', period_start: '2024-01-01', dimension: {} },
      { source_id: 's', metric_key: 'm', label: 'M', value: 10, period_label: '2025', period_start: '2025-01-01', dimension: {} },
    ] }))
    expect(down).toContain('value_outlier')
    // prev=0 → ratio would be Infinity; must be skipped, not crash
    const zeroPrev = rulesOf(base({ metrics: [
      { source_id: 's', metric_key: 'z', label: 'Z', value: 5, period_label: '2023', period_start: '2023-01-01', dimension: {} },
      { source_id: 's', metric_key: 'z', label: 'Z', value: 0, period_label: '2024', period_start: '2024-01-01', dimension: {} },
      { source_id: 's', metric_key: 'z', label: 'Z', value: 50, period_label: '2025', period_start: '2025-01-01', dimension: {} },
    ] }))
    expect(zeroPrev).not.toContain('value_outlier')
  })

  it('clean data yields zero exceptions', () => {
    const ex = detectExceptions(base({
      metrics: [{ source_id: 's1', metric_key: 'reach', label: 'Reach', value: 100, period_label: '2025', period_start: '2025-01-01', dimension: {} }],
      sources: [{ id: 's1', name: 'Sheet', last_imported_at: new Date(NOW).toISOString() }],
      definitions: [{ key: 'reach', category: 'impact' }],
      mappings: [{ definition_key: 'reach', status: 'active' }],
    }))
    expect(ex).toHaveLength(0)
  })
})

describe('summarize', () => {
  it('counts errors/warnings/byRule', () => {
    const s = summarize([
      { rule: 'duplicate_metric', severity: 'error', sourceId: null, sourceName: null, metricKey: null, fieldRef: null, message: '' },
      { rule: 'stale_source', severity: 'warning', sourceId: null, sourceName: null, metricKey: null, fieldRef: null, message: '' },
    ])
    expect(s).toEqual({ total: 2, errors: 1, warnings: 1, byRule: { duplicate_metric: 1, stale_source: 1 } })
  })
})

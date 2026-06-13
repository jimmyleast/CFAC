import { describe, expect, it } from 'vitest'
import { buildExecutiveSummary } from '@/lib/metrics/executive'

describe('buildExecutiveSummary', () => {
  it('uses the latest rollup period across sources, even when older history has more rows', () => {
    const out = buildExecutiveSummary([
      { metric_key: 'reach', value: 14743, period_label: '2023', period_start: '2023-01-01', dimension: {} },
      { metric_key: 'reach', value: 16995, period_label: '2024', period_start: '2024-01-01', dimension: {} },
      { metric_key: 'reach', value: 21082, period_label: '2025', period_start: '2025-01-01', dimension: {} },
      { metric_key: 'reach', value: 14835, period_label: '2026', period_start: '2026-01-01', dimension: { workbook_sheet: 'Reach' } },
    ])

    const reach = out.tiles.find((t) => t.key === 'reach')!
    expect(reach.value).toBe(14835)
    expect(reach.period).toBe('2026')
    expect(reach.priorValue).toBe(21082)
    expect(out.latestPeriod).toBe('2026')
  })

  it('does not let breakdown dimensions pollute executive rollups', () => {
    const out = buildExecutiveSummary([
      { metric_key: 'volunteers', value: 296, period_label: '2026', period_start: '2026-01-01', dimension: { workbook_sheet: 'Reach' } },
      { metric_key: 'volunteers', value: 999, period_label: '2026', period_start: '2026-01-01', dimension: { workbook_sheet: 'Group', volunteer_type: 'Corporate' } },
    ])

    const volunteers = out.tiles.find((t) => t.key === 'volunteers')!
    expect(volunteers.value).toBe(296)
  })
})

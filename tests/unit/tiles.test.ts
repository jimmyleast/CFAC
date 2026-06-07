import { describe, it, expect } from 'vitest'
import { dominantSeriesByKey, seriesToTile, rowsToTiles, resolveComponentTiles, type MetricRow } from '@/lib/metrics/tiles'
import type { SupabaseClient } from '@supabase/supabase-js'

const rows: MetricRow[] = [
  { metric_key: 'reach', label: 'Reach', value: 100, period_label: '2024', period_start: '2024-01-01', source_id: 's1', dimension: {} },
  { metric_key: 'reach', label: 'Reach', value: 150, period_label: '2025', period_start: '2025-01-01', source_id: 's1', dimension: {} },
  { metric_key: 'kids', label: 'Children', value: 800, period_label: '2025', period_start: '2025-01-01', source_id: 's1', dimension: {} },
]

describe('dominantSeriesByKey', () => {
  it('groups by metric_key and keeps the dominant (longest) series', () => {
    const multi: MetricRow[] = [
      { metric_key: 'c', label: 'C', value: 1, period_label: '2023', period_start: '2023-01-01', source_id: 's', dimension: { a: 'X' } },
      { metric_key: 'c', label: 'C', value: 2, period_label: '2024', period_start: '2024-01-01', source_id: 's', dimension: { a: 'X' } },
      { metric_key: 'c', label: 'C', value: 99, period_label: '2024', period_start: '2024-01-01', source_id: 's', dimension: { a: 'Y' } },
    ]
    const byKey = dominantSeriesByKey(multi)
    expect(byKey['c'].series).toHaveLength(2) // X (2 pts), not merged with Y
    expect(byKey['c'].series.map((p) => p.value)).toEqual([1, 2])
  })

  it('skips non-finite values', () => {
    const byKey = dominantSeriesByKey([{ metric_key: 'x', value: 'n/a', period_label: '2025', period_start: '2025-01-01' }])
    expect(byKey['x']).toBeUndefined()
  })
})

describe('seriesToTile', () => {
  it('computes latest, prior, and deltaPct', () => {
    const tile = seriesToTile({ key: 'reach', label: 'Reach', series: [{ period: '2024', value: 100 }, { period: '2025', value: 150 }] })
    expect(tile.value).toBe(150)
    expect(tile.priorValue).toBe(100)
    expect(tile.deltaPct).toBe(50)
  })
  it('null delta when no prior or prior is zero', () => {
    expect(seriesToTile({ key: 'x', label: 'X', series: [{ period: '2025', value: 5 }] }).deltaPct).toBeNull()
    expect(seriesToTile({ key: 'x', label: 'X', series: [{ period: '2024', value: 0 }, { period: '2025', value: 5 }] }).deltaPct).toBeNull()
  })
})

describe('rowsToTiles', () => {
  it('returns one tile per key, alphabetised by label', () => {
    const tiles = rowsToTiles(rows)
    expect(tiles.map((t) => t.key)).toEqual(['kids', 'reach']) // Children, Reach
    expect(tiles.find((t) => t.key === 'reach')!.value).toBe(150)
  })
})

describe('resolveComponentTiles — scoping', () => {
  // Mock branches on table; captures the source_id filter passed to the metrics query.
  function mockAdmin(sources: unknown[], metrics: unknown[], onIn: (vals: unknown) => void) {
    const metricsChain: Record<string, unknown> = {
      select: () => metricsChain,
      in: (_col: string, vals: unknown) => { onIn(vals); return metricsChain },
      not: () => metricsChain,
      order: () => metricsChain,
      limit: () => Promise.resolve({ data: metrics }),
    }
    return {
      from: (table: string) =>
        table === 'data_sources'
          ? { select: () => Promise.resolve({ data: sources }) }
          : metricsChain,
    } as unknown as SupabaseClient
  }

  const sources = [
    { id: 's1', components: { slug: 'advocacy' } },
    { id: 's2', components: { slug: 'medical' } },
  ]
  const advocacyMetrics = [
    { metric_key: 'caseload', label: 'Caseload', value: 40, period_label: '2025', period_start: '2025-01-01', source_id: 's1', dimension: {} },
  ]

  it('queries ONLY the requested component’s source ids', async () => {
    let captured: unknown = null
    const admin = mockAdmin(sources, advocacyMetrics, (v) => { captured = v })
    const tiles = await resolveComponentTiles(admin, 'advocacy')
    expect(captured).toEqual(['s1']) // not s2 (medical)
    expect(tiles.map((t) => t.key)).toEqual(['caseload'])
  })

  it('returns [] without querying metrics when the component has no sources', async () => {
    let queried = false
    const admin = mockAdmin(sources, advocacyMetrics, () => { queried = true })
    const tiles = await resolveComponentTiles(admin, 'no-such-component')
    expect(tiles).toEqual([])
    expect(queried).toBe(false)
  })
})

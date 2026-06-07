import { describe, it, expect } from 'vitest'
import { resolveAgg, computeImpact, unmappedDefinitions, type DefinitionLite, type Mapping } from '@/lib/metrics/impact'
import type { MetricSeries } from '@/lib/metrics/tiles'

const byKey: Record<string, MetricSeries> = {
  reach: { key: 'reach', label: 'Reach', series: [{ period: '2024', value: 19000 }, { period: '2025', value: 21082 }] },
  children_served: { key: 'children_served', label: 'Children', series: [{ period: '2025', value: 1007 }] },
  forensic_interviews: { key: 'forensic_interviews', label: 'FI', series: [{ period: '2025', value: 941 }] },
  medical: { key: 'medical', label: 'Medical', series: [{ period: '2025', value: 144 }] },
}

describe('resolveAgg', () => {
  it('latest takes the last point; sum/count/avg aggregate', () => {
    const s = [{ period: '2024', value: 10 }, { period: '2025', value: 30 }]
    expect(resolveAgg(s, 'latest')).toBe(30)
    expect(resolveAgg(s, 'sum')).toBe(40)
    expect(resolveAgg(s, 'count')).toBe(2)
    expect(resolveAgg(s, 'avg')).toBe(20)
  })
  it('null for empty/missing series', () => {
    expect(resolveAgg([], 'latest')).toBeNull()
    expect(resolveAgg(undefined, 'sum')).toBeNull()
  })
})

const defs: DefinitionLite[] = [
  { key: 'reach', display_name: 'Reach', definition: '...', category: 'impact', is_dedup_rule: false },
  { key: 'clients_served', display_name: 'Clients Served', definition: '...', category: 'impact', is_dedup_rule: true },
  { key: 'services_provided', display_name: 'Services Provided', definition: '...', category: 'impact', is_dedup_rule: false },
  { key: 'svc_medical', display_name: 'Service — Medical', definition: '...', category: 'service', is_dedup_rule: false },
]
const mappings: Mapping[] = [
  { definition_key: 'reach', source_metric_key: 'reach', agg: 'latest', status: 'active' },
  { definition_key: 'clients_served', source_metric_key: 'children_served', agg: 'latest', status: 'active' },
  { definition_key: 'services_provided', source_metric_key: 'forensic_interviews', agg: 'latest', status: 'active' },
  { definition_key: 'services_provided', source_metric_key: 'medical', agg: 'latest', status: 'active' },
]

describe('computeImpact', () => {
  it('computes only impact definitions, summing active mappings', () => {
    const out = computeImpact(defs, mappings, byKey)
    expect(out.map((m) => m.key)).toEqual(['reach', 'clients_served', 'services_provided']) // svc_medical excluded (not impact)
    expect(out.find((m) => m.key === 'reach')!.value).toBe(21082)
    expect(out.find((m) => m.key === 'clients_served')!.value).toBe(1007)
    expect(out.find((m) => m.key === 'services_provided')!.value).toBe(941 + 144) // FI + Medical
    expect(out.find((m) => m.key === 'clients_served')!.isDedup).toBe(true)
  })

  it('flags a definition with no active mapping as unmapped, value null', () => {
    const out = computeImpact(defs, [{ definition_key: 'reach', source_metric_key: 'reach', agg: 'latest', status: 'active' }], byKey)
    const cs = out.find((m) => m.key === 'clients_served')!
    expect(cs.mapped).toBe(false)
    expect(cs.value).toBeNull()
  })

  it('ignores draft (non-active) mappings', () => {
    const out = computeImpact(defs, [{ definition_key: 'reach', source_metric_key: 'reach', agg: 'latest', status: 'draft' }], byKey)
    expect(out.find((m) => m.key === 'reach')!.mapped).toBe(false)
  })
})

describe('unmappedDefinitions', () => {
  it('lists definitions with no active mapping', () => {
    const out = unmappedDefinitions(defs, mappings)
    expect(out).toContain('svc_medical')
    expect(out).not.toContain('reach')
  })
})

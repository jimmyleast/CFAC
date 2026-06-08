import { describe, it, expect } from 'vitest'
import { ORG_HEALTH_SPEC, resolveHealthSections, SOURCE_LABEL } from '@/lib/dashboard/org-health-spec'

describe('resolveHealthSections', () => {
  it('resolves a live tile when its metric_key has a value', () => {
    const latest = new Map([['clients_served', { value: 895, period: '2025' }]])
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, latest)
    const tile = sections.flatMap((s) => s.tiles).find((t) => t.metricKey === 'clients_served')!
    expect(tile.state).toBe('live')
    expect(tile.value).toBe(895)
    expect(tile.period).toBe('2025')
  })

  it('marks a metric tile with no data as awaiting (not live)', () => {
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, new Map())
    const tile = sections.flatMap((s) => s.tiles).find((t) => t.metricKey === 'clients_served')!
    expect(tile.state).toBe('awaiting')
    expect(tile.value).toBeNull()
  })

  it('surfaces PHI-gated awaiting tiles with the Collaborate source + phiGated flag', () => {
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, new Map())
    const acute = sections.flatMap((s) => s.tiles).find((t) => t.label.startsWith('Active Acute'))!
    expect(acute.state).toBe('awaiting')
    expect(acute.phiGated).toBe(true)
    expect(acute.awaitingLabel).toBe(SOURCE_LABEL.collaborate)
  })

  it('surfaces connector-awaiting tiles (Bloomerang/QuickBooks) without PHI gate', () => {
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, new Map())
    const donors = sections.flatMap((s) => s.tiles).find((t) => t.label === 'Active Donors')!
    expect(donors.awaitingLabel).toBe('Bloomerang')
    expect(donors.phiGated).toBe(false)
    const cash = sections.flatMap((s) => s.tiles).find((t) => t.label === 'Cash Flow')!
    expect(cash.awaitingLabel).toBe('QuickBooks')
  })

  it('HARD GATE: a phiGated tile never resolves live, even if a metric_key is wired onto it', () => {
    // Simulate a future misconfiguration: someone adds a Collaborate-backed key to a
    // phiGated tile. It must STILL show awaiting — the gate is enforced in code.
    const spec = [{ title: 'X', blurb: '', tiles: [{ label: 'Active Acute Clients', metricKey: 'acute_active', awaiting: 'collaborate' as const, phiGated: true }] }]
    const sections = resolveHealthSections(spec, new Map([['acute_active', { value: 42, period: '2026' }]]))
    const tile = sections[0].tiles[0]
    expect(tile.state).toBe('awaiting')
    expect(tile.value).toBeNull()
    expect(tile.phiGated).toBe(true)
  })

  it('never emits a live tile without a value (no fabricated zeros)', () => {
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, new Map([['volunteers', { value: 897, period: '2025' }]]))
    for (const t of sections.flatMap((s) => s.tiles)) {
      if (t.state === 'live') expect(typeof t.value).toBe('number')
      else expect(t.value).toBeNull()
    }
  })

  it('uses the real profiled import keys for operations tiles', () => {
    const ops = ORG_HEALTH_SPEC.find((s) => s.title === 'Operations')!
    expect(ops.tiles.map((t) => t.metricKey)).toEqual([
      'maintenance_requests_total',
      'maintenance_on_time_yes',
      'fleet_trips_total',
      'fleet_miles_driven',
    ])
  })

  it('uses the real impact-history profile keys for annual dashboard tiles', () => {
    const keys = ORG_HEALTH_SPEC.flatMap((s) => s.tiles.map((t) => t.metricKey).filter(Boolean))
    expect(keys).toContain('clients_served')
    expect(keys).toContain('medical')
    expect(keys).toContain('mental_health')
    expect(keys).toContain('education')
    expect(keys).toContain('community_events')
    expect(keys).not.toContain('children_served')
    expect(keys).not.toContain('medical_exams')
    expect(keys).not.toContain('mental_health_sessions')
  })
})

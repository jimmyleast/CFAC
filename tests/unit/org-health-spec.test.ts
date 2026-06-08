import { describe, it, expect } from 'vitest'
import { ORG_HEALTH_SPEC, resolveHealthSections, SOURCE_LABEL } from '@/lib/dashboard/org-health-spec'

describe('resolveHealthSections', () => {
  it('resolves a live tile when its metric_key has a value', () => {
    const latest = new Map([['children_served', { value: 895, period: '2025' }]])
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, latest)
    const tile = sections.flatMap((s) => s.tiles).find((t) => t.metricKey === 'children_served')!
    expect(tile.state).toBe('live')
    expect(tile.value).toBe(895)
    expect(tile.period).toBe('2025')
  })

  it('marks a metric tile with no data as awaiting (not live)', () => {
    const sections = resolveHealthSections(ORG_HEALTH_SPEC, new Map())
    const tile = sections.flatMap((s) => s.tiles).find((t) => t.metricKey === 'children_served')!
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
})

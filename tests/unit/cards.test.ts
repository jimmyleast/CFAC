import { describe, it, expect } from 'vitest'
import { coerceViewSpec, parseViewSpec, stripViewLine, resolveViewCard } from '@/lib/hope/cards'
import type { SupabaseClient } from '@supabase/supabase-js'

// Minimal mock matching the chain in resolveViewCard:
// admin.from(...).select(...).in(...).not(...).order(...)
function mockAdmin(rows: unknown[]): SupabaseClient {
  const chain = {
    select: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => Promise.resolve({ data: rows }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('coerceViewSpec', () => {
  it('accepts a valid spec and defaults kind to tiles', () => {
    expect(coerceViewSpec({ title: 'Reach', metricKeys: ['reach'] })).toEqual({ title: 'Reach', kind: 'tiles', metricKeys: ['reach'] })
  })
  it('honors kind=bars', () => {
    expect(coerceViewSpec({ title: 'T', kind: 'bars', metricKeys: ['a'] })?.kind).toBe('bars')
  })
  it('rejects when no usable metric keys', () => {
    expect(coerceViewSpec({ title: 'x', metricKeys: [] })).toBeNull()
    expect(coerceViewSpec({ title: 'x', metricKeys: [1, null] })).toBeNull()
    expect(coerceViewSpec(null)).toBeNull()
  })
  it('caps key count and trims', () => {
    const spec = coerceViewSpec({ title: 'x', metricKeys: Array.from({ length: 20 }, (_, i) => ` k${i} `) })
    expect(spec?.metricKeys.length).toBe(8)
    expect(spec?.metricKeys[0]).toBe('k0')
  })
})

describe('parseViewSpec / stripViewLine', () => {
  it('extracts a [[VIEW]] block', () => {
    const raw = 'Here it is.\n[[VIEW]] {"title":"Trend","kind":"bars","metricKeys":["children_served"]}\n[[FOLLOWUPS]] a || b'
    expect(parseViewSpec(raw)).toEqual({ title: 'Trend', kind: 'bars', metricKeys: ['children_served'] })
  })
  it('returns null when no view block', () => {
    expect(parseViewSpec('just prose [[FOLLOWUPS]] a || b')).toBeNull()
  })
  it('strips the view block out of prose, keeping followups', () => {
    const raw = 'Answer text.\n[[VIEW]] {"title":"x","metricKeys":["a"]}\n[[FOLLOWUPS]] q1 || q2'
    const stripped = stripViewLine(raw)
    expect(stripped).not.toContain('[[VIEW]]')
    expect(stripped).toContain('[[FOLLOWUPS]]')
    expect(stripped.startsWith('Answer text.')).toBe(true)
  })
})

describe('resolveViewCard', () => {
  const rows = [
    { metric_key: 'reach', label: 'Reach', value: 100, period_label: '2024', period_start: '2024-01-01' },
    { metric_key: 'reach', label: 'Reach', value: 150, period_label: '2025', period_start: '2025-01-01' },
  ]

  it('fills real values + computes delta, dropping out-of-scope keys', async () => {
    const spec = { title: 'Reach', kind: 'tiles' as const, metricKeys: ['reach', 'not_allowed'] }
    const card = await resolveViewCard(spec, mockAdmin(rows), ['reach'])
    expect(card).not.toBeNull()
    expect(card!.tiles).toHaveLength(1)
    expect(card!.tiles[0].value).toBe(150)
    expect(card!.tiles[0].priorValue).toBe(100)
    expect(card!.tiles[0].deltaPct).toBe(50)
  })

  it('returns null when no requested key is allowed', async () => {
    const spec = { title: 'x', kind: 'tiles' as const, metricKeys: ['nope'] }
    expect(await resolveViewCard(spec, mockAdmin(rows), ['reach'])).toBeNull()
  })

  it('bars view keeps a single tile', async () => {
    const spec = { title: 'x', kind: 'bars' as const, metricKeys: ['reach'] }
    const card = await resolveViewCard(spec, mockAdmin(rows), ['reach'])
    expect(card!.kind).toBe('bars')
    expect(card!.tiles).toHaveLength(1)
    expect(card!.tiles[0].series).toHaveLength(2)
  })

  it('does NOT merge multiple dimensions of one key — keeps the dominant series', async () => {
    const multiDim = [
      // agency=DCFS: 3 points (dominant)
      { metric_key: 'cases', label: 'Cases', value: 10, period_label: '2023', period_start: '2023-01-01', source_id: 's1', dimension: { agency: 'DCFS' } },
      { metric_key: 'cases', label: 'Cases', value: 12, period_label: '2024', period_start: '2024-01-01', source_id: 's1', dimension: { agency: 'DCFS' } },
      { metric_key: 'cases', label: 'Cases', value: 14, period_label: '2025', period_start: '2025-01-01', source_id: 's1', dimension: { agency: 'DCFS' } },
      // agency=CACD: 1 point
      { metric_key: 'cases', label: 'Cases', value: 99, period_label: '2025', period_start: '2025-01-01', source_id: 's1', dimension: { agency: 'CACD' } },
    ]
    const card = await resolveViewCard({ title: 'Cases', kind: 'bars', metricKeys: ['cases'] }, mockAdmin(multiDim), ['cases'])
    expect(card!.tiles[0].series).toHaveLength(3) // dominant DCFS series, not 4 merged
    expect(card!.tiles[0].value).toBe(14)
  })
})

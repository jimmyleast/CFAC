import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/hope/context', () => ({
  buildDataCatalog: vi.fn(async () => ({ text: 'METRICS:\n- reach 2025=21082', metricKeys: ['reach'], hasData: true, staleDays: 0 })),
}))
vi.mock('@/lib/hope/providers', () => ({ generateAnthropic: vi.fn() }))
vi.mock('@/lib/hope/critique', () => ({ critique: vi.fn() }))
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))

import { runHopePipeline, splitFollowups } from '@/lib/hope/pipeline'
import { critique } from '@/lib/hope/critique'
import { generateAnthropic } from '@/lib/hope/providers'
import { getAdminClient } from '@/lib/admin'

const mockCritique = critique as unknown as ReturnType<typeof vi.fn>
const mockGen = generateAnthropic as unknown as ReturnType<typeof vi.fn>
const mockAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

const REACH_ROWS = [
  { metric_key: 'reach', label: 'Reach', value: 100, period_label: '2024', period_start: '2024-01-01', source_id: 's', dimension: {} },
  { metric_key: 'reach', label: 'Reach', value: 150, period_label: '2025', period_start: '2025-01-01', source_id: 's', dimension: {} },
]
function adminReturning(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain, in: () => chain, not: () => chain, order: () => chain,
    limit: () => Promise.resolve({ data: rows }),
  }
  return { from: () => chain }
}
const viewGen = (keys: string[]) =>
  `Here it is.\n[[VIEW]] {"title":"V","kind":"tiles","metricKeys":${JSON.stringify(keys)}}\n[[FOLLOWUPS]] a || b`

beforeEach(() => {
  vi.clearAllMocks()
  mockGen.mockResolvedValue('The answer. [[FOLLOWUPS]] a || b')
  mockAdmin.mockReturnValue(adminReturning(REACH_ROWS))
})

describe('splitFollowups', () => {
  it('splits the followups line off the answer', () => {
    expect(splitFollowups('Hi there [[FOLLOWUPS]] one || two')).toEqual({ answer: 'Hi there', followups: ['one', 'two'] })
  })
  it('handles no followups line', () => {
    expect(splitFollowups('Hi there')).toEqual({ answer: 'Hi there', followups: [] })
  })
})

describe('runHopePipeline (block-until-pass safety contract)', () => {
  it('returns a verified answer when the critic passes', async () => {
    mockCritique.mockResolvedValue({ pass: true, score: 9, issues: [], critic: 'gemini' })
    const r = await runHopePipeline('q')
    expect(r.verified).toBe(true)
    expect(r.answer).toBe('The answer.')
    expect(r.iterations).toBe(1)
  })

  it('BLOCKS with a safe fallback when a configured critic errors (fail-closed)', async () => {
    mockCritique.mockResolvedValue({ pass: false, score: 0, issues: ['x'], critic: 'error' })
    const r = await runHopePipeline('q')
    expect(r.verified).toBe(false)
    expect(r.answer).toMatch(/couldn’t confidently verify|couldn't confidently verify/)
  })

  it('returns the answer marked unverified when NO critic is configured (degraded)', async () => {
    mockCritique.mockResolvedValue({ pass: false, score: 0, issues: [], critic: 'none' })
    const r = await runHopePipeline('q')
    expect(r.verified).toBe(false)
    expect(r.answer).toBe('The answer.')
  })

  it('repairs once then passes (2 generate calls)', async () => {
    mockCritique
      .mockResolvedValueOnce({ pass: false, score: 4, issues: ['unsupported'], critic: 'gemini' })
      .mockResolvedValueOnce({ pass: true, score: 9, issues: [], critic: 'gemini' })
    const r = await runHopePipeline('q')
    expect(r.iterations).toBe(2)
    expect(r.verified).toBe(true)
    expect(mockGen).toHaveBeenCalledTimes(2)
  })

  it('BLOCKS after exhausting retries on persistent failure', async () => {
    mockCritique.mockResolvedValue({ pass: false, score: 3, issues: ['bad'], critic: 'gemini' })
    const r = await runHopePipeline('q')
    expect(r.verified).toBe(false)
    expect(r.answer).toMatch(/verify/)
    expect(r.iterations).toBe(2)
  })
})

describe('runHopePipeline — on-the-fly view gating', () => {
  it('verified + view requested → grounded card, prose has no [[VIEW]]', async () => {
    mockGen.mockResolvedValue(viewGen(['reach']))
    mockCritique.mockResolvedValue({ pass: true, score: 9, issues: [], critic: 'gemini' })
    const r = await runHopePipeline('show reach')
    expect(r.verified).toBe(true)
    expect(r.viewRequested).toBe(true)
    expect(r.viewError).toBe(false)
    expect(r.card?.tiles[0].value).toBe(150)
    expect(r.answer).not.toContain('[[VIEW]]')
  })

  it('BLOCKED (critic error) → never attaches a card, even with a [[VIEW]] line', async () => {
    mockGen.mockResolvedValue(viewGen(['reach']))
    mockCritique.mockResolvedValue({ pass: false, score: 2, issues: ['bad'], critic: 'error' })
    const r = await runHopePipeline('show reach')
    expect(r.verified).toBe(false)
    expect(r.card).toBeNull()
    expect(r.viewRequested).toBe(false)
  })

  it('critic NONE (degraded) → no card', async () => {
    mockGen.mockResolvedValue(viewGen(['reach']))
    mockCritique.mockResolvedValue({ pass: false, score: 0, issues: [], critic: 'none' })
    const r = await runHopePipeline('show reach')
    expect(r.card).toBeNull()
  })

  it('verified but out-of-scope key → no card (allowlist enforced)', async () => {
    mockGen.mockResolvedValue(viewGen(['other_components_metric']))
    mockCritique.mockResolvedValue({ pass: true, score: 9, issues: [], critic: 'gemini' })
    const r = await runHopePipeline('show')
    expect(r.viewRequested).toBe(true)
    expect(r.card).toBeNull()
  })

  it('resolveViewCard throws → viewError surfaced, answer still returned', async () => {
    mockGen.mockResolvedValue(viewGen(['reach']))
    mockCritique.mockResolvedValue({ pass: true, score: 9, issues: [], critic: 'gemini' })
    mockAdmin.mockReturnValue({ from: () => { throw new Error('db down') } })
    const r = await runHopePipeline('show reach')
    expect(r.viewError).toBe(true)
    expect(r.card).toBeNull()
    expect(r.verified).toBe(true)
    expect(r.answer).toContain('Here it is.')
  })
})

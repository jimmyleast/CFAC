import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/hope/context', () => ({
  buildDataCatalog: vi.fn(async () => ({ text: 'METRICS:\n- reach 2025=21082', metricKeys: ['reach'], hasData: true, staleDays: 0 })),
}))
vi.mock('@/lib/hope/providers', () => ({ generateAnthropic: vi.fn() }))
vi.mock('@/lib/hope/critique', () => ({ critique: vi.fn() }))

import { runHopePipeline, splitFollowups } from '@/lib/hope/pipeline'
import { critique } from '@/lib/hope/critique'
import { generateAnthropic } from '@/lib/hope/providers'

const mockCritique = critique as unknown as ReturnType<typeof vi.fn>
const mockGen = generateAnthropic as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockGen.mockResolvedValue('The answer. [[FOLLOWUPS]] a || b')
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

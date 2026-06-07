import { describe, it, expect } from 'vitest'
import { evaluateGoal, recentActuals } from '@/lib/scorecard/evaluate'

describe('evaluateGoal', () => {
  it('at_least: on when actual ≥ goal', () => {
    expect(evaluateGoal(10, 8, 'at_least')).toBe('on')
    expect(evaluateGoal(8, 8, 'at_least')).toBe('on')
    expect(evaluateGoal(5, 8, 'at_least')).toBe('off')
  })
  it('at_most: on when actual ≤ goal', () => {
    expect(evaluateGoal(3, 5, 'at_most')).toBe('on')
    expect(evaluateGoal(9, 5, 'at_most')).toBe('off')
  })
  it('unknown when actual or goal is missing/non-finite', () => {
    expect(evaluateGoal(null, 5, 'at_least')).toBe('unknown')
    expect(evaluateGoal(5, null, 'at_least')).toBe('unknown')
    expect(evaluateGoal(NaN, 5, 'at_least')).toBe('unknown')
  })
})

describe('recentActuals', () => {
  const rows = [
    { metric_key: 'cash', value: 100, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} },
    { metric_key: 'cash', value: 120, period_label: 'W2', period_start: '2026-01-08', source_id: 's1', dimension: {} },
    { metric_key: 'cash', value: 90, period_label: 'W3', period_start: '2026-01-15', source_id: 's1', dimension: {} },
    { metric_key: 'other', value: 5, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} },
  ]
  it('returns the metric_key series in period order, capped to n', () => {
    expect(recentActuals(rows, 'cash', 2)).toEqual([{ period: 'W2', value: 120 }, { period: 'W3', value: 90 }])
  })
  it('skips non-finite + other keys', () => {
    const out = recentActuals([...rows, { metric_key: 'cash', value: 'n/a', period_label: 'W4', period_start: '2026-01-22', source_id: 's1', dimension: {} }], 'cash')
    expect(out.map((p) => p.value)).toEqual([100, 120, 90]) // n/a dropped
  })
  it('keeps the dominant series when ONLY breakdowns exist (no axis merge)', () => {
    const multi = [
      { metric_key: 'k', value: 1, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: { a: 'X' } },
      { metric_key: 'k', value: 2, period_label: 'W2', period_start: '2026-01-08', source_id: 's1', dimension: { a: 'X' } },
      { metric_key: 'k', value: 99, period_label: 'W2', period_start: '2026-01-08', source_id: 's1', dimension: { a: 'Y' } },
    ]
    expect(recentActuals(multi, 'k').map((p) => p.value)).toEqual([1, 2]) // X series, not merged
  })

  it('sums TOTAL rows across sources into the org total per period', () => {
    const multiSource = [
      { metric_key: 'served', value: 100, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} },
      { metric_key: 'served', value: 50, period_label: 'W1', period_start: '2026-01-01', source_id: 's2', dimension: {} },
      { metric_key: 'served', value: 120, period_label: 'W2', period_start: '2026-01-08', source_id: 's1', dimension: {} },
      { metric_key: 'served', value: 60, period_label: 'W2', period_start: '2026-01-08', source_id: 's2', dimension: {} },
    ]
    expect(recentActuals(multiSource, 'served')).toEqual([{ period: 'W1', value: 150 }, { period: 'W2', value: 180 }])
  })

  it('prefers TOTAL rows over breakdowns (no double count)', () => {
    const mixed = [
      { metric_key: 'k', value: 200, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} },
      { metric_key: 'k', value: 80, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: { program: 'a' } },
      { metric_key: 'k', value: 120, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: { program: 'b' } },
    ]
    expect(recentActuals(mixed, 'k')).toEqual([{ period: 'W1', value: 200 }]) // total, not 200+80+120
  })

  it('de-dupes a re-imported total per (source, period) — last write wins, no double count', () => {
    const reimport = [
      { metric_key: 'k', value: 100, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} },
      { metric_key: 'k', value: 110, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} }, // correction
    ]
    expect(recentActuals(reimport, 'k')).toEqual([{ period: 'W1', value: 110 }])
  })

  it('groups dimensions regardless of JSON key order', () => {
    const rows = [
      { metric_key: 'k', value: 1, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: { a: 'X', b: 'Y' } },
      { metric_key: 'k', value: 2, period_label: 'W2', period_start: '2026-01-08', source_id: 's1', dimension: { b: 'Y', a: 'X' } },
    ]
    expect(recentActuals(rows, 'k').map((p) => p.value)).toEqual([1, 2]) // one series, not two singletons
  })

  it('returns [] for n=0 (no slice(-0) whole-array bug)', () => {
    const rows = [{ metric_key: 'k', value: 5, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} }]
    expect(recentActuals(rows, 'k', 0)).toEqual([])
  })

  it('returns [] for empty input or no matching key', () => {
    expect(recentActuals([], 'k')).toEqual([])
    expect(recentActuals([{ metric_key: 'other', value: 1, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} }], 'k')).toEqual([])
  })

  // The scorecard route now fetches rows DESC by period_start (so a row cap drops the
  // OLDEST, not the newest). recentActuals must be input-order-independent: it re-sorts
  // ascending internally and returns the most-recent N. This pins that contract so the
  // route's DESC change can't silently produce wrong/stale actuals.
  it('is input-order-independent — DESC-by-period_start input yields the newest N ascending', () => {
    const descRows = [
      { metric_key: 'cash', value: 90, period_label: 'W3', period_start: '2026-01-15', source_id: 's1', dimension: {} },
      { metric_key: 'cash', value: 120, period_label: 'W2', period_start: '2026-01-08', source_id: 's1', dimension: {} },
      { metric_key: 'cash', value: 100, period_label: 'W1', period_start: '2026-01-01', source_id: 's1', dimension: {} },
    ]
    expect(recentActuals(descRows, 'cash', 2)).toEqual([{ period: 'W2', value: 120 }, { period: 'W3', value: 90 }])
    // identical to the ascending-input result above → order truly doesn't matter
    expect(recentActuals(descRows, 'cash')).toEqual(recentActuals(rows, 'cash'))
  })
})

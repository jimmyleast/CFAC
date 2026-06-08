// EOS Scorecard goal evaluation. Pure + testable.

import { canonicalDimKey as dimKey } from '@/lib/metrics/dimension'

export type GoalDirection = 'at_least' | 'at_most'
export type GoalStatus = 'on' | 'off' | 'unknown'

/** Is the latest actual on or off track for the goal? */
export function evaluateGoal(actual: number | null | undefined, goal: number | null | undefined, direction: GoalDirection): GoalStatus {
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return 'unknown'
  if (goal === null || goal === undefined || !Number.isFinite(goal)) return 'unknown'
  return direction === 'at_most' ? (actual <= goal ? 'on' : 'off') : (actual >= goal ? 'on' : 'off')
}

export type ScorecardPoint = { period: string; value: number }

type Row = { metric_key: string; value: number | string | null; period_label: string | null; period_start: string | null; source_id?: string | null; dimension?: unknown }

/** Build the recent N points (ascending by period) for a metric_key from raw metric rows.
 *
 * Grain rules (a measurable drives the EOS on/off-track call, so the number must be the
 * org total — not one source's slice):
 *  - If the key has TOTAL rows (no dimension), the actual for a period is the SUM of those
 *    totals across every source (e.g. two intake systems each reporting clients served),
 *    de-duplicated per (source, period) so a re-import never double-counts.
 *  - If the key has ONLY dimension breakdowns, fall back to the single dominant
 *    (most-complete) source+dimension series so distinct breakdown axes aren't merged.
 */
export function recentActuals(rows: Row[], metricKey: string, n = 6): ScorecardPoint[] {
  const take = Math.max(0, Math.floor(n))
  if (take === 0) return []

  const totals: { ps: string; period: string; source: string; value: number }[] = []
  const breakdownGroups: Record<string, { ps: string; period: string; value: number }[]> = {}
  for (const r of rows) {
    if (r.metric_key !== metricKey || !r.period_start) continue
    const v = Number(r.value)
    if (!Number.isFinite(v)) continue
    const dim = dimKey(r.dimension)
    if (dim === '') {
      totals.push({ ps: r.period_start, period: r.period_label || '', source: r.source_id || '', value: v })
    } else {
      const id = `${r.source_id || ''}|${dim}`
      ;(breakdownGroups[id] ||= []).push({ ps: r.period_start, period: r.period_label || '', value: v })
    }
  }

  // Preferred path: org total = sum of per-source totals per period (re-import deduped).
  if (totals.length) {
    const perSourcePeriod = new Map<string, { ps: string; period: string; value: number }>()
    for (const t of totals) perSourcePeriod.set(`${t.source}|${t.ps}`, t) // last write wins per (source, period)
    const byPeriod = new Map<string, { ps: string; period: string; value: number }>()
    for (const t of perSourcePeriod.values()) {
      const cur = byPeriod.get(t.ps)
      if (cur) cur.value += t.value
      else byPeriod.set(t.ps, { ps: t.ps, period: t.period, value: t.value })
    }
    return Array.from(byPeriod.values()).sort((a, b) => a.ps.localeCompare(b.ps)).slice(-take).map((p) => ({ period: p.period, value: p.value }))
  }

  // Fallback: only breakdowns exist — keep the single most-complete series (don't merge axes).
  let best: { ps: string; period: string; value: number }[] = []
  for (const g of Object.values(breakdownGroups)) if (g.length > best.length) best = g
  return best.sort((a, b) => a.ps.localeCompare(b.ps)).slice(-take).map((p) => ({ period: p.period, value: p.value }))
}

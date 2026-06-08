// Single source of truth for hashing a metric row's `dimension` jsonb into a
// grouping key. Key-order-independent (sorted) so {a,b} and {b,a} collapse to the
// same series — used by BOTH the scorecard aggregation (lib/scorecard/evaluate.ts)
// and the integrity engine (lib/integrity/rules.ts) so they model "the same series"
// identically. Returns '' for a total row (empty/absent dimension).
export function canonicalDimKey(dimension: unknown): string {
  if (!dimension || typeof dimension !== 'object') return ''
  try {
    const entries = Object.entries(dimension as Record<string, unknown>)
    if (!entries.length) return ''
    return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)))
  } catch {
    return ''
  }
}

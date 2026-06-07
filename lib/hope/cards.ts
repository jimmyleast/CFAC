import type { SupabaseClient } from '@supabase/supabase-js'

// On-the-fly dashboard views. Hope (the LLM) only chooses WHICH metrics and the
// chart kind; the server fills every value from the metrics table, so a rendered
// view can never contain a fabricated number. Specs are schema-guarded: unknown
// or out-of-scope metric keys are dropped, and a view with no real data resolves
// to null (the dock then shows the prose answer alone).

export type ViewKind = 'tiles' | 'bars'

export type HopeViewSpec = {
  title: string
  kind: ViewKind
  metricKeys: string[]
}

export type ViewPoint = { period: string; value: number }

export type ViewTile = {
  key: string
  label: string
  value: number
  period: string
  priorValue: number | null
  priorPeriod: string | null
  deltaPct: number | null
  series: ViewPoint[]
}

export type HopeViewCard = {
  type: 'view'
  title: string
  kind: ViewKind
  tiles: ViewTile[]
}

const MAX_KEYS = 8
const VIEW_TAG = '[[VIEW]]'

/** Schema guard: coerce an untrusted object into a valid spec, or null. */
export function coerceViewSpec(obj: unknown): HopeViewSpec | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  const kind: ViewKind = o.kind === 'bars' ? 'bars' : 'tiles'
  const metricKeys = Array.isArray(o.metricKeys)
    ? o.metricKeys
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim())
        .slice(0, MAX_KEYS)
    : []
  if (!metricKeys.length) return null
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 80) : 'View'
  return { title, kind, metricKeys }
}

/** Extract an optional `[[VIEW]] {json}` block from generator output. */
export function parseViewSpec(raw: string): HopeViewSpec | null {
  const idx = raw.indexOf(VIEW_TAG)
  if (idx < 0) return null
  let tail = raw.slice(idx + VIEW_TAG.length)
  // Stop at any following directive line (e.g. [[FOLLOWUPS]]).
  const nextTag = tail.indexOf('[[')
  if (nextTag >= 0) tail = tail.slice(0, nextTag)
  const start = tail.indexOf('{')
  const end = tail.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return coerceViewSpec(JSON.parse(tail.slice(start, end + 1)))
  } catch {
    return null
  }
}

/** Remove the `[[VIEW]] …` block from answer text so raw JSON never shows in prose. */
export function stripViewLine(raw: string): string {
  const idx = raw.indexOf(VIEW_TAG)
  if (idx < 0) return raw
  const after = raw.slice(idx + VIEW_TAG.length)
  const nextTag = after.indexOf('[[')
  const rest = nextTag >= 0 ? after.slice(nextTag) : ''
  return (raw.slice(0, idx) + rest).trim()
}

/**
 * Resolve a spec into a grounded card by reading REAL values from the metrics
 * table. Keys are restricted to `allowedKeys` (the component-scoped catalog keys)
 * so a scoped session can't pull other metrics. Returns null if nothing resolves.
 */
export async function resolveViewCard(
  spec: HopeViewSpec,
  admin: SupabaseClient,
  allowedKeys: string[],
): Promise<HopeViewCard | null> {
  const allow = new Set(allowedKeys)
  const keys = spec.metricKeys.filter((k) => allow.has(k))
  if (!keys.length) return null

  const { data } = await admin
    .from('metrics')
    .select('metric_key, label, value, period_label, period_start, source_id, dimension')
    .in('metric_key', keys)
    .not('period_start', 'is', null)
    .order('period_start', { ascending: true })

  // Group by composite identity (key|source|dimension) so a metric broken down by
  // agency/source is never merged into one misleading series. For each metric_key
  // we then keep ONLY the dominant series (most data points) — never a concatenation.
  const groups: Record<string, { key: string; label: string; series: ViewPoint[] }> = {}
  for (const m of data || []) {
    const v = Number(m.value)
    if (!Number.isFinite(v)) continue
    let dim = ''
    try { dim = m.dimension && Object.keys(m.dimension).length ? JSON.stringify(m.dimension) : '' } catch { dim = '' }
    const id = `${m.metric_key}|${m.source_id || ''}|${dim}`
    ;(groups[id] ||= { key: m.metric_key, label: m.label || m.metric_key, series: [] }).series.push({
      period: m.period_label || '',
      value: v,
    })
  }

  const byKey: Record<string, { label: string; series: ViewPoint[] }> = {}
  for (const g of Object.values(groups)) {
    const cur = byKey[g.key]
    if (!cur || g.series.length > cur.series.length) byKey[g.key] = { label: g.label, series: g.series }
  }

  // Preserve the order Hope requested; drop keys with no data.
  const tiles: ViewTile[] = keys
    .filter((k) => byKey[k]?.series.length)
    .map((k) => {
      const g = byKey[k]
      const latest = g.series[g.series.length - 1]
      const prior = g.series.length > 1 ? g.series[g.series.length - 2] : null
      const deltaPct = prior && prior.value ? Math.round(((latest.value - prior.value) / prior.value) * 100) : null
      return {
        key: k,
        label: g.label,
        value: latest.value,
        period: latest.period,
        priorValue: prior?.value ?? null,
        priorPeriod: prior?.period ?? null,
        deltaPct,
        series: g.series,
      }
    })

  if (!tiles.length) return null
  // A "bars" view charts a single metric's trend — keep just the first tile.
  return { type: 'view', title: spec.title, kind: spec.kind, tiles: spec.kind === 'bars' ? tiles.slice(0, 1) : tiles }
}

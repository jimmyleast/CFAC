import { isRollupDimension } from '@/lib/dashboard/health-aggregation'

export const EXECUTIVE_TILE_ORDER: { key: string; label: string }[] = [
  { key: 'reach', label: 'Total Reach' },
  { key: 'children_served', label: 'Children Served' },
  { key: 'forensic_interviews', label: 'Forensic Interviews' },
  { key: 'medical_exams', label: 'Medical Exams' },
  { key: 'mental_health_sessions', label: 'Mental Health' },
  { key: 'education_people_trained', label: 'People Educated' },
  { key: 'tours', label: 'Tours' },
  { key: 'community_event_attendance', label: 'Community Event Attendance' },
  { key: 'volunteers', label: 'Volunteers' },
  { key: 'residential_women', label: 'Residential - Women' },
  { key: 'residential_children', label: 'Residential - Children' },
]

export type ExecutiveMetricRow = {
  metric_key: string
  value?: number | string | null
  period_label?: string | null
  period_start?: string | null
  dimension?: unknown
}

export function buildExecutiveSummary(rows: ExecutiveMetricRow[]) {
  const wanted = new Set(EXECUTIVE_TILE_ORDER.map((t) => t.key))
  const byKey = new Map<string, Map<string, { value: number; period: string }>>()

  for (const m of rows) {
    if (!wanted.has(m.metric_key) || !m.period_start || !isRollupDimension(m.dimension)) continue
    const value = Number(m.value)
    if (!Number.isFinite(value)) continue
    const periodStart = String(m.period_start)
    const periods = byKey.get(m.metric_key) || new Map<string, { value: number; period: string }>()
    const existing = periods.get(periodStart)
    periods.set(periodStart, { value: (existing?.value ?? 0) + value, period: m.period_label || existing?.period || periodStart })
    byKey.set(m.metric_key, periods)
  }

  const tiles = EXECUTIVE_TILE_ORDER.filter((t) => byKey.has(t.key)).map((t) => {
    const series = Array.from(byKey.get(t.key)!.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, point]) => point)
    const latest = series[series.length - 1]
    const prior = series.length > 1 ? series[series.length - 2] : null
    const deltaPct = prior && prior.value ? Math.round(((latest.value - prior.value) / prior.value) * 100) : null
    return {
      key: t.key,
      label: t.label,
      value: latest.value,
      period: latest.period,
      priorValue: prior?.value ?? null,
      priorPeriod: prior?.period ?? null,
      deltaPct,
      series: series.map((s) => ({ period: s.period, value: s.value })),
    }
  })

  let latestPeriod: string | null = null
  let latestStart: string | null = null
  for (const periods of byKey.values()) {
    for (const [start, point] of periods) {
      if (!latestStart || start > latestStart) {
        latestStart = start
        latestPeriod = point.period
      }
    }
  }

  return { latestPeriod, tiles }
}

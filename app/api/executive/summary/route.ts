import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'

export const dynamic = 'force-dynamic'

// Pulse-check tiles for the Executive dashboard, derived from the metrics table.
// For each metric_key: latest period value, prior period value, and % change.
const TILE_ORDER: { key: string; label: string }[] = [
  { key: 'reach', label: 'Total Reach' },
  { key: 'children_served', label: 'Children Served' },
  { key: 'forensic_interviews', label: 'Forensic Interviews' },
  { key: 'medical', label: 'Medical Exams' },
  { key: 'mental_health', label: 'Mental Health' },
  { key: 'education', label: 'People Educated' },
  { key: 'tours', label: 'Tours' },
  { key: 'community_events', label: 'Community Events' },
  { key: 'volunteers', label: 'Volunteers' },
  { key: 'res_women', label: 'Residential — Women' },
  { key: 'res_children', label: 'Residential — Children' },
]

export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('metrics')
    .select('metric_key, label, value, period_label, period_start')
    .order('period_start', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // group by metric_key → ordered series
  const byKey: Record<string, { value: number; period: string }[]> = {}
  for (const m of data || []) {
    if (m.value === null || m.value === undefined) continue
    ;(byKey[m.metric_key] ||= []).push({ value: Number(m.value), period: m.period_label || '' })
  }

  const tiles = TILE_ORDER.filter(t => byKey[t.key]?.length).map(t => {
    const series = byKey[t.key]
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
      series: series.map(s => ({ period: s.period, value: s.value })),
    }
  })

  const latestPeriod = tiles.length ? tiles[0].period : null
  return NextResponse.json({ latestPeriod, tiles, generatedAt: new Date().toISOString() })
}

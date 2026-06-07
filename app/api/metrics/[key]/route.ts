import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { dominantSeriesByKey, seriesToTile, type MetricRow } from '@/lib/metrics/tiles'

export const dynamic = 'force-dynamic'

// Drill-down for one source metric_key: its series, latest/prior/delta, the
// sources feeding it, and which impact definitions it rolls up into. Aggregate.
export async function GET(req: Request, { params }: { params: { key: string } }) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const key = String(params.key || '').trim()
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })

  const admin = getAdminClient()
  const [metricsRes, srcRes, mapRes, defRes] = await Promise.all([
    admin.from('metrics').select('metric_key, label, value, period_label, period_start, source_id, dimension')
      .eq('metric_key', key).not('period_start', 'is', null).order('period_start', { ascending: true }).limit(5000),
    admin.from('data_sources').select('id, name'),
    admin.from('metric_mappings').select('definition_key, source_metric_key, status').eq('source_metric_key', key).eq('status', 'active'),
    admin.from('metric_definitions').select('key, display_name, definition').eq('key', key).maybeSingle(),
  ])
  if (metricsRes.error) return NextResponse.json({ error: metricsRes.error.message }, { status: 500 })

  const rows = (metricsRes.data || []) as MetricRow[]
  const byKey = dominantSeriesByKey(rows)
  const series = byKey[key]
  if (!series) return NextResponse.json({ key, found: false }, { status: 404 })

  const tile = seriesToTile(series)
  const nameById = new Map((srcRes.data || []).map((s) => [s.id, s.name]))
  const sources = Array.from(new Set(rows.map((r) => r.source_id).filter(Boolean))).map((id) => nameById.get(id as string) || '—')
  const feedsInto = Array.from(new Set((mapRes.data || []).map((m) => m.definition_key)))

  return NextResponse.json({
    key, found: true, label: series.label,
    value: tile.value, period: tile.period, priorValue: tile.priorValue, priorPeriod: tile.priorPeriod, deltaPct: tile.deltaPct,
    series: series.series,
    sources, feedsInto,
    definition: defRes.data || null,
  })
}

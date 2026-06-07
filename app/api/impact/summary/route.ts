import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { dominantSeriesByKey, type MetricRow } from '@/lib/metrics/tiles'
import { computeImpact, type DefinitionLite, type Mapping } from '@/lib/metrics/impact'

export const dynamic = 'force-dynamic'

// The three impact metrics (Reach / Clients Served / Services Provided), COMPUTED
// from editable Metric Mappings over aggregate source metrics — never hardcoded.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const [defsRes, mapRes, metricsRes] = await Promise.all([
    admin.from('metric_definitions').select('key, display_name, definition, category, is_dedup_rule').eq('category', 'impact'),
    admin.from('metric_mappings').select('definition_key, source_metric_key, agg, status').eq('status', 'active'),
    admin.from('metrics').select('metric_key, label, value, period_label, period_start, source_id, dimension')
      .not('period_start', 'is', null).order('period_start', { ascending: true }).limit(5000),
  ])
  if (defsRes.error) return NextResponse.json({ error: defsRes.error.message }, { status: 500 })
  if (mapRes.error) return NextResponse.json({ error: mapRes.error.message }, { status: 500 })
  if (metricsRes.error) return NextResponse.json({ error: metricsRes.error.message }, { status: 500 })

  const byKey = dominantSeriesByKey((metricsRes.data || []) as MetricRow[])
  const impact = computeImpact(
    (defsRes.data || []) as DefinitionLite[],
    (mapRes.data || []) as Mapping[],
    byKey,
  )
  // Surface broken/missing lineage so a blank headline tile is monitorable, not silent.
  const unmappedKeys = impact.filter((m) => !m.mapped || m.value === null).map((m) => m.key)
  return NextResponse.json({ impact, unmappedCount: unmappedKeys.length, unmappedKeys })
}

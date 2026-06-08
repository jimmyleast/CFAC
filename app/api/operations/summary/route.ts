import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { buildOperationsSummary, OPERATIONS_METRIC_KEYS, type OpsMetricRow } from '@/lib/operations/summary'

export const dynamic = 'force-dynamic'

// Aggregate operations summary for facilities/fleet. Reads the metrics layer only:
// no raw import rows, no names, no emails, no locations, no narratives.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const { data, error } = await getAdminClient()
    .from('metrics')
    .select('metric_key, label, value, period_label, period_start, dimension')
    .in('metric_key', [...OPERATIONS_METRIC_KEYS])
    .not('period_start', 'is', null)
    .order('period_start', { ascending: true })
    .limit(5000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(buildOperationsSummary((data || []) as OpsMetricRow[]))
}

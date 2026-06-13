import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { buildExecutiveSummary, type ExecutiveMetricRow } from '@/lib/metrics/executive'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('metrics')
    .select('metric_key, value, period_label, period_start, dimension')
    .order('period_start', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ...buildExecutiveSummary((data || []) as ExecutiveMetricRow[]), generatedAt: new Date().toISOString() })
}

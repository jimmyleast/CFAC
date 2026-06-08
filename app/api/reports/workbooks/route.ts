import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { groupWorkbookReports, type WorkbookMetricRow } from '@/lib/reports/workbookTabs'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const { data, error } = await getAdminClient()
    .from('metrics')
    .select('metric_key, label, value, unit, period_label, period_start, dimension, data_sources(name, slug)')
    .order('period_start', { ascending: true })
    .limit(10_000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const reports = groupWorkbookReports((data || []) as WorkbookMetricRow[])
  return NextResponse.json({ reports })
}

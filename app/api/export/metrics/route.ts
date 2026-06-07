import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { toCsv } from '@/lib/export/csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Export the aggregate metrics layer as CSV (source, metric, period, value).
// Aggregate data only — no PHI. MFA-gated.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('metrics')
    .select('metric_key, label, value, unit, period_label, period_start, data_sources(name)')
    .not('period_start', 'is', null)
    .order('metric_key', { ascending: true })
    .order('period_start', { ascending: true })
    .limit(50000)
  if (error) {
    void emitAppEvent({ eventName: 'export.failed', category: 'error', userId: auth.user.id, route: '/api/export/metrics', status: 'error', metadata: { kind: 'metrics_csv', error: error.message.slice(0, 200) } }).catch(() => {})
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data || []).map((m) => ({
    source: (m as { data_sources?: { name?: string } }).data_sources?.name || '',
    metric_key: m.metric_key,
    label: m.label || '',
    period: m.period_label || '',
    value: m.value,
    unit: m.unit || '',
  }))
  const csv = toCsv(rows, [
    { key: 'source', header: 'Source' },
    { key: 'metric_key', header: 'Metric Key' },
    { key: 'label', header: 'Label' },
    { key: 'period', header: 'Period' },
    { key: 'value', header: 'Value' },
    { key: 'unit', header: 'Unit' },
  ])

  void emitAppEvent({ eventName: 'export.completed', category: 'system', userId: auth.user.id, route: '/api/export/metrics', status: 'ok', metadata: { rows: rows.length, kind: 'metrics_csv' } }).catch(() => {})

  const date = new Date().toISOString().slice(0, 10)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cfac-metrics-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

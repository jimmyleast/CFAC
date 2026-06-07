import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { detectExceptions, summarize, type ExMetricRow, type ExSource, type ExDefinition, type ExMapping } from '@/lib/integrity/rules'

export const dynamic = 'force-dynamic'

const SCAN_LIMIT = 10000

// Exception engine: validates the aggregate data layer live and returns flagged
// issues (duplicate / missing / inconsistent / stale / unmapped / outlier), so
// staff stop combing 12 spreadsheets for bad data. Aggregate metadata only.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const [metricsRes, countRes, sourcesRes, defsRes, mapsRes] = await Promise.all([
    // Note: NOT filtering null period/value — the engine needs to see the gaps.
    admin.from('metrics').select('source_id, metric_key, label, value, period_label, period_start, dimension').limit(SCAN_LIMIT),
    admin.from('metrics').select('id', { count: 'exact', head: true }),
    admin.from('data_sources').select('id, name, last_imported_at'),
    admin.from('metric_definitions').select('key, category'),
    admin.from('metric_mappings').select('definition_key, status'),
  ])
  const firstErr = metricsRes.error || sourcesRes.error || defsRes.error || mapsRes.error
  if (firstErr) return NextResponse.json({ error: firstErr.message }, { status: 500 })

  const exceptions = detectExceptions({
    metrics: (metricsRes.data || []) as ExMetricRow[],
    sources: (sourcesRes.data || []) as ExSource[],
    definitions: (defsRes.data || []) as ExDefinition[],
    mappings: (mapsRes.data || []) as ExMapping[],
    nowMs: Date.now(),
  })
  const summary = summarize(exceptions)
  // The Quality principle is "surface gaps, never hide them" — a partial scan that
  // looks clean would do exactly that, so make truncation explicit + alertable.
  const totalRows = typeof countRes.count === 'number' ? countRes.count : (metricsRes.data?.length ?? 0)
  const scanIncomplete = totalRows > SCAN_LIMIT
  const payload = { summary: { ...summary, scanIncomplete, scannedRows: metricsRes.data?.length ?? 0, totalRows }, exceptions }

  void emitAppEvent({
    eventName: 'data.exceptions.scanned', category: 'quality', userId: auth.user.id, route: '/api/data/exceptions',
    status: scanIncomplete ? 'truncated' : 'ok',
    metadata: { errors: summary.errors, warnings: summary.warnings, byRule: summary.byRule, scanIncomplete },
  }).catch(() => {})

  return NextResponse.json(payload)
}

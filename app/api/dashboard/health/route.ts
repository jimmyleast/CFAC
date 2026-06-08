import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { ORG_HEALTH_SPEC, resolveHealthSections, aggregateModeByKey } from '@/lib/dashboard/org-health-spec'

export const dynamic = 'force-dynamic'

// Org Health Snapshot (the org's "CFAC DASHBOARD" spec). Resolves each spec tile to
// the latest value of its metric_key, or leaves it as an honest "awaiting <source>".
// Aggregate-only (counts/totals); never reads case-level rows.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const keys = Array.from(new Set(ORG_HEALTH_SPEC.flatMap((s) => s.tiles.map((t) => t.metricKey).filter(Boolean) as string[])))
  const latestByKey = new Map<string, { value: number; period: string | null }>()

  if (keys.length) {
    // Sum totals (dimension-empty) across sources per period, then keep the latest period.
    const { data, error } = await getAdminClient()
      .from('metrics')
      .select('metric_key, value, period_label, period_start, dimension')
      .in('metric_key', keys)
      .not('period_start', 'is', null)
      .order('period_start', { ascending: true })
      .limit(5000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // For each key, find the latest period_start; sum dimension-empty source rows in it.
    const latestPeriodByKey = new Map<string, string>()
    for (const r of (data || [])) {
      const dimEmpty = !r.dimension || (typeof r.dimension === 'object' && Object.keys(r.dimension as object).length === 0)
      if (!dimEmpty || r.period_start == null) continue
      const cur = latestPeriodByKey.get(r.metric_key)
      if (!cur || String(r.period_start) > cur) latestPeriodByKey.set(r.metric_key, String(r.period_start))
    }
    const aggMode = aggregateModeByKey()
    const acc = new Map<string, { value: number; period: string | null }>()
    for (const r of (data || [])) {
      const dimEmpty = !r.dimension || (typeof r.dimension === 'object' && Object.keys(r.dimension as object).length === 0)
      if (!dimEmpty) continue
      if (String(r.period_start) !== latestPeriodByKey.get(r.metric_key)) continue
      const v = Number(r.value)
      if (!Number.isFinite(v)) continue
      const prev = acc.get(r.metric_key)
      // 'last' (rates/%) takes a single value, never a cross-source sum.
      const value = aggMode.get(r.metric_key) === 'last' ? v : (prev?.value ?? 0) + v
      acc.set(r.metric_key, { value, period: r.period_label ?? prev?.period ?? null })
    }
    for (const [k, v] of acc) latestByKey.set(k, v)
  }

  const sections = resolveHealthSections(ORG_HEALTH_SPEC, latestByKey)
  const liveCount = sections.reduce((n, s) => n + s.tiles.filter((t) => t.state === 'live').length, 0)
  const totalCount = sections.reduce((n, s) => n + s.tiles.length, 0)
  return NextResponse.json({ sections, liveCount, totalCount })
}

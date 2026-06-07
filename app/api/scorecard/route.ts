import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa, requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { evaluateGoal, recentActuals, type GoalDirection } from '@/lib/scorecard/evaluate'

export const dynamic = 'force-dynamic'

const DIRECTIONS = new Set(['at_least', 'at_most'])

// EOS Scorecard. GET = measurables + their recent actuals (from the metrics layer
// when linked) + on/off-track status (staff, MFA). POST/PATCH/DELETE = admin.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const { data: defs, error } = await admin.from('scorecard_metrics')
    .select('id, name, owner, goal_value, goal_direction, unit, metric_key, component_id, sort_order, active, components(name)')
    .eq('active', true).order('sort_order')
  if (error) {
    await emitAppEvent({ eventName: 'scorecard.changed', category: 'error', userId: auth.user.id, route: '/api/scorecard', status: 'read_failed', metadata: { error: error.message.slice(0, 200) } }).catch(() => {})
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const keys = Array.from(new Set((defs || []).map((d) => d.metric_key).filter(Boolean) as string[]))
  let rows: { metric_key: string; value: number | string | null; period_label: string | null; period_start: string | null; source_id: string | null; dimension: unknown }[] = []
  if (keys.length) {
    const { data } = await admin.from('metrics')
      .select('metric_key, value, period_label, period_start, source_id, dimension')
      .in('metric_key', keys).not('period_start', 'is', null).order('period_start', { ascending: true }).limit(5000)
    rows = (data || []) as typeof rows
  }

  const measurables = (defs || []).map((d) => {
    const points = d.metric_key ? recentActuals(rows, d.metric_key) : []
    const latest = points.length ? points[points.length - 1].value : null
    return {
      id: d.id, name: d.name, owner: d.owner, goal: d.goal_value, goalDirection: d.goal_direction, unit: d.unit,
      metricKey: d.metric_key, component: (d as { components?: { name?: string } }).components?.name || null,
      points, latest,
      status: evaluateGoal(latest, d.goal_value, d.goal_direction as GoalDirection),
    }
  })
  return NextResponse.json({ measurables })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  const body = await req.json().catch(() => ({})) as { name?: string; owner?: string; goalValue?: number; goalDirection?: string; unit?: string; metricKey?: string; componentSlug?: string }
  const name = String(body.name || '').trim().slice(0, 120)
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const admin = getAdminClient()
  let componentId: string | null = null
  if (body.componentSlug) {
    const { data: comp } = await admin.from('components').select('id').eq('slug', String(body.componentSlug)).maybeSingle()
    componentId = comp?.id ?? null
  }
  const { error } = await admin.from('scorecard_metrics').insert({
    name,
    owner: String(body.owner || '').slice(0, 120) || null,
    goal_value: typeof body.goalValue === 'number' && Number.isFinite(body.goalValue) ? body.goalValue : null,
    goal_direction: DIRECTIONS.has(String(body.goalDirection)) ? String(body.goalDirection) : 'at_least',
    unit: String(body.unit || 'count').slice(0, 20),
    metric_key: String(body.metricKey || '').trim().slice(0, 80) || null,
    component_id: componentId,
  })
  if (error) {
    await emitAppEvent({ eventName: 'scorecard.changed', category: 'error', userId: gate.user.id, route: '/api/scorecard', status: 'create_failed', metadata: { error: error.message.slice(0, 200) } }).catch(() => {})
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  await emitAppEvent({ eventName: 'scorecard.changed', category: 'system', userId: gate.user.id, route: '/api/scorecard', status: 'created', metadata: {} }).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // Soft-delete (deactivate) so history is preserved.
  const { data, error } = await getAdminClient().from('scorecard_metrics').update({ active: false, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle()
  if (error) {
    await emitAppEvent({ eventName: 'scorecard.changed', category: 'error', userId: gate.user.id, route: '/api/scorecard', status: 'remove_failed', metadata: { error: error.message.slice(0, 200) } }).catch(() => {})
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await emitAppEvent({ eventName: 'scorecard.changed', category: 'system', userId: gate.user.id, route: '/api/scorecard', status: 'removed', metadata: {} }).catch(() => {})
  return NextResponse.json({ ok: true })
}

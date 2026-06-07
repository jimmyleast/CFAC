import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { emitAppEvent } from '@/lib/telemetry/events'

export const dynamic = 'force-dynamic'

const AGGS = new Set(['latest', 'sum', 'count', 'avg'])

// Metric Mapping: declares which source metric_key(s) feed each definition.
// GET = definitions + their mappings + available source keys (staff, MFA).
// POST/DELETE = admin add/remove a mapping (lineage is a governance action).
export async function GET(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })

  const admin = getAdminClient()
  const [defs, maps, metrics] = await Promise.all([
    admin.from('metric_definitions').select('key, display_name, category, parent_key, is_dedup_rule, sort_order').order('sort_order'),
    admin.from('metric_mappings').select('id, definition_key, source_metric_key, agg, status, note').order('definition_key'),
    admin.from('metrics').select('metric_key').limit(5000),
  ])
  if (defs.error) return NextResponse.json({ error: defs.error.message }, { status: 500 })
  if (maps.error) return NextResponse.json({ error: maps.error.message }, { status: 500 })

  const availableKeys = Array.from(new Set((metrics.data || []).map((m) => m.metric_key))).sort()
  return NextResponse.json({ definitions: defs.data || [], mappings: maps.data || [], availableKeys })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { definition_key?: string; source_metric_key?: string; agg?: string }
  const definition_key = String(body.definition_key || '').trim()
  const source_metric_key = String(body.source_metric_key || '').trim()
  const agg = body.agg === undefined ? 'latest' : String(body.agg)
  if (!definition_key || !source_metric_key) return NextResponse.json({ error: 'definition_key and source_metric_key required' }, { status: 400 })
  if (!AGGS.has(agg)) return NextResponse.json({ error: `invalid agg (allowed: ${[...AGGS].join(', ')})` }, { status: 400 })

  const admin = getAdminClient()
  // Both keys must reference real rows (no dangling lineage).
  const [defOk, keyOk] = await Promise.all([
    admin.from('metric_definitions').select('key').eq('key', definition_key).maybeSingle(),
    admin.from('metrics').select('metric_key').eq('metric_key', source_metric_key).limit(1).maybeSingle(),
  ])
  if (!defOk.data) return NextResponse.json({ error: 'unknown definition_key' }, { status: 400 })
  if (!keyOk.data) return NextResponse.json({ error: 'unknown source_metric_key' }, { status: 400 })

  const { error } = await admin.from('metric_mappings')
    .upsert({ definition_key, source_metric_key, agg, status: 'active' }, { onConflict: 'definition_key,source_metric_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await emitAppEvent({ eventName: 'mapping.changed', category: 'system', userId: gate.user.id, route: '/api/mappings', status: 'added', metadata: { definition_key, source_metric_key, agg } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { definition_key?: string; source_metric_key?: string }
  const definition_key = String(body.definition_key || '').trim()
  const source_metric_key = String(body.source_metric_key || '').trim()
  if (!definition_key || !source_metric_key) return NextResponse.json({ error: 'definition_key and source_metric_key required' }, { status: 400 })

  const { error } = await getAdminClient().from('metric_mappings')
    .delete().eq('definition_key', definition_key).eq('source_metric_key', source_metric_key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await emitAppEvent({ eventName: 'mapping.changed', category: 'system', userId: gate.user.id, route: '/api/mappings', status: 'removed', metadata: { definition_key, source_metric_key } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

async function requireAdmin(req: Request): Promise<{ user: { id: string } } | { response: Response }> {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (mfaRequired) return { response: NextResponse.json({ error: 'mfa_required' }, { status: 403 }) }
  if (!(await checkIsAdmin(user.id, user.email || ''))) return { response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  return { user }
}

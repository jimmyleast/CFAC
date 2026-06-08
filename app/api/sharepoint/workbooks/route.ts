import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { getSourceProfile } from '@/lib/data/sourceProfiles'
import { emitAppEvent } from '@/lib/telemetry/events'

export const dynamic = 'force-dynamic'

type Body = {
  id?: string
  sourceSlug?: string
  profileKey?: string
  displayName?: string
  driveId?: string
  itemId?: string
  worksheetName?: string
  rangeAddress?: string
  tableName?: string
  enabled?: boolean
}

const clean = (v: unknown, max = 300) => String(v || '').trim().slice(0, max)
const uuidish = (v: unknown) => clean(v, 80)

export async function GET(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const { data, error } = await getAdminClient()
    .from('connected_workbooks')
    .select('id, provider, display_name, source_profile_key, drive_id, item_id, worksheet_name, range_address, table_name, enabled, last_sync_at, last_error, data_sources(name, slug)')
    .eq('provider', 'microsoft_sharepoint')
    .order('display_name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ workbooks: data || [] })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as Body
  const sourceSlug = clean(body.sourceSlug, 120)
  const profileKey = clean(body.profileKey, 120)
  const displayName = clean(body.displayName, 160)
  const driveId = clean(body.driveId)
  const itemId = clean(body.itemId)
  const worksheetName = clean(body.worksheetName, 120) || null
  const rangeAddress = clean(body.rangeAddress, 80) || null
  const tableName = clean(body.tableName, 120) || null

  if (!sourceSlug) return NextResponse.json({ error: 'sourceSlug required' }, { status: 400 })
  if (!getSourceProfile(profileKey)) return NextResponse.json({ error: 'known profileKey required' }, { status: 400 })
  if (!displayName || !driveId || !itemId) return NextResponse.json({ error: 'displayName, driveId, and itemId required' }, { status: 400 })
  if (!tableName && (!worksheetName || !rangeAddress)) return NextResponse.json({ error: 'tableName or worksheetName + rangeAddress required' }, { status: 400 })

  const admin = getAdminClient()
  const { data: source, error: srcErr } = await admin.from('data_sources').select('id').eq('slug', sourceSlug).maybeSingle()
  if (srcErr) return NextResponse.json({ error: srcErr.message }, { status: 500 })
  if (!source) return NextResponse.json({ error: `Unknown source: ${sourceSlug}` }, { status: 404 })

  const { data, error } = await admin.from('connected_workbooks').insert({
    provider: 'microsoft_sharepoint',
    source_id: source.id,
    source_profile_key: profileKey,
    display_name: displayName,
    drive_id: driveId,
    item_id: itemId,
    worksheet_name: tableName ? null : worksheetName,
    range_address: tableName ? null : rangeAddress,
    table_name: tableName,
    created_by: gate.user.id,
  }).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await emitAppEvent({
    eventName: 'sharepoint.workbook.registered',
    category: 'system',
    userId: gate.user.id,
    route: '/api/sharepoint/workbooks',
    status: 'ok',
    metadata: { sourceSlug, profileKey, workbookId: data?.id },
  }).catch(() => {})
  return NextResponse.json({ ok: true, id: data?.id })
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as Body
  const id = uuidish(body.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled boolean required' }, { status: 400 })

  const update: { enabled: boolean; last_error?: null } = { enabled: body.enabled }
  if (body.enabled) update.last_error = null
  const { data, error } = await getAdminClient()
    .from('connected_workbooks')
    .update(update)
    .eq('provider', 'microsoft_sharepoint')
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'workbook binding not found' }, { status: 404 })

  await emitAppEvent({
    eventName: 'sharepoint.workbook.updated',
    category: 'system',
    userId: gate.user.id,
    route: '/api/sharepoint/workbooks',
    status: 'ok',
    metadata: { workbookId: id, enabled: body.enabled },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const id = uuidish(new URL(req.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await getAdminClient()
    .from('connected_workbooks')
    .delete()
    .eq('provider', 'microsoft_sharepoint')
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'workbook binding not found' }, { status: 404 })

  await emitAppEvent({
    eventName: 'sharepoint.workbook.deleted',
    category: 'system',
    userId: gate.user.id,
    route: '/api/sharepoint/workbooks',
    status: 'ok',
    metadata: { workbookId: id },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}

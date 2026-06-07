import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa, requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'

export const dynamic = 'force-dynamic'

const TYPES = new Set(['law_enforcement', 'dhs', 'prosecution', 'cac', 'medical', 'mental_health', 'other'])

// MDT partner agencies (law enforcement, DHS, prosecution, …). Reference data,
// not client PHI. GET = list (staff, MFA). POST/PATCH = manage (admin).
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response
  const { data, error } = await getAdminClient().from('agencies').select('id, name, type, active').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ agencies: data || [] })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { name?: string; type?: string }
  const name = String(body.name || '').trim().slice(0, 120)
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  const type = TYPES.has(String(body.type)) ? String(body.type) : 'other'

  const admin = getAdminClient()
  const { data: existing } = await admin.from('agencies').select('id').eq('name', name).maybeSingle()
  if (existing) return NextResponse.json({ error: 'an agency with that name already exists' }, { status: 409 })

  const { error } = await admin.from('agencies').insert({ name, type })
  if (error) {
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'an agency with that name already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  await emitAppEvent({ eventName: 'agency.changed', category: 'system', userId: gate.user.id, route: '/api/agencies', status: 'created', metadata: { type } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { id?: string; active?: boolean; type?: string }
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.active === 'boolean') patch.active = body.active
  if (body.type !== undefined && TYPES.has(String(body.type))) patch.type = String(body.type)
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await getAdminClient().from('agencies').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await emitAppEvent({ eventName: 'agency.changed', category: 'system', userId: gate.user.id, route: '/api/agencies', status: 'updated', metadata: {} }).catch(() => {})
  return NextResponse.json({ ok: true })
}

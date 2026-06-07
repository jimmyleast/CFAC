import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestAuth } from '@/lib/auth/requestUser'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  if (!(await checkIsAdmin(user.id, user.email || ''))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('user_profiles')
    .select('id, email, display_name, title, phone, is_admin, active, created_at')
    .order('display_name', { nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data || [] })
}

export async function PATCH(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  if (!(await checkIsAdmin(user.id, user.email || ''))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const targetId = String(body.id || '')
  if (!targetId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.is_admin === 'boolean') patch.is_admin = body.is_admin
  if (typeof body.active === 'boolean') patch.active = body.active
  if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim()
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // Prevent self-lockout: an admin can't remove their own admin/active status.
  if (targetId === user.id && (patch.active === false || patch.is_admin === false)) {
    return NextResponse.json({ error: 'You cannot remove your own admin/active status.' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { error } = await admin.from('user_profiles').update(patch).eq('id', targetId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

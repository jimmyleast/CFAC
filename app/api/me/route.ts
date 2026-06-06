import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'

export async function GET(request: Request) {
  const user = await getRequestUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const is_admin = await checkIsAdmin(user.id, user.email || '')
  const adminClient = getAdminClient()
  const { data: profile } = await adminClient
    .from('user_profiles').select('display_name, phone').eq('id', user.id).single()

  return NextResponse.json({
    id: user.id,
    email: user.email,
    display_name: profile?.display_name || null,
    phone: profile?.phone || null,
    is_admin,
  })
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const update: Record<string, string> = {}
  if (typeof body.display_name === 'string') update.display_name = body.display_name.trim()
  if (typeof body.phone === 'string') update.phone = body.phone.trim()

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const adminClient = getAdminClient()
  const { error } = await adminClient
    .from('user_profiles')
    .update(update)
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = getAdminClient()
  const { data, error } = await adminClient
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const unread = (data || []).filter(n => !n.read).length
  return NextResponse.json({ notifications: data || [], unread })
}

export async function PATCH(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids, markAllRead } = await req.json()
  const adminClient = getAdminClient()

  if (markAllRead) {
    await adminClient.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
  } else if (ids?.length) {
    await adminClient.from('notifications').update({ read: true }).in('id', ids).eq('user_id', user.id)
  }

  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { getAdminClient, getUserSquadIds, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'

const VALID_STATUSES = ['not_started', 'evaluating', 'in_progress', 'live', 'deferred']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getRequestUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const { status } = body

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }

  const adminClient = getAdminClient()
  const admin = await checkIsAdmin(user.id, user.email || '')

  // Check system exists and user has access
  const { data: sys } = await adminClient
    .from('process_systems')
    .select('id, squad_id')
    .eq('id', id)
    .single()

  if (!sys) return NextResponse.json({ error: 'System not found' }, { status: 404 })

  if (!admin && sys.squad_id) {
    const squadIds = await getUserSquadIds(user.id)
    if (!squadIds.includes(sys.squad_id)) {
      return NextResponse.json({ error: 'Not a member of this squad' }, { status: 403 })
    }
  }

  const update: Record<string, any> = { updated_at: new Date().toISOString() }
  if (status) update.status = status

  const { data, error } = await adminClient
    .from('process_systems')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

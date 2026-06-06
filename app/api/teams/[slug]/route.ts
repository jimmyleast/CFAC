import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await params
  const adminClient = getAdminClient()

  const { data: team, error } = await adminClient
    .from('teams')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error || !team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const { data: members } = await adminClient
    .from('team_members')
    .select('id, role, added_at, user_profiles(id, display_name, email, phone, title, active)')
    .eq('team_id', team.id)
    .order('role')

  const { data: lead } = team.lead_user_id
    ? await adminClient.from('user_profiles').select('id, display_name, email').eq('id', team.lead_user_id).single()
    : { data: null }

  return NextResponse.json({ ...team, lead, members: members || [] })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [admin, teamCtx] = await Promise.all([
    checkIsAdmin(user.id, user.email || ''),
    getUserTeamContext(user.id),
  ])
  if (!admin && !teamCtx.canSeeAll) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const { slug } = await params
  const body = await req.json()
  const adminClient = getAdminClient()

  const update: Record<string, any> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.description !== undefined) update.description = body.description
  if (body.programs !== undefined) update.programs = body.programs
  if (body.color !== undefined) update.color = body.color
  if (body.icon !== undefined) update.icon = body.icon
  if (body.lead_user_id !== undefined) update.lead_user_id = body.lead_user_id
  if (body.parent_team_id !== undefined) update.parent_team_id = body.parent_team_id

  const { data, error } = await adminClient
    .from('teams')
    .update(update)
    .eq('slug', slug)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

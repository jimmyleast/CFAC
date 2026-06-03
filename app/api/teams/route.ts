import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export async function GET(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = getAdminClient()

  const { data: teams, error } = await adminClient
    .from('teams')
    .select(`
      *,
      team_members(count)
    `)
    .eq('active', true)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(teams)
}

export async function POST(req: Request) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [admin, teamCtx] = await Promise.all([
    checkIsAdmin(user.id, user.email || ''),
    getUserTeamContext(user.id),
  ])
  if (!admin && !teamCtx.canSeeAll) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const body = await req.json()
  const { name, slug, description, programs, color, icon, parent_team_id } = body

  if (!name || !slug) return NextResponse.json({ error: 'name and slug required' }, { status: 400 })

  const adminClient = getAdminClient()
  const { data, error } = await adminClient
    .from('teams')
    .insert({ name, slug, description, programs: programs || [], color, icon, parent_team_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

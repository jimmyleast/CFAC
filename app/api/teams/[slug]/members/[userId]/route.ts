import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string; userId: string }> },
) {
  const user = await getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [admin, teamCtx] = await Promise.all([
    checkIsAdmin(user.id, user.email || ''),
    getUserTeamContext(user.id),
  ])
  if (!admin && !teamCtx.canSeeAll) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const { slug, userId } = await params
  const adminClient = getAdminClient()

  const { data: team } = await adminClient
    .from('teams').select('id').eq('slug', slug).single()
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const { error } = await adminClient
    .from('team_members')
    .delete()
    .eq('team_id', team.id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

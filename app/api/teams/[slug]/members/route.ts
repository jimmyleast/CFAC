import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export async function POST(
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
  const { email, role } = await req.json()

  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const adminClient = getAdminClient()

  // Find team
  const { data: team } = await adminClient
    .from('teams').select('id').eq('slug', slug).single()
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // Find user by email
  const { data: profile } = await adminClient
    .from('user_profiles').select('id').eq('email', email.toLowerCase()).single()
  if (!profile) {
    return NextResponse.json({ error: `No user found with email ${email}. Invite them first.` }, { status: 404 })
  }

  // Upsert membership
  const { data, error } = await adminClient
    .from('team_members')
    .upsert(
      { team_id: team.id, user_id: profile.id, role: role || 'member', added_by: user.id },
      { onConflict: 'team_id,user_id' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If role is 'lead', also set as team lead
  if (role === 'lead') {
    await adminClient.from('teams').update({ lead_user_id: profile.id }).eq('id', team.id)
  }

  return NextResponse.json(data, { status: 201 })
}

import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'
import { getRequestUser } from '@/lib/auth/requestUser'
import { getUserTeamContext } from '@/lib/team-context'

export async function GET(request: Request) {
  const user = await getRequestUser(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [is_admin, teamCtx] = await Promise.all([
    checkIsAdmin(user.id, user.email || ''),
    getUserTeamContext(user.id),
  ])
  const adminClient = getAdminClient()

  const [{ data: profile }, { data: roleRecord }, { data: squadData }] = await Promise.all([
    adminClient.from('user_profiles').select('display_name, phone').eq('id', user.id).single(),
    adminClient.from('user_roles').select('display_name').eq('email', (user.email || '').toLowerCase()).single(),
    adminClient.from('squad_members').select('role, squads(id, name, color, area)').eq('user_id', user.id),
  ])

  return NextResponse.json({
    id: user.id,
    email: user.email,
    display_name: roleRecord?.display_name || profile?.display_name || null,
    phone: profile?.phone || null,
    is_admin,
    can_see_all: is_admin || teamCtx.canSeeAll,
    teams: teamCtx.teams.map(t => ({ slug: t.teamSlug, name: t.teamName })),
    squads: (squadData || []).map((m: any) => ({ ...m.squads, my_role: m.role })),
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

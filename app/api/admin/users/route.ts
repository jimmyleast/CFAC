import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkIsAdmin, getAdminClient } from '@/lib/admin'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const adminClient = getAdminClient()

  // Get all auth users
  const { data: authData, error: authError } = await adminClient.auth.admin.listUsers()
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  // Get all profiles
  const { data: profiles } = await adminClient.from('user_profiles').select('*')
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))

  // Get squad memberships for all users
  const { data: members } = await adminClient
    .from('squad_members')
    .select('user_id, squad_id, role, squads(id, name, color, area)')

  const membersByUser = new Map<string, any[]>()
  for (const m of members || []) {
    const list = membersByUser.get(m.user_id) || []
    list.push(m)
    membersByUser.set(m.user_id, list)
  }

  // Get team memberships for all users
  const { data: teamMembers } = await adminClient
    .from('team_members')
    .select('user_id, role, teams(id, name, slug)')

  const teamsByUser = new Map<string, any[]>()
  for (const m of teamMembers || []) {
    const list = teamsByUser.get(m.user_id) || []
    list.push({ role: m.role, ...m.teams })
    teamsByUser.set(m.user_id, list)
  }

  const users = authData.users.map((u) => {
    const profile = profileMap.get(u.id)
    return {
      id: u.id,
      email: u.email,
      display_name: profile?.display_name || profile?.title || null,
      title: profile?.title || null,
      is_admin: profile?.is_admin || false,
      created_at: u.created_at,
      last_sign_in: u.last_sign_in_at,
      banned_until: (u as any).banned_until || null,
      squads: membersByUser.get(u.id) || [],
      teams: teamsByUser.get(u.id) || [],
    }
  })

  return NextResponse.json(users)
}

export async function PATCH(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await checkIsAdmin(user.id, user.email || '')
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const targetUserId = String(body.user_id || '')
  if (!targetUserId) return NextResponse.json({ error: 'user_id required' }, { status: 400 })

  const adminClient = getAdminClient()
  const profilePatch: Record<string, unknown> = {}

  if (typeof body.is_admin === 'boolean') profilePatch.is_admin = body.is_admin
  if (typeof body.display_name === 'string') profilePatch.display_name = body.display_name.trim() || null
  if (typeof body.title === 'string') profilePatch.title = body.title.trim() || null
  if (typeof body.default_team_id === 'string' || body.default_team_id === null) {
    profilePatch.default_team_id = body.default_team_id
  }

  if (Object.keys(profilePatch).length > 0) {
    const { error } = await adminClient
      .from('user_profiles')
      .update(profilePatch)
      .eq('id', targetUserId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const teamAction = body.team_action as string | undefined
  if (teamAction) {
    const role = ['lead', 'member', 'viewer'].includes(body.role) ? body.role : 'member'
    let teamId = body.team_id as string | undefined

    if (!teamId && body.team_slug) {
      const { data: team, error } = await adminClient
        .from('teams')
        .select('id')
        .eq('slug', String(body.team_slug))
        .single()
      if (error || !team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
      teamId = team.id
    }

    if (!teamId) return NextResponse.json({ error: 'team_id or team_slug required' }, { status: 400 })

    if (teamAction === 'remove') {
      const { error } = await adminClient
        .from('team_members')
        .delete()
        .eq('team_id', teamId)
        .eq('user_id', targetUserId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (teamAction === 'upsert') {
      const { error } = await adminClient
        .from('team_members')
        .upsert(
          { team_id: teamId, user_id: targetUserId, role, added_by: user.id },
          { onConflict: 'team_id,user_id' },
        )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      if (role === 'lead') {
        await adminClient.from('teams').update({ lead_user_id: targetUserId }).eq('id', teamId)
      }
    } else {
      return NextResponse.json({ error: 'Invalid team_action' }, { status: 400 })
    }
  }

  if (typeof body.default_team_id === 'string') {
    const { data: existing } = await adminClient
      .from('team_members')
      .select('id')
      .eq('team_id', body.default_team_id)
      .eq('user_id', targetUserId)
      .maybeSingle()

    if (!existing) {
      const { error } = await adminClient
        .from('team_members')
        .insert({ team_id: body.default_team_id, user_id: targetUserId, role: 'member', added_by: user.id })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

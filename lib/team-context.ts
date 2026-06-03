/**
 * Team context helper — every tool and Morgan endpoint calls this
 * to understand who the user is and what they should see.
 */

import { getAdminClient } from '@/lib/admin'

export interface TeamContext {
  teamSlug: string
  teamName: string
  teamId: string
  programs: string[]
  role: 'lead' | 'member' | 'viewer'
  isExecutive: boolean
  isTechnology: boolean
  canSeeAll: boolean
}

export interface UserTeamContext {
  userId: string
  email: string
  name: string | null
  title: string | null
  teams: TeamContext[]
  primaryTeam: TeamContext | null
  isAdmin: boolean
  canSeeAll: boolean
}

export async function getUserTeamContext(userId: string): Promise<UserTeamContext> {
  const adminClient = getAdminClient()

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    adminClient
      .from('user_profiles')
      .select('email, display_name, title, default_team_id, is_admin')
      .eq('id', userId)
      .single(),
    adminClient
      .from('team_members')
      .select('role, teams(id, name, slug, programs, parent_team_id)')
      .eq('user_id', userId),
  ])

  const teams: TeamContext[] = (memberships || []).map((m: any) => {
    const slug = m.teams?.slug || ''
    const isExec = slug === 'executive'
    const isTech = slug === 'technology'
    // ops and gen-ops get full campus visibility in work-order routing
    const isOps = slug === 'ops' || slug === 'gen-ops'
    return {
      teamSlug: slug,
      teamName: m.teams?.name || '',
      teamId: m.teams?.id || '',
      programs: m.teams?.programs || [],
      role: m.role as 'lead' | 'member' | 'viewer',
      isExecutive: isExec,
      isTechnology: isTech,
      canSeeAll: isExec || isTech || isOps,
    }
  })

  const isAdmin = profile?.is_admin === true
  const canSeeAll = isAdmin || teams.some(t => t.canSeeAll)

  // Primary team = default_team_id match, or first lead role, or first team
  const primaryTeam =
    teams.find(t => t.teamId === profile?.default_team_id) ||
    teams.find(t => t.role === 'lead') ||
    teams[0] || null

  return {
    userId,
    email: profile?.email || '',
    name: profile?.display_name || null,
    title: profile?.title || null,
    teams,
    primaryTeam,
    isAdmin,
    canSeeAll,
  }
}

/**
 * Get all programs a user has access to (union of all team programs).
 * If any team has 'all', returns null (meaning no filter).
 */
export function getUserPrograms(ctx: UserTeamContext): string[] | null {
  if (ctx.canSeeAll) return null
  const programs = new Set<string>()
  for (const t of ctx.teams) {
    if (t.programs.includes('all')) return null
    t.programs.forEach(p => programs.add(p))
  }
  return Array.from(programs)
}

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ALL_TEAMS_ORDER, getNavForTeam, isAllTeamsRole, NavSection, TEAM_NAV } from '@/lib/nav-config'

export interface TeamNavContext {
  teamSlug: string
  teamName: string
  userName: string
  role: string
}

export interface TeamGroup {
  slug: string
  label: string
  sections: NavSection[]
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) (headers as any).Authorization = `Bearer ${session.access_token}`
  return fetch(url, { headers })
}

export interface AvailableTeam {
  slug: string
  label: string
}

export function useTeamNav() {
  const [teamContext, setTeamContext] = useState<TeamNavContext | null>(null)
  const [navSections, setNavSections] = useState<NavSection[]>([])
  const [allTeamGroups, setAllTeamGroups] = useState<TeamGroup[]>([])
  const [isAllTeams, setIsAllTeams] = useState(false)
  const [availableTeams, setAvailableTeams] = useState<AvailableTeam[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/me/team')
        if (!res.ok) {
          setNavSections(getNavForTeam('technology'))
          setLoading(false)
          return
        }
        const data = await res.json()
        // /api/me/team returns a UserTeamContext: { email, name, teams[], primaryTeam, canSeeAll }
        const primary = data.primaryTeam || data.teams?.[0] || null
        const ctx: TeamNavContext = {
          teamSlug: primary?.teamSlug || (data.canSeeAll ? 'technology' : 'technology'),
          teamName: primary?.teamName || 'Technology',
          userName: data.name || data.email?.split('@')[0] || 'User',
          role: primary?.role || 'member',
        }
        setTeamContext(ctx)

        // Teams the user can actually switch to. Admins (canSeeAll) get the full
        // top-level list; everyone else gets the intersection with their memberships.
        const memberSlugs = new Set<string>((data.teams || []).map((t: { teamSlug: string }) => t.teamSlug))
        const available: AvailableTeam[] = data.canSeeAll
          ? ALL_TEAMS_ORDER
          : ALL_TEAMS_ORDER.filter((t) => memberSlugs.has(t.slug))
        setAvailableTeams(available)

        if (isAllTeamsRole(ctx.teamSlug)) {
          const groups: TeamGroup[] = ALL_TEAMS_ORDER.map((team) => ({
            slug: team.slug,
            label: team.label,
            sections: TEAM_NAV[team.slug] || [],
          }))
          setAllTeamGroups(groups)
          setIsAllTeams(true)
          setNavSections(getNavForTeam(ctx.teamSlug))
        } else {
          setNavSections(getNavForTeam(ctx.teamSlug))
          setAllTeamGroups([])
          setIsAllTeams(false)
        }
      } catch (err) {
        console.error('useTeamNav failed:', err)
        setNavSections(getNavForTeam('technology'))
        setAllTeamGroups([])
        setIsAllTeams(false)
        setAvailableTeams([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return { teamContext, navSections, allTeamGroups, isAllTeams, availableTeams, loading }
}

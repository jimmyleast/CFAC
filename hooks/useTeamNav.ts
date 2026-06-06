'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCfacNav, NavSection } from '@/lib/nav-config'

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

export interface AvailableTeam {
  slug: string
  label: string
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) (headers as Record<string, string>).Authorization = `Bearer ${session.access_token}`
  return fetch(url, { headers })
}

// CFAC uses one shared navigation for everyone (admin section gated by is_admin).
// No per-user team membership or team switching.
export function useTeamNav() {
  const [teamContext, setTeamContext] = useState<TeamNavContext | null>(null)
  const [navSections, setNavSections] = useState<NavSection[]>(getCfacNav(false))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/me')
        const data = res.ok ? await res.json() : {}
        const isAdmin = data?.is_admin === true
        setNavSections(getCfacNav(isAdmin))
        setTeamContext({
          teamSlug: 'cfac',
          teamName: 'CFAC',
          userName: data?.display_name || data?.email?.split('@')[0] || 'User',
          role: isAdmin ? 'admin' : 'staff',
        })
      } catch {
        setNavSections(getCfacNav(false))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Team-switcher fields kept empty for backwards compatibility with NavDrawer/AppChrome.
  return {
    teamContext,
    navSections,
    allTeamGroups: [] as TeamGroup[],
    isAllTeams: false,
    availableTeams: [] as AvailableTeam[],
    loading,
  }
}

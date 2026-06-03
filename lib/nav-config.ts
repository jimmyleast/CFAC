export interface NavItem {
  label: string
  href: string
  icon: string
  description: string
  badge?: string
  external?: boolean
}

export interface NavSection {
  section: string
  items: NavItem[]
}

export type TeamNavMap = Record<string, NavSection[]>

const HOME_SECTION: NavSection = {
  section: 'HOME',
  items: [
    { label: 'Home', href: '/home', icon: 'Home', description: 'Overview and the CFAC agent' },
  ],
}

// CFAC starts narrow: an Executive view and a Data view. Add mini-apps here as they ship.
export const TEAM_NAV: TeamNavMap = {
  executive: [
    HOME_SECTION,
    {
      section: 'EXECUTIVE',
      items: [
        { label: 'Executive Dashboard', href: '/executive', icon: 'LayoutDashboard', description: 'Org pulse check across programs and services' },
        { label: 'Organizational Impact', href: '/executive?view=impact', icon: 'Activity', description: 'Services delivered, reach, and outcomes' },
        { label: 'Financial Health', href: '/executive?view=finance', icon: 'DollarSign', description: 'Financial health at a glance' },
      ],
    },
  ],
  data: [
    HOME_SECTION,
    {
      section: 'DATA',
      items: [
        { label: 'Data Sources', href: '/admin/data', icon: 'Database', description: 'Spreadsheet and system sources feeding the dashboards' },
        { label: 'Import', href: '/admin/data/import', icon: 'Upload', description: 'Import spreadsheet data' },
        { label: 'Data Integrity', href: '/admin/data/integrity', icon: 'ShieldAlert', description: 'Missing, mismatched, or stale entries' },
      ],
    },
  ],
}

export const ALL_TEAMS_ORDER = [
  { slug: 'executive', label: 'EXECUTIVE' },
  { slug: 'data', label: 'DATA' },
]

export const ALL_TEAMS_ROLES = ['executive']

export function isAllTeamsRole(teamSlug: string): boolean {
  return ALL_TEAMS_ROLES.includes(teamSlug)
}

export const DEFAULT_NAV: NavSection[] = [HOME_SECTION]

export function getNavForTeam(teamSlug: string): NavSection[] {
  const team = TEAM_NAV[teamSlug] || DEFAULT_NAV
  const hasOwnHome = team.some((s) => s.section === 'HOME')
  return hasOwnHome ? team : [HOME_SECTION, ...team]
}

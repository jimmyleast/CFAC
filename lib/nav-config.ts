export interface NavItem {
  label: string
  href: string
  icon: string
  description?: string
  badge?: string
  external?: boolean
}

export interface NavSection {
  section: string
  items: NavItem[]
}

// CFAC components (program + operational areas). Used for the COMPONENTS nav
// section and for grouping data sources. Executive + Data live under INSIGHTS.
export const CFAC_COMPONENTS: { slug: string; label: string; icon: string }[] = [
  { slug: 'acute', label: 'Acute', icon: 'Siren' },
  { slug: 'advocacy', label: 'Advocacy', icon: 'HeartHandshake' },
  { slug: 'forensic-interviewing', label: 'Forensic Interviewing', icon: 'Mic' },
  { slug: 'mental-health', label: 'Mental Health', icon: 'Brain' },
  { slug: 'medical', label: 'Medical', icon: 'Stethoscope' },
  { slug: 'residential', label: 'Residential', icon: 'Home' },
  { slug: 'enrichment', label: 'Enrichment', icon: 'Sparkles' },
  { slug: 'education', label: 'Education', icon: 'GraduationCap' },
  { slug: 'community-relations', label: 'Community Relations', icon: 'Users' },
  { slug: 'development', label: 'Development', icon: 'Gift' },
  { slug: 'operations', label: 'Operations', icon: 'Wrench' },
  { slug: 'finance', label: 'Finance', icon: 'DollarSign' },
  { slug: 'hr', label: 'Human Resources', icon: 'IdCard' },
  { slug: 'xaya', label: 'Xaya (Therapy Dog)', icon: 'Dog' },
]

// Build the CFAC navigation. Same nav for everyone; admin section gated by isAdmin.
export function getCfacNav(isAdmin: boolean): NavSection[] {
  const sections: NavSection[] = [
    {
      section: 'HOME',
      items: [{ label: 'Home', href: '/home', icon: 'Home', description: 'Overview and the Hope assistant' }],
    },
    {
      section: 'INSIGHTS',
      items: [
        { label: 'Executive Dashboard', href: '/executive', icon: 'LayoutDashboard', description: 'Org pulse check' },
        { label: 'Data Sources', href: '/admin/data', icon: 'Database', description: 'Spreadsheets, forms, systems' },
        { label: 'Import', href: '/admin/data/import', icon: 'Upload', description: 'Import spreadsheet data' },
        { label: 'Data Integrity', href: '/admin/data/integrity', icon: 'ShieldAlert', description: 'Missing / mismatched entries' },
      ],
    },
    {
      section: 'COMPONENTS',
      items: CFAC_COMPONENTS.map((c) => ({
        label: c.label, href: `/c/${c.slug}`, icon: c.icon, description: `${c.label} data & sources`,
      })),
    },
  ]

  if (isAdmin) {
    sections.push({
      section: 'ADMIN',
      items: [
        { label: 'People', href: '/admin/people', icon: 'Users', description: 'Staff with platform access' },
        { label: 'Feature Flags', href: '/admin/feature-flags', icon: 'ToggleLeft', description: 'Toggle features' },
        { label: 'Observability', href: '/admin/observability', icon: 'Activity', description: 'App telemetry' },
      ],
    })
  }

  return sections
}

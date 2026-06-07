'use client'

import { usePathname, useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { NavSection } from '@/lib/nav-config'
import Pinwheel from '@/components/Pinwheel'
import { AvailableTeam, TeamGroup } from '@/hooks/useTeamNav'

interface NavDrawerProps {
  sections: NavSection[]
  teamSlug?: string
  teamName: string
  userName: string
  userInitials: string
  isAllTeams?: boolean
  allTeamGroups?: TeamGroup[]
  availableTeams?: AvailableTeam[]
  drawerOpen?: boolean
  onDrawerClose?: () => void
}

const GOLD = '#5BA3D9'
const GOLD_GLOW = 'rgba(91,163,217,0.15)'
const GOLD_DIM = '#9A7E36'
const BG = '#0A0A0A'
const BG2 = '#111111'
const BG3 = '#1A1A1A'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'
const WHITE = '#FFFFFF'

function NavIcon({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  const Component = (Icons as unknown as Record<string, Icons.LucideIcon | undefined>)[name]
  if (Component) return <Component size={size} strokeWidth={1.5} color={color} />
  return (
    <span style={{ fontSize: 14, color, width: size, textAlign: 'center', display: 'inline-block' }}>{name}</span>
  )
}

export default function NavDrawer({ sections, teamName, userName, userInitials, drawerOpen, onDrawerClose }: NavDrawerProps) {
  const pathname = usePathname() || ''
  const router = useRouter()

  function handleNavClick(href: string, external?: boolean) {
    if (external) window.open(href, '_blank')
    else router.push(href)
  }

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  // Best-matching active item across sections (exact or path-prefix; longest wins).
  let activeHref: string | null = null
  for (const section of sections) {
    for (const item of section.items) {
      if (item.external) continue
      const base = item.href.split('#')[0].split('?')[0]
      if (base.length === 0) continue
      const matches = base === pathname || (base.length > 1 && pathname.startsWith(base + '/'))
      if (matches && (!activeHref || base.length > activeHref.length)) activeHref = item.href
    }
  }

  return (
    <aside
      className={`app-sidebar${drawerOpen ? ' drawer-open' : ''}`}
      style={{
        width: 280, flexShrink: 0, background: BG, borderRight: `1px solid ${LINE}`,
        display: 'flex', flexDirection: 'column', height: '100vh', position: 'fixed', top: 0, left: 0, zIndex: 20,
      }}
    >
      {/* Header: logo + close */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${LINE}`, flexShrink: 0, background: BG }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pinwheel size={26} />
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, letterSpacing: '0.06em', color: GOLD }}>CFAC</span>
          </span>
          <button
            type="button" onClick={() => onDrawerClose?.()} aria-label="Close menu" className="drawer-close-btn"
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.22)', color: TEXT2, width: 36, height: 36, minWidth: 36, minHeight: 36, display: 'none', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <Icons.X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div style={{ marginTop: 18, padding: '10px 14px', background: BG2, border: `1px solid ${LINE2}`, fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: TEXT2 }}>
          {teamName} · Data &amp; Operations
        </div>
      </div>

      {/* Scrollable nav body */}
      <nav style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {sections.map((section) => (
          <div key={section.section} style={{ padding: '18px 0 8px', borderBottom: `1px solid ${LINE}` }}>
            <div style={{ padding: '0 20px 10px', fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.16em', color: TEXT2 }}>
              {section.section}
            </div>
            {section.items.map((item) => {
              const isActive = !item.external && item.href === activeHref
              const iconColor = isActive ? GOLD : TEXT2
              const labelColor = isActive ? WHITE : TEXT
              return (
                <button
                  key={item.href + item.label}
                  type="button"
                  onClick={() => handleNavClick(item.href, item.external)}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = BG2 }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '9px 20px 9px 18px',
                    background: isActive ? BG3 : 'transparent', border: 'none', borderLeft: `2px solid ${isActive ? GOLD : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <NavIcon name={item.icon} color={iconColor} />
                  <span style={{ flex: 1, fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.08em', color: labelColor, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {item.label}
                    {item.badge && (
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 9, letterSpacing: '0.16em', padding: '2px 6px', border: `1px solid ${GOLD_DIM}`, background: GOLD_GLOW, color: GOLD }}>{item.badge}</span>
                    )}
                    {item.external && <Icons.ArrowUpRight size={12} color={TEXT2} strokeWidth={1.5} />}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer: user + sign out */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${LINE}`, background: BG }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 16 }}>
          <div style={{ width: 32, height: 32, background: BG2, border: `1px solid ${LINE2}`, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12, color: TEXT, flexShrink: 0 }}>
            {userInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 500, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT2, marginTop: 2 }}>{teamName}</div>
          </div>
          <button
            type="button" onClick={signOut} aria-label="Sign out"
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,0.22)', color: TEXT2, width: 36, height: 36, minWidth: 36, minHeight: 36, display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            <Icons.LogOut size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  )
}

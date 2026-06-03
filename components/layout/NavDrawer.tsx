'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { NavSection, TEAM_NAV } from '@/lib/nav-config'
import { AvailableTeam, TeamGroup } from '@/hooks/useTeamNav'

interface NavDrawerProps {
  sections: NavSection[]
  teamSlug: string
  teamName: string
  userName: string
  userInitials: string
  isAllTeams?: boolean
  allTeamGroups?: TeamGroup[]
  availableTeams?: AvailableTeam[]
  drawerOpen?: boolean
  onDrawerClose?: () => void
}

const GOLD = '#C9A84C'
const GOLD_GLOW = 'rgba(201,168,76,0.15)'
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
  if (Component) {
    return <Component size={size} strokeWidth={1.5} color={color} />
  }
  return (
    <span style={{ fontSize: 14, color, width: size, textAlign: 'center', display: 'inline-block' }}>
      {name}
    </span>
  )
}

function ChevronDownIcon({ rotated, color }: { rotated?: boolean; color: string }) {
  return (
    <Icons.ChevronDown
      size={14}
      strokeWidth={1.5}
      color={color}
      style={{ transition: 'transform 180ms ease', transform: rotated ? 'rotate(180deg)' : 'none' }}
    />
  )
}

export default function NavDrawer({ sections, teamSlug, teamName, userName, userInitials, isAllTeams, allTeamGroups, availableTeams, drawerOpen, onDrawerClose }: NavDrawerProps) {
  const pathname = usePathname() || ''
  const router = useRouter()
  const [teamMenuOpen, setTeamMenuOpen] = useState(false)
  const [previewTeam, setPreviewTeam] = useState<string | null>(null)
  const teamChipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (teamChipRef.current && !teamChipRef.current.contains(e.target as Node)) {
        setTeamMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTeamMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function handleNavClick(href: string, external?: boolean) {
    if (external) window.open(href, '_blank')
    else router.push(href)
  }

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  // Pick which team's sections to render. Team-switcher previews any team's nav,
  // regardless of whether the user is an all-teams role.
  let renderedSections = sections
  if (previewTeam) {
    const group = allTeamGroups?.find((g) => g.slug === previewTeam)
    if (group) {
      renderedSections = group.sections
    } else if (TEAM_NAV[previewTeam]) {
      renderedSections = TEAM_NAV[previewTeam]
    }
  }
  void isAllTeams

  const teamList = availableTeams ?? []
  const canSwitch = teamList.length > 1

  // Pick the single best-matching item across all rendered sections so two
  // siblings (e.g. /admin and /admin/people) can't both light up at once.
  // Match = exact pathname OR pathname prefix with a '/' segment boundary;
  // ties resolve to the longest href.
  let activeHref: string | null = null
  for (const section of renderedSections) {
    for (const item of section.items) {
      if (item.external) continue
      const base = item.href.split('#')[0]
      if (base.length === 0) continue
      const matches = base === pathname || (base.length > 1 && pathname.startsWith(base + '/'))
      if (matches && (!activeHref || base.length > activeHref.length)) {
        activeHref = item.href
      }
    }
  }

  return (
    <aside
      className={`app-sidebar${drawerOpen ? ' drawer-open' : ''}`}
      style={{
        width: 280,
        flexShrink: 0,
        background: BG,
        borderRight: `1px solid ${LINE}`,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 20,
      }}
    >
      {/* Header: logo + team chip */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${LINE}`, flexShrink: 0, background: BG, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://uhp.com/wp-content/uploads/2025/07/logo.svg"
            alt="UHP"
            style={{ height: 24, width: 'auto', display: 'block' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <button
            type="button"
            onClick={() => onDrawerClose?.()}
            aria-label="Close menu"
            className="drawer-close-btn"
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.22)', color: TEXT2,
              width: 36, height: 36, minWidth: 36, minHeight: 36,
              display: 'none', placeItems: 'center', cursor: 'pointer', flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = TEXT; (e.currentTarget as HTMLElement).style.borderColor = TEXT }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = TEXT2; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.22)' }}
          >
            <Icons.X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div ref={teamChipRef} style={{ position: 'relative' }}>
          {canSwitch ? (
            <button
              type="button"
              onClick={() => setTeamMenuOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: 8,
                marginTop: 22,
                padding: '11px 14px',
                background: BG2,
                border: `1px solid ${LINE2}`,
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                cursor: 'pointer',
                color: TEXT,
              }}
            >
              <span style={{ fontFamily: 'var(--font-heading)' }}>
                {previewTeam ? (teamList.find((t) => t.slug === previewTeam)?.label || teamName) : teamName}
              </span>
              <ChevronDownIcon rotated={teamMenuOpen} color={TEXT2} />
            </button>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                marginTop: 22,
                padding: '11px 14px',
                background: BG2,
                border: `1px solid ${LINE2}`,
                fontFamily: 'var(--font-heading)',
                fontWeight: 700,
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: TEXT,
              }}
            >
              <span style={{ fontFamily: 'var(--font-heading)' }}>{teamName}</span>
            </div>
          )}

          {canSwitch && teamMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                left: 0,
                right: 0,
                background: BG2,
                border: `1px solid ${LINE2}`,
                zIndex: 25,
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {teamList.map((t) => {
                const isSelected = (previewTeam ?? teamSlug) === t.slug
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => {
                      setPreviewTeam(t.slug === teamSlug ? null : t.slug)
                      setTeamMenuOpen(false)
                    }}
                    style={{
                      padding: '10px 14px',
                      fontFamily: 'var(--font-heading)',
                      fontWeight: 700,
                      fontSize: 12,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: isSelected ? GOLD : TEXT,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      borderBottom: `1px solid ${LINE}`,
                      borderLeft: isSelected ? `2px solid ${GOLD}` : '2px solid transparent',
                      background: isSelected ? BG3 : 'transparent',
                      border: 'none',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-heading)' }}>{t.label}</span>
                    {isSelected && <Icons.Check size={14} color={GOLD} strokeWidth={1.5} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable nav body */}
      <nav style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {renderedSections.map((section) => (
          <div key={section.section} style={{ padding: '18px 0 8px', borderBottom: `1px solid ${LINE}` }}>
            <div style={{
              padding: '0 20px 10px',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: TEXT2,
            }}>
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
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = isActive ? BG3 : 'transparent' }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: '9px 20px 9px 18px',
                    background: isActive ? BG3 : 'transparent',
                    border: 'none',
                    borderLeft: `2px solid ${isActive ? GOLD : 'transparent'}`,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <NavIcon name={item.icon} color={iconColor} />
                  <span style={{
                    flex: 1,
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    fontSize: 14,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: labelColor,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    {item.label}
                    {item.badge && (
                      <span style={{
                        fontFamily: 'var(--font-heading)',
                        fontWeight: 700,
                        fontSize: 9,
                        letterSpacing: '0.16em',
                        padding: '2px 6px',
                        border: `1px solid ${GOLD_DIM}`,
                        background: GOLD_GLOW,
                        color: GOLD,
                      }}>
                        {item.badge}
                      </span>
                    )}
                    {item.external && <Icons.ArrowUpRight size={12} color={TEXT2} strokeWidth={1.5} />}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer: user row + sign out */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${LINE}`, background: BG }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px',
        }}>
          <div style={{
            width: 32,
            height: 32,
            background: BG2,
            border: `1px solid ${LINE2}`,
            display: 'grid',
            placeItems: 'center',
            fontFamily: 'var(--font-heading)',
            fontWeight: 700,
            fontSize: 12,
            color: TEXT,
            flexShrink: 0,
          }}>
            {userInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: TEXT,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{userName}</div>
            <div style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 500,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: TEXT2,
              marginTop: 2,
            }}>{teamName}</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.22)',
              color: TEXT2,
              width: 36,
              height: 36,
              minWidth: 36,
              minHeight: 36,
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = TEXT; (e.currentTarget as HTMLElement).style.color = TEXT }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.22)'; (e.currentTarget as HTMLElement).style.color = TEXT2 }}
          >
            <Icons.LogOut size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </aside>
  )
}

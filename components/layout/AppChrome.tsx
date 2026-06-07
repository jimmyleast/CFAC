'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import * as Icons from 'lucide-react'
import NavDrawer from './NavDrawer'
import { useTeamNav } from '@/hooks/useTeamNav'
import { createClient } from '@/lib/supabase/client'

type UserRole = 'admin' | 'staff' | null

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<{ email?: string; display_name?: string | null; is_admin?: boolean } | null>(null)
  const [role, setRole] = useState<UserRole>(null)

  useEffect(() => {
    // /connect/* are public, token-gated invite pages — no app auth required.
    if (!pathname || pathname.startsWith('/auth') || pathname === '/connect' || pathname.startsWith('/connect/') || pathname === '/onboarding') return
    // Enforce 2FA: if the user has a verified factor but this session is not
    // elevated to AAL2, send them to the challenge.
    void createClient().auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => {
        if (data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
          router.replace(`/auth/mfa?next=${encodeURIComponent(pathname)}`)
        }
      })
      .catch(() => {})
    void Promise.all([
      fetch('/api/me').then(async (res) => {
        if (res.status === 401) {
          router.replace(`/auth/login?next=${encodeURIComponent(pathname)}`)
          return null
        }
        return res.ok ? res.json() : null
      }).catch(() => null),
      fetch('/api/user/role').then(async (res) => (res.ok ? res.json() : null)).catch(() => null),
    ]).then(([meData, roleData]) => {
      setUser(meData)
      if (roleData?.role) setRole(roleData.role)
    })
  }, [pathname, router])

  const hideChrome = useMemo(() => {
    if (!pathname) return false
    if (pathname === '/') return true
    if (pathname === '/hub') return true
    if (pathname.startsWith('/auth')) return true
    if (pathname === '/connect' || pathname.startsWith('/connect/')) return true
    return false
  }, [pathname])

  void role; void user

  if (hideChrome) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { teamContext, navSections, allTeamGroups, isAllTeams, availableTeams, loading } = useTeamNav()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // ESC closes drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && drawerOpen) setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Lock body scroll while drawer open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [drawerOpen])

  const userName = teamContext?.userName || 'User'
  const initials = userName
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U'

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      {loading ? (
        <NavSidebarSkeleton />
      ) : (
        <NavDrawer
          sections={navSections}
          teamSlug={teamContext?.teamSlug || 'cfac'}
          teamName={teamContext?.teamName || 'CFAC'}
          userName={userName}
          userInitials={initials}
          isAllTeams={isAllTeams}
          allTeamGroups={allTeamGroups}
          availableTeams={availableTeams}
          drawerOpen={drawerOpen}
          onDrawerClose={() => setDrawerOpen(false)}
        />
      )}

      {/* Backdrop only renders on mobile via CSS */}
      <div
        className={`sidebar-backdrop${drawerOpen ? ' open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />

      <div className="chrome-content" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {/* Mobile header bar — hidden on desktop via CSS.
            The hamburger + notifications dock are positioned inside it via CSS. */}
        <div className="mobile-header-bar" aria-hidden />

        {/* Mobile menu trigger — hidden on desktop, positioned inside the header bar on mobile */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="mobile-menu-trigger"
        >
          <Icons.Menu size={20} strokeWidth={1.5} />
        </button>

        {children}
      </div>
    </div>
  )
}

function NavSidebarSkeleton() {
  const BG = '#0A0A0A'
  const LINE = '#2A2A2A'
  const SHIMMER = 'rgba(255,255,255,0.04)'
  const SHIMMER2 = 'rgba(255,255,255,0.02)'

  const block = (h: number, w: string | number, mb: number) => (
    <div style={{
      height: h,
      width: w,
      background: `linear-gradient(90deg, ${SHIMMER2} 0%, ${SHIMMER} 50%, ${SHIMMER2} 100%)`,
      backgroundSize: '200% 100%',
      animation: 'navSkeletonShimmer 1.4s ease-in-out infinite',
      marginBottom: mb,
    }} />
  )

  return (
    <>
      <style>{`@keyframes navSkeletonShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <aside
        aria-hidden
        className="app-sidebar"
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
        <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${LINE}`, flexShrink: 0 }}>
          {block(24, 80, 22)}
          {block(40, '100%', 0)}
        </div>

        <div style={{ flex: 1, padding: '18px 20px 8px', overflow: 'hidden' }}>
          {block(12, 60, 14)}
          {block(36, '100%', 4)}
          {block(36, '100%', 24)}

          {block(12, 50, 14)}
          {block(36, '100%', 4)}
          {block(36, '100%', 4)}
          {block(36, '100%', 24)}

          {block(12, 60, 14)}
          {block(36, '100%', 4)}
          {block(36, '100%', 4)}
          {block(36, '100%', 4)}
          {block(36, '100%', 24)}
        </div>

        <div style={{ flexShrink: 0, borderTop: `1px solid ${LINE}`, padding: '28px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: SHIMMER,
            flexShrink: 0,
          }} />
          <div style={{ flex: 1 }}>
            {block(12, '70%', 6)}
            {block(8, '50%', 0)}
          </div>
        </div>
      </aside>
    </>
  )
}

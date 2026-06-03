'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Notification = {
  id: string
  title?: string | null
  body?: string | null
  link_href?: string | null
  read: boolean
  created_at: string
}

const BG = '#0A0A0A'
const BG2 = '#111111'
const BG3 = '#1A1A1A'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'
const CRITICAL = '#DC2626'
const WHITE = '#FFFFFF'
const GOLD = '#C9A84C'

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(opts.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  return fetch(url, { ...opts, headers })
}

function fmtAge(iso: string) {
  const d = new Date(iso)
  const ms = Date.now() - d.getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

export default function NotificationsDock() {
  const pathname = usePathname() || ''
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLButtonElement>(null)

  const hidden = !pathname || pathname === '/' || pathname.startsWith('/auth') || pathname === '/onboarding' || pathname === '/hub' || pathname.startsWith('/intake/') || pathname.startsWith('/work-orders/submit/') || pathname.startsWith('/student')

  useEffect(() => {
    if (hidden) return
    void load()
  }, [pathname, hidden])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && dockRef.current && !dockRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (hidden) return null

  async function load() {
    try {
      const res = await authFetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications || [])
      setUnread(data.unread || 0)
    } catch {
      // silent fail
    }
  }

  async function markAllRead() {
    try {
      await authFetch('/api/notifications', { method: 'PATCH', body: JSON.stringify({ markAllRead: true }) })
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnread(0)
    } catch {}
  }

  function onItemClick(n: Notification) {
    if (n.link_href) window.location.href = n.link_href
    if (!n.read) {
      void authFetch('/api/notifications', { method: 'PATCH', body: JSON.stringify({ ids: [n.id] }) })
      setItems((prev) => prev.map((p) => p.id === n.id ? { ...p, read: true } : p))
      setUnread((u) => Math.max(0, u - 1))
    }
  }

  return (
    <>
      <button
        ref={dockRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="dock-notifications"
        style={{
          position: 'fixed',
          top: 16,
          right: 24,
          width: 52,
          height: 52,
          background: BG2,
          border: `1px solid ${LINE2}`,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          zIndex: 20,
          color: TEXT,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = BG3)}
        onMouseLeave={(e) => (e.currentTarget.style.background = BG2)}
      >
        <Icons.Bell size={22} color={TEXT} strokeWidth={1.5} />
        {unread > 0 && (
          <span style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            background: CRITICAL,
            color: WHITE,
            fontFamily: 'var(--font-heading)',
            fontWeight: 700,
            fontSize: 10,
            lineHeight: '18px',
            textAlign: 'center',
            letterSpacing: '0.04em',
            border: `1px solid ${BG}`,
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          top: 76,
          right: 24,
          width: 360,
          maxHeight: 'calc(100vh - 96px)',
          background: BG2,
          border: `1px solid ${LINE2}`,
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transform: open ? 'none' : 'translateY(-8px) scale(0.98)',
          transformOrigin: 'top right',
          transition: 'opacity 160ms ease-out, transform 200ms cubic-bezier(0.2,0.8,0.2,1)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT }}>
            Notifications
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              style={{
                background: 'transparent', border: 'none', color: TEXT2,
                fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
                cursor: 'pointer', padding: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = GOLD)}
              onMouseLeave={(e) => (e.currentTarget.style.color = TEXT2)}
            >
              Mark all read
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: TEXT2, fontSize: 13 }}>
              No notifications.
            </div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onItemClick(n)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: n.read ? 'transparent' : 'rgba(201,168,76,0.06)',
                  border: 'none',
                  borderBottom: `1px solid ${LINE}`,
                  borderLeft: n.read ? '2px solid transparent' : `2px solid ${GOLD}`,
                  cursor: 'pointer',
                  color: TEXT,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = BG3)}
                onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(201,168,76,0.06)')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT }}>
                    {n.title || 'Notification'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT2, whiteSpace: 'nowrap' }}>
                    {fmtAge(n.created_at)}
                  </div>
                </div>
                {n.body && (
                  <div style={{ fontSize: 12, color: TEXT2, marginTop: 4, lineHeight: 1.4 }}>
                    {n.body}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}

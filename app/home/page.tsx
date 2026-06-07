'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEAL = '#7DD3C7'
const BG2 = 'rgba(255,255,255,0.025)'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) (headers as Record<string, string>).Authorization = `Bearer ${session.access_token}`
  return fetch(url, { headers })
}

type Tile = { label: string; href: string; icon: keyof typeof Icons; desc: string; accent: string }

const TILES: Tile[] = [
  { label: 'Executive Dashboard', href: '/executive', icon: 'LayoutDashboard', desc: 'Org pulse check across programs, services, reach, and financial health.', accent: GOLD },
  { label: 'Data', href: '/admin/data', icon: 'Database', desc: 'Data sources, imports, and integrity across CFAC components.', accent: TEAL },
]

export default function HomePage() {
  const router = useRouter()
  const [userName, setUserName] = useState<string>('')

  useEffect(() => {
    let active = true
    authFetch('/api/me')
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return
        const name = data.display_name || data.name || data.email || ''
        setUserName(String(name).split('@')[0])
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: TEXT2, marginBottom: 6 }}>
        Children &amp; Family Advocacy Center
      </div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 34, color: TEXT, margin: '0 0 8px' }}>
        {userName ? `Welcome, ${userName}` : 'Welcome'}
      </h1>
      <p style={{ color: TEXT2, fontSize: 15, lineHeight: 1.6, maxWidth: 640, margin: '0 0 32px' }}>
        Your operations &amp; data home. Jump into the dashboards below, or ask the assistant
        (bottom-right) to pull a number or build a view on the fly.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {TILES.map((t) => {
          const Icon = (Icons[t.icon] || Icons.Square) as React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
          return (
            <button
              key={t.href}
              onClick={() => router.push(t.href)}
              style={{
                textAlign: 'left', background: BG2, border: `1px solid ${LINE}`, borderRadius: 12,
                padding: 20, cursor: 'pointer', transition: 'border-color 0.15s',
                display: 'flex', flexDirection: 'column', gap: 10,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = t.accent }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = LINE }}
            >
              <span style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(91,163,217,0.1)', border: `1px solid ${t.accent}33` }}>
                <Icon size={20} strokeWidth={1.5} color={t.accent} />
              </span>
              <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17, color: TEXT }}>{t.label}</span>
              <span style={{ color: TEXT2, fontSize: 13, lineHeight: 1.5 }}>{t.desc}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

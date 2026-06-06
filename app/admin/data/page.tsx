'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEAL = '#7DD3C7'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const WARN = '#E0846B'

type Source = {
  id: string; name: string; slug: string; kind: string; description: string | null
  component: string | null; lastImportedAt: string | null; metricCount: number; issueCount: number
}

const KIND_ICON: Record<string, keyof typeof Icons> = {
  spreadsheet: 'Table', form: 'ClipboardList', system: 'Plug', manual: 'PencilLine',
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) (headers as Record<string, string>).Authorization = `Bearer ${session.access_token}`
  return fetch(url, { headers })
}

function fmtDate(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DataSourcesPage() {
  const router = useRouter()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authFetch('/api/data/sources')
      .then(async (res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json() })
      .then((d) => { if (!active) return; setSources(d.sources || []); setLoading(false) })
      .catch((e) => { if (!active) return; setErr(String(e.message || e)); setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: TEAL, marginBottom: 8 }}>Data</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 32, color: TEXT, margin: '0 0 4px' }}>Data Sources</h1>
          <p style={{ color: TEXT2, fontSize: 13, margin: 0 }}>Every spreadsheet, form, and system feeding the CFAC dashboards.</p>
        </div>
        <button onClick={() => router.push('/admin/data/import')}
          style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.Upload size={16} strokeWidth={2} /> Import data
        </button>
      </div>

      {loading && <div style={{ color: TEXT2 }}>Loading sources…</div>}
      {err && <div style={{ color: WARN }}>Couldn’t load sources: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {sources.map((s) => {
          const Icon = (Icons[KIND_ICON[s.kind] || 'Database'] || Icons.Database) as React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
          return (
            <div key={s.id} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Icon size={18} strokeWidth={1.5} color={TEAL} />
                <span style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>{s.name}</span>
              </div>
              {s.description && <div style={{ color: TEXT2, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>{s.description}</div>}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: TEXT2 }}>
                <span><strong style={{ color: TEXT }}>{s.metricCount}</strong> metrics</span>
                <span>{s.component || '—'}</span>
                <span style={{ textTransform: 'capitalize' }}>{s.kind}</span>
                <span>imported {fmtDate(s.lastImportedAt)}</span>
                {s.issueCount > 0 && <span style={{ color: WARN }}>{s.issueCount} issues</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

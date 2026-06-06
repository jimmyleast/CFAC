'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const WARN = '#E0846B'

type Source = { id: string; name: string; metricCount: number; issueCount: number; lastImportedAt: string | null }

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}

export default function DataIntegrityPage() {
  const router = useRouter()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    authFetch('/api/data/sources')
      .then(r => r.ok ? r.json() : { sources: [] })
      .then(d => { if (active) { setSources(d.sources || []); setLoading(false) } })
      .catch(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  const withIssues = sources.filter(s => s.issueCount > 0)
  const neverImported = sources.filter(s => !s.lastImportedAt)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <button onClick={() => router.push('/admin/data')} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <Icons.ArrowLeft size={14} /> Data Sources
      </button>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 28, color: TEXT, margin: '0 0 4px' }}>Data Integrity</h1>
      <p style={{ color: TEXT2, fontSize: 13, margin: '0 0 24px' }}>At-a-glance gaps — sources with import issues or no data yet — so you don’t comb every sheet.</p>

      {loading && <div style={{ color: TEXT2 }}>Checking…</div>}

      {!loading && (
        <>
          <Section title="Import issues" color={WARN} icon="ShieldAlert"
            empty="No flagged rows — every imported row mapped cleanly."
            items={withIssues.map(s => ({ name: s.name, detail: `${s.issueCount} rows flagged (missing/mismatch)` }))} />
          <Section title="Not yet imported" color={GOLD} icon="CircleDashed"
            empty="Every source has data."
            items={neverImported.map(s => ({ name: s.name, detail: 'no data imported yet' }))} />
        </>
      )}
    </div>
  )
}

function Section({ title, color, icon, items, empty }: { title: string; color: string; icon: keyof typeof Icons; items: { name: string; detail: string }[]; empty: string }) {
  const Icon = (Icons[icon] || Icons.Square) as React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon size={16} color={color} strokeWidth={1.5} />
        <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT2 }}>{title} ({items.length})</span>
      </div>
      {items.length === 0 ? (
        <div style={{ color: OK, fontSize: 13, paddingLeft: 24 }}>✓ {empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, i) => (
            <div key={i} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: TEXT, fontSize: 14 }}>{it.name}</span>
              <span style={{ color: TEXT2, fontSize: 12 }}>{it.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

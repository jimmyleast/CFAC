'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const UP = '#7DD3C7'
const DOWN = '#E0846B'

type Tile = {
  key: string; label: string; value: number; period: string
  priorValue: number | null; priorPeriod: string | null; deltaPct: number | null
  series: { period: string; value: number }[]
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: HeadersInit = {}
  if (session?.access_token) (headers as Record<string, string>).Authorization = `Bearer ${session.access_token}`
  return fetch(url, { headers })
}

function Sparkline({ series }: { series: { value: number }[] }) {
  if (series.length < 2) return null
  const vals = series.map(s => s.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const w = 120, h = 28, pad = 2
  const span = max - min || 1
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  )
}

function fmt(n: number) { return n.toLocaleString('en-US') }

export default function ExecutivePage() {
  const [tiles, setTiles] = useState<Tile[]>([])
  const [latestPeriod, setLatestPeriod] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authFetch('/api/executive/summary')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => { if (!active) return; setTiles(data.tiles || []); setLatestPeriod(data.latestPeriod || null); setLoading(false) })
      .catch((e) => { if (!active) return; setErr(String(e.message || e)); setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Executive</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 32, color: TEXT, margin: 0 }}>Executive Dashboard</h1>
        {latestPeriod && <span style={{ color: TEXT2, fontSize: 13 }}>Latest period: <strong style={{ color: TEXT }}>{latestPeriod}</strong></span>}
      </div>

      {loading && <div style={{ color: TEXT2, fontSize: 14 }}>Loading metrics…</div>}
      {err && <div style={{ color: DOWN, fontSize: 14 }}>Couldn’t load metrics: {err}</div>}
      {!loading && !err && !tiles.length && (
        <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: 32, color: TEXT2 }}>
          No metrics yet. Import data under <strong style={{ color: GOLD }}>Data</strong> to populate these tiles.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {tiles.map((t) => {
          const up = t.deltaPct !== null && t.deltaPct >= 0
          return (
            <div key={t.key} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
              <div style={{ color: TEXT2, fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>{t.label}</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, color: TEXT, lineHeight: 1 }}>{fmt(t.value)}</div>
                <Sparkline series={t.series} />
              </div>
              {t.deltaPct !== null && t.priorPeriod && (
                <div style={{ marginTop: 8, fontSize: 12, color: up ? UP : DOWN }}>
                  {up ? '▲' : '▼'} {Math.abs(t.deltaPct)}% <span style={{ color: TEXT2 }}>vs {t.priorPeriod}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

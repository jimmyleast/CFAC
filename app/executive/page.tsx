'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { askHope } from '@/lib/hope/ask'

const GOLD = '#5BA3D9'
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

type Impact = {
  key: string; label: string; definition: string; isDedup: boolean
  mapped: boolean; value: number | null; period: string | null
  sources: { key: string; agg: string; value: number | null }[]
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
  const router = useRouter()
  const [tiles, setTiles] = useState<Tile[]>([])
  const [impact, setImpact] = useState<Impact[]>([])
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
    // Impact metrics load independently (computed from mappings).
    authFetch('/api/impact/summary')
      .then((res) => (res.ok ? res.json() : { impact: [] }))
      .then((data) => { if (active) setImpact(data.impact || []) })
      .catch(() => { if (active) setImpact([]) })
    return () => { active = false }
  }, [])

  async function downloadCsv() {
    const res = await authFetch('/api/export/metrics')
    if (!res.ok) { setErr(`Export failed (${res.status})`); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cfac-metrics-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Executive</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 32, color: TEXT, margin: 0 }}>Executive Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {latestPeriod && <span style={{ color: TEXT2, fontSize: 13 }}>Latest period: <strong style={{ color: TEXT }}>{latestPeriod}</strong></span>}
          <button onClick={() => askHope('Build me a custom report from CFAC data. Ask me what to include if you need to.')}
            style={{ background: 'rgba(91,163,217,0.12)', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ✦ Ask Hope to build a report
          </button>
          <button onClick={() => router.push('/export/board')}
            style={{ background: 'none', border: `1px solid ${LINE}`, color: TEXT2, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Board report
          </button>
          <button onClick={() => downloadCsv()}
            style={{ background: 'none', border: `1px solid ${LINE}`, color: TEXT2, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Impact row — the three headline metrics, COMPUTED from Metric Mappings */}
      {impact.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
          {impact.map((m) => (
            <div key={m.key} title={`${m.definition}\n\nClick to ask Hope`} onClick={() => askHope(`Break down "${m.label}" — how it's computed, the trend, and what's behind the change. Use only CFAC data.`)}
              style={{ background: 'linear-gradient(180deg, rgba(91,163,217,0.07), rgba(255,255,255,0.02))', border: `1px solid ${GOLD}44`, borderRadius: 12, padding: '18px 20px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ color: GOLD, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>{m.label}</span>
                {m.isDedup && <span style={{ fontSize: 9, color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>unique</span>}
              </div>
              {m.mapped && m.value !== null ? (
                <>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 38, color: TEXT, lineHeight: 1 }}>{fmt(m.value)}</div>
                  <div style={{ fontSize: 11, color: TEXT2, marginTop: 8 }}>
                    {m.period ? `${m.period} · ` : ''}{m.sources.length} source{m.sources.length === 1 ? '' : 's'}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: TEXT2, fontStyle: 'italic', paddingTop: 6 }}>
                  Not yet mapped — set its source in <strong style={{ color: GOLD }}>Definitions → Mapping</strong>.
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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
            <div key={t.key} onClick={() => router.push(`/metric/${encodeURIComponent(t.key)}`)} title="Click to drill in"
              style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, cursor: 'pointer', transition: 'border-color 120ms' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = GOLD)} onMouseLeave={(e) => (e.currentTarget.style.borderColor = LINE)}>
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

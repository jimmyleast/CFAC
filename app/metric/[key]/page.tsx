'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { askHope } from '@/lib/hope/ask'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const UP = '#7DD3C7'
const DOWN = '#E0846B'

type Detail = {
  key: string; found: boolean; label: string
  value: number; period: string; priorValue: number | null; priorPeriod: string | null; deltaPct: number | null
  series: { period: string; value: number }[]
  sources: string[]; feedsInto: string[]
  definition: { key: string; display_name: string; definition: string } | null
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}
const fmt = (n: number) => n.toLocaleString('en-US')

function Chart({ series }: { series: { period: string; value: number }[] }) {
  if (series.length < 2) return <div style={{ color: TEXT4, fontSize: 13 }}>Not enough history to chart.</div>
  const vals = series.map((s) => s.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const w = 720, h = 220, padX = 8, padY = 16
  const span = max - min || 1
  const x = (i: number) => padX + (i / (series.length - 1)) * (w - padX * 2)
  const y = (v: number) => h - padY - ((v - min) / span) * (h - padY * 2)
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <polyline points={pts} fill="none" stroke={GOLD} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(s.value)} r={3} fill={GOLD} />
          <text x={x(i)} y={h - 2} fill={TEXT4} fontSize={10} textAnchor="middle">{s.period}</text>
        </g>
      ))}
    </svg>
  )
}

export default function MetricDetailPage() {
  const params = useParams()
  const router = useRouter()
  const key = String(params?.key || '')
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authFetch(`/api/metrics/${encodeURIComponent(key)}`)
      .then(async (r) => { if (r.status === 404) return { notFound: true }; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => { if (!active) return; if (data.notFound || data.found === false) setErr('No data for this metric.'); else setD(data); setLoading(false) })
      .catch((e) => { if (active) { setErr(String(e.message || e)); setLoading(false) } })
    return () => { active = false }
  }, [key])

  const up = (d?.deltaPct ?? 0) >= 0

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px' }}>
      <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <Icons.ArrowLeft size={14} /> Back
      </button>

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: DOWN }}>{err}</div>}

      {d && (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Metric</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 8px' }}>{d.label}</h1>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 20 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 44, color: TEXT, lineHeight: 1 }}>{fmt(d.value)}</span>
            <span style={{ color: TEXT2, fontSize: 14 }}>{d.period}</span>
            {d.deltaPct !== null && d.priorPeriod && (
              <span style={{ color: up ? UP : DOWN, fontSize: 15, fontWeight: 600 }}>{up ? '▲' : '▼'} {Math.abs(d.deltaPct)}% <span style={{ color: TEXT2, fontWeight: 400 }}>vs {d.priorPeriod}</span></span>
            )}
          </div>

          <div style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <Chart series={d.series} />
          </div>

          {/* Ask Hope — go deeper / build a custom report */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
            <button onClick={() => askHope(`Tell me about "${d.label}" — the trend over time, what might be driving the change, and anything concerning. Use only CFAC data.`)}
              style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Ask Hope about this
            </button>
            <button onClick={() => askHope(`Build me a report on "${d.label}" — show the trend and compare the last two years.`)}
              style={{ background: 'rgba(91,163,217,0.12)', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Ask Hope to build a report
            </button>
          </div>

          {d.definition && (
            <Section title="Definition">
              <p style={{ color: '#D7D3CC', fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>{d.definition.definition}</p>
            </Section>
          )}

          <Section title="Where this comes from">
            <div style={{ fontSize: 13, color: TEXT2, lineHeight: 1.7 }}>
              <div>Source{d.sources.length === 1 ? '' : 's'}: <span style={{ color: TEXT }}>{d.sources.join(', ') || '—'}</span></div>
              {d.feedsInto.length > 0 && <div>Rolls up into: <span style={{ color: TEXT }}>{d.feedsInto.join(', ')}</span></div>}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: TEXT4, marginTop: 4 }}>{d.key}</div>
            </div>
          </Section>

          <Section title="History">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {[...d.series].reverse().map((s) => (
                <div key={s.period} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: TEXT2 }}>{s.period}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{fmt(s.value)}</div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: TEXT2, marginBottom: 10, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  )
}

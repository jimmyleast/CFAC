'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Pinwheel from '@/components/Pinwheel'

const NAVY = '#1E3A8A'
const BLUE = '#5BA3D9'
const INK = '#1A2230'
const MUTE = '#5B6472'
const LINE = '#E2E6EC'

type Tile = { key: string; label: string; value: number; period: string; priorPeriod: string | null; deltaPct: number | null }
type Impact = { key: string; label: string; mapped: boolean; value: number | null; period: string | null }

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}
const fmt = (n: number) => n.toLocaleString('en-US')

export default function BoardReportPage() {
  const [tiles, setTiles] = useState<Tile[]>([])
  const [impact, setImpact] = useState<Impact[]>([])
  const [period, setPeriod] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([
      authFetch('/api/executive/summary').then((r) => (r.ok ? r.json() : { tiles: [] })),
      authFetch('/api/impact/summary').then((r) => (r.ok ? r.json() : { impact: [] })),
    ]).then(([s, i]) => {
      if (!active) return
      setTiles(s.tiles || []); setPeriod(s.latestPeriod || null); setImpact(i.impact || []); setLoading(false)
    }).catch(() => active && setLoading(false))
    return () => { active = false }
  }, [])

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: INK }}>
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } }`}</style>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 32px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <button onClick={() => window.print()} style={{ background: NAVY, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save as PDF</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: `2px solid ${NAVY}`, paddingBottom: 16, marginBottom: 24 }}>
          <Pinwheel size={44} />
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, color: NAVY, letterSpacing: '0.04em' }}>CFAC</div>
            <div style={{ fontSize: 12, color: MUTE }}>Children &amp; Family Advocacy Center · Impact Report</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12, color: MUTE }}>
            <div>{today}</div>{period && <div>Reporting period: <strong style={{ color: INK }}>{period}</strong></div>}
          </div>
        </div>

        {loading ? <div style={{ color: MUTE }}>Loading…</div> : (
          <>
            {impact.filter((m) => m.mapped && m.value !== null).length > 0 && (
              <>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 15, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>Organizational Impact</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 28 }}>
              {impact.filter((m) => m.mapped && m.value !== null).map((m) => (
                <div key={m.key} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '16px 18px', background: '#F7FAFD' }}>
                  <div style={{ fontSize: 11, color: BLUE, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 8 }}>{m.label}</div>
                  <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, color: INK }}>{fmt(m.value as number)}</div>
                  {m.period && <div style={{ fontSize: 11, color: MUTE, marginTop: 4 }}>{m.period}</div>}
                </div>
              ))}
            </div>
              </>
            )}

            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 15, color: NAVY, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>Key Metrics</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${LINE}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: MUTE, fontWeight: 600 }}>Metric</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: MUTE, fontWeight: 600 }}>{period || 'Latest'}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: MUTE, fontWeight: 600 }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {tiles.map((t) => (
                  <tr key={t.key} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={{ padding: '8px 6px', color: INK }}>{t.label}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: INK }}>{fmt(t.value)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: t.deltaPct === null ? MUTE : t.deltaPct >= 0 ? '#1A8A5A' : '#C2410C' }}>
                      {t.deltaPct === null || !t.priorPeriod ? '—' : `${t.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(t.deltaPct)}% vs ${t.priorPeriod}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid ${LINE}`, fontSize: 11, color: MUTE }}>
              Generated from CFAC&apos;s data platform. Figures are aggregate; every value traces to its source definition.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

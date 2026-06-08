'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Pinwheel from '@/components/Pinwheel'

type Tile = { key: string; label: string; value: number; period: string; priorPeriod: string | null; deltaPct: number | null }
type Impact = { key: string; label: string; mapped: boolean; value: number | null; period: string | null }

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}
const fmt = (n: number) => n.toLocaleString('en-US')

export default function BoardReportPage() {
  const router = useRouter()
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
  const mappedImpact = impact.filter((m) => m.mapped && m.value !== null)

  // Themeable via CSS vars: dark to match the app on screen, light/ink for print.
  return (
    <div className="board-root" style={{ minHeight: '100vh', background: 'var(--b-bg)', color: 'var(--b-ink)' }}>
      <style>{`
        .board-root {
          --b-bg: #0A0A0A; --b-panel: rgba(255,255,255,0.025); --b-ink: #F0EDE6;
          --b-mute: #8A8680; --b-line: #2A2A2A; --b-accent: #5BA3D9; --b-accent2: #7DD3C7;
          --b-up: #1E9E6A; --b-down: #E0846B;
        }
        @media print {
          .no-print { display: none !important; }
          @page { margin: 16mm; }
          .board-root {
            --b-bg: #ffffff; --b-panel: #F7FAFD; --b-ink: #1A2230;
            --b-mute: #5B6472; --b-line: #E2E6EC; --b-accent: #1E3A8A; --b-accent2: #1E3A8A;
            --b-up: #1A8A5A; --b-down: #C2410C;
          }
          .board-root { background: #fff !important; }
        }
      `}</style>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button onClick={() => { if (window.history.length > 1) router.back(); else router.push('/executive') }}
            style={{ background: 'none', border: '1px solid var(--b-line)', color: 'var(--b-mute)', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={() => window.print()} style={{ background: 'var(--b-accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Print / Save as PDF</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderBottom: `2px solid var(--b-accent)`, paddingBottom: 16, marginBottom: 24 }}>
          <Pinwheel size={44} />
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 24, color: 'var(--b-accent)', letterSpacing: '0.04em' }}>CFAC</div>
            <div style={{ fontSize: 12, color: 'var(--b-mute)' }}>Children &amp; Family Advocacy Center · Impact Report</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12, color: 'var(--b-mute)' }}>
            <div>{today}</div>{period && <div>Reporting period: <strong style={{ color: 'var(--b-ink)' }}>{period}</strong></div>}
          </div>
        </div>

        {loading ? <div style={{ color: 'var(--b-mute)' }}>Loading…</div> : (
          <>
            {mappedImpact.length > 0 && (
              <>
                <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 15, color: 'var(--b-accent)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>Organizational Impact</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 28 }}>
                  {mappedImpact.map((m) => (
                    <div key={m.key} style={{ border: `1px solid var(--b-line)`, borderRadius: 10, padding: '16px 18px', background: 'var(--b-panel)' }}>
                      <div style={{ fontSize: 11, color: 'var(--b-accent2)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 8 }}>{m.label}</div>
                      <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, color: 'var(--b-ink)' }}>{fmt(m.value as number)}</div>
                      {m.period && <div style={{ fontSize: 11, color: 'var(--b-mute)', marginTop: 4 }}>{m.period}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 15, color: 'var(--b-accent)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>Key Metrics</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid var(--b-line)` }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--b-mute)', fontWeight: 600 }}>Metric</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--b-mute)', fontWeight: 600 }}>{period || 'Latest'}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--b-mute)', fontWeight: 600 }}>Change</th>
                </tr>
              </thead>
              <tbody>
                {tiles.map((t) => (
                  <tr key={t.key} style={{ borderBottom: `1px solid var(--b-line)` }}>
                    <td style={{ padding: '8px 6px', color: 'var(--b-ink)' }}>{t.label}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, color: 'var(--b-ink)' }}>{fmt(t.value)}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: t.deltaPct === null ? 'var(--b-mute)' : t.deltaPct >= 0 ? 'var(--b-up)' : 'var(--b-down)' }}>
                      {t.deltaPct === null || !t.priorPeriod ? '—' : `${t.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(t.deltaPct)}% vs ${t.priorPeriod}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid var(--b-line)`, fontSize: 11, color: 'var(--b-mute)' }}>
              Generated from CFAC&apos;s data platform. Figures are aggregate; every value traces to its source definition.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

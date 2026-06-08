'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const WARN = '#E0846B'

type TabMetric = { metricKey: string; label: string; period: string | null; value: number; unit: string | null }
type WorkbookTab = { name: string; metrics: TabMetric[] }
type WorkbookReport = { sourceName: string; sourceSlug: string; tabs: WorkbookTab[] }

async function token() {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || ''
}

function fmt(value: number, unit: string | null) {
  if (unit === 'usd') return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  if (unit === 'percent') return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

export default function ReportsPage() {
  const [reports, setReports] = useState<WorkbookReport[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [sourceSlug, setSourceSlug] = useState('')
  const [tabName, setTabName] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/reports/workbooks', { headers: { Authorization: `Bearer ${await token()}` } })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
        setReports(body.reports || [])
      } catch (error) {
        setErr(error instanceof Error ? error.message : 'Failed to load reports')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const activeReport = useMemo(() => reports.find((r) => r.sourceSlug === sourceSlug) || reports[0] || null, [reports, sourceSlug])
  const activeTab = useMemo(() => activeReport?.tabs.find((t) => t.name === tabName) || activeReport?.tabs[0] || null, [activeReport, tabName])

  useEffect(() => {
    if (activeReport && sourceSlug !== activeReport.sourceSlug) setSourceSlug(activeReport.sourceSlug)
    if (activeTab && tabName !== activeTab.name) setTabName(activeTab.name)
  }, [activeReport, activeTab, sourceSlug, tabName])

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '36px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Reports</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Workbook reports</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.55, margin: '0 0 20px', maxWidth: 780 }}>
        Recreated from CFAC workbook and dashboard tabs for review. Values come from the aggregate metrics layer; client-detail tabs are represented by their dashboard and summary outputs until covered PHI storage is ready.
      </p>

      {loading && <div style={{ color: TEXT2 }}>Loading...</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}
      {!loading && !err && !reports.length && <div style={{ color: TEXT4 }}>No workbook metrics loaded yet.</div>}

      {activeReport && activeTab && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'start' }}>
          <aside style={{ flex: '1 1 240px', maxWidth: 300, background: BG2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: TEXT4, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Workbooks</div>
            {reports.map((r) => (
              <button key={r.sourceSlug} onClick={() => { setSourceSlug(r.sourceSlug); setTabName(r.tabs[0]?.name || '') }}
                style={{ width: '100%', textAlign: 'left', background: r.sourceSlug === activeReport.sourceSlug ? 'rgba(91,163,217,0.18)' : 'transparent', border: `1px solid ${r.sourceSlug === activeReport.sourceSlug ? GOLD : 'transparent'}`, color: r.sourceSlug === activeReport.sourceSlug ? TEXT : TEXT2, borderRadius: 7, padding: '9px 10px', marginBottom: 4, cursor: 'pointer', fontSize: 13 }}>
                {r.sourceName}
                <span style={{ color: TEXT4, display: 'block', fontSize: 11, marginTop: 2 }}>{r.tabs.length} tab{r.tabs.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </aside>

          <main style={{ flex: '999 1 520px', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              <div>
                <h2 style={{ color: TEXT, fontSize: 22, margin: 0 }}>{activeReport.sourceName}</h2>
                <div style={{ color: OK, fontSize: 12, marginTop: 4 }}>{activeTab.metrics.length} aggregate row{activeTab.metrics.length === 1 ? '' : 's'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {activeReport.tabs.map((t) => (
                  <button key={t.name} onClick={() => setTabName(t.name)}
                    style={{ background: t.name === activeTab.name ? GOLD : 'transparent', color: t.name === activeTab.name ? '#0D0D0F' : TEXT2, border: `1px solid ${t.name === activeTab.name ? GOLD : LINE}`, borderRadius: 7, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 8, background: BG2 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
                <thead>
                  <tr style={{ color: TEXT4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${LINE}` }}>Metric / row</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${LINE}` }}>Period</th>
                    <th style={{ textAlign: 'right', padding: '10px 12px', borderBottom: `1px solid ${LINE}` }}>Value</th>
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `1px solid ${LINE}` }}>Key</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTab.metrics.map((m, i) => (
                    <tr key={`${m.metricKey}-${m.period}-${i}`} style={{ color: TEXT2, fontSize: 13 }}>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${LINE}` }}>{m.label}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${LINE}`, color: TEXT4 }}>{m.period || 'none'}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${LINE}`, textAlign: 'right', color: TEXT }}>{fmt(m.value, m.unit)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: `1px solid ${LINE}`, color: TEXT4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{m.metricKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      )}
    </div>
  )
}

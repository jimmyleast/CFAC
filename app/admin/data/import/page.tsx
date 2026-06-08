'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const WARN = '#E0846B'

async function token() {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || ''
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`,
  borderRadius: 8, padding: '10px 12px', color: TEXT, fontSize: 14, colorScheme: 'dark',
}
const optionStyle: React.CSSProperties = { background: '#141416', color: TEXT }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: TEXT2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }

export default function DataImportPage() {
  const router = useRouter()
  const [sources, setSources] = useState<{ slug: string; name: string }[]>([])
  const [sourceSlug, setSourceSlug] = useState('')
  const [periodColumn, setPeriodColumn] = useState('')
  const [periodLabel, setPeriodLabel] = useState('')
  const [sheet, setSheet] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const [fromConnect, setFromConnect] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/data/sources', { headers: { Authorization: `Bearer ${await token()}` } })
      if (res.ok) {
        const d = await res.json()
        const list = (d.sources || []).map((s: any) => ({ slug: s.slug, name: s.name }))
        setSources(list)
        // Pre-select when arriving from the connect portal (?source=slug).
        const pre = new URLSearchParams(window.location.search).get('source')
        if (pre) setFromConnect(true)
        if (pre && list.some((s: { slug: string }) => s.slug === pre)) setSourceSlug(pre)
      }
    })()
  }, [])

  async function submit() {
    setErr(null); setResult(null)
    const file = fileRef.current?.files?.[0]
    if (!file) { setErr('Choose a file first.'); return }
    if (!sourceSlug) { setErr('Pick a data source.'); return }
    if (!ack) { setErr('Please confirm this file contains aggregate, non-PHI data.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('sourceSlug', sourceSlug)
      if (periodColumn) fd.append('periodColumn', periodColumn)
      if (periodLabel) fd.append('periodLabel', periodLabel)
      if (sheet) fd.append('sheet', sheet)
      const res = await fetch('/api/data/import', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: fd })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      setResult(d)
    } catch (e: any) { setErr(String(e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      <button onClick={() => router.push('/admin/data')} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <Icons.ArrowLeft size={14} /> Data Sources
      </button>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 28, color: TEXT, margin: '0 0 4px' }}>Import data</h1>
      <p style={{ color: TEXT2, fontSize: 13, margin: '0 0 24px', lineHeight: 1.5 }}>
        Upload a spreadsheet (.xlsx) or CSV. Each numeric column becomes a metric; a Year/Month/Date column is used as the period.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 20 }}>
        <div>
          <label style={labelStyle}>Data source</label>
          <select value={sourceSlug} onChange={e => setSourceSlug(e.target.value)} style={inputStyle}>
            <option value="">— select —</option>
            {sources.map(s => <option key={s.slug} value={s.slug} style={optionStyle}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>File (.xlsx / .csv)</label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Period column (optional)</label>
            <input value={periodColumn} onChange={e => setPeriodColumn(e.target.value)} placeholder="auto: Year/Month/Date" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Sheet (optional)</label>
            <input value={sheet} onChange={e => setSheet(e.target.value)} placeholder="first sheet" style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Period label (if no period column)</label>
          <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} placeholder="e.g. 2026" style={inputStyle} />
        </div>
        <div style={{ background: 'rgba(224,132,107,0.08)', border: `1px solid ${WARN}55`, borderRadius: 8, padding: '12px 14px' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ marginTop: 3 }} />
            <span style={{ fontSize: 12.5, color: TEXT2, lineHeight: 1.5 }}>
              I confirm this file contains <strong style={{ color: TEXT }}>aggregate, non-PHI</strong> data. Case-level exports (Collaborate client data, MDT, forensic/medical/mental-health records) must <strong style={{ color: WARN }}>not</strong> be uploaded until the HIPAA infrastructure is in place.
            </span>
          </label>
        </div>
        <button onClick={submit} disabled={busy || !ack}
          style={{ background: busy || !ack ? 'rgba(91,163,217,0.4)' : GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '12px', fontWeight: 600, fontSize: 14, cursor: busy || !ack ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Importing…' : 'Import'}
        </button>
        {fromConnect && result && (
          <button onClick={() => router.push('/admin/connections')} style={{ background: 'none', border: `1px solid ${LINE}`, color: GOLD, borderRadius: 8, padding: '10px', fontSize: 13, cursor: 'pointer' }}>← Back to Connections</button>
        )}
        {err && <div style={{ color: WARN, fontSize: 13 }}>{err}</div>}
        {result && (
          <div style={{ color: OK, fontSize: 13, lineHeight: 1.6, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            ✓ Imported <strong>{result.metricsInserted}</strong> metrics from <strong>{result.rowsParsed}</strong> rows.<br />
            Period column: <strong style={{ color: TEXT }}>{result.periodColumn || '(label) ' + (periodLabel || 'none')}</strong><br />
            Metrics: <span style={{ color: TEXT2 }}>{(result.metricKeys || []).join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  )
}

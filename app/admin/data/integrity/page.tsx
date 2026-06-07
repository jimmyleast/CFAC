'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const WARN = '#E0846B'
const ERR = '#EB5757'

type Exception = {
  rule: string; severity: 'error' | 'warning'
  sourceName: string | null; metricKey: string | null; fieldRef: string | null; message: string
}
type Summary = { total: number; errors: number; warnings: number; byRule: Record<string, number>; scanIncomplete?: boolean; scannedRows?: number; totalRows?: number }

const RULE_LABELS: Record<string, string> = {
  duplicate_metric: 'Duplicates', missing_value: 'Missing values', inconsistent_label: 'Definition drift',
  stale_source: 'Stale sources', unmapped_impact: 'Unmapped impact', value_outlier: 'Possible keying errors',
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}

export default function DataIntegrityPage() {
  const router = useRouter()
  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authFetch('/api/data/exceptions')
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { if (active) { setExceptions(d.exceptions || []); setSummary(d.summary || null); setLoading(false) } })
      .catch((e) => { if (active) { setErr(String(e.message || e)); setLoading(false) } })
    return () => { active = false }
  }, [])

  const errors = exceptions.filter((e) => e.severity === 'error')
  const warnings = exceptions.filter((e) => e.severity === 'warning')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <button onClick={() => router.push('/admin/data')} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <Icons.ArrowLeft size={14} /> Data Sources
      </button>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 28, color: TEXT, margin: '0 0 4px' }}>Data Integrity</h1>
      <p style={{ color: TEXT2, fontSize: 13, margin: '0 0 24px' }}>Automated checks across the data layer — duplicates, gaps, definition drift, staleness, and likely keying errors — so you don’t comb every sheet.</p>

      {loading && <div style={{ color: TEXT2 }}>Checking…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      {!loading && !err && summary && (
        <>
          {summary.scanIncomplete && (
            <div style={{ color: ERR, fontSize: 13, padding: '10px 14px', border: `1px solid ${ERR}55`, borderRadius: 8, background: 'rgba(235,87,87,0.06)', marginBottom: 16 }}>
              ⚠ Partial scan — checked {summary.scannedRows?.toLocaleString()} of {summary.totalRows?.toLocaleString()} rows. Results may be incomplete.
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Stat label="Errors" value={summary.errors} color={summary.errors ? ERR : OK} />
            <Stat label="Warnings" value={summary.warnings} color={summary.warnings ? WARN : OK} />
            <Stat label="Total flags" value={summary.total} color={summary.total ? GOLD : OK} />
          </div>

          {summary.total === 0 && (
            <div style={{ color: OK, fontSize: 14, padding: '14px 16px', border: `1px solid ${OK}44`, borderRadius: 10, background: 'rgba(125,211,199,0.06)' }}>
              ✓ No issues detected — every metric mapped cleanly, no duplicates or gaps.
            </div>
          )}

          <ExGroup title="Errors" color={ERR} icon="OctagonAlert" items={errors} />
          <ExGroup title="Warnings" color={WARN} icon="TriangleAlert" items={warnings} />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 18px', minWidth: 110 }}>
      <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT2, marginTop: 6 }}>{label}</div>
    </div>
  )
}

function ExGroup({ title, color, icon, items }: { title: string; color: string; icon: keyof typeof Icons; items: Exception[] }) {
  const Icon = (Icons[icon] || Icons.Square) as React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  if (!items.length) return null
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon size={16} color={color} strokeWidth={1.5} />
        <span style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT2 }}>{title} ({items.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it, i) => (
          <div key={i} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', color, border: `1px solid ${color}55`, borderRadius: 4, padding: '1px 6px' }}>{RULE_LABELS[it.rule] || it.rule}</span>
              {it.sourceName && <span style={{ fontSize: 11, color: TEXT4 }}>{it.sourceName}</span>}
            </div>
            <div style={{ color: TEXT, fontSize: 13.5, lineHeight: 1.5 }}>{it.message}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

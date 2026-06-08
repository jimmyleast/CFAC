'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { CFAC_COMPONENTS } from '@/lib/nav-config'

const GOLD = '#5BA3D9'
const TEAL = '#7DD3C7'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const WARN = '#E0846B'

type Source = {
  id: string; name: string; slug: string; kind: string; description: string | null
  lastImportedAt: string | null; metricCount: number; issueCount: number
}

type Tile = {
  key: string; label: string; value: number; period: string
  priorValue: number | null; priorPeriod: string | null; deltaPct: number | null
}
type OpsBreakdown = { label: string; value: number }
type OpsSummary = {
  period: string | null
  totals: Record<string, number>
  maintenance: { byType: OpsBreakdown[]; byPriority: OpsBreakdown[]; byStatus: OpsBreakdown[] }
  fleet: { byVehicleType: OpsBreakdown[]; byPurpose: OpsBreakdown[] }
}

const SUCCESS = '#7DD3C7'
const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 }))

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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ComponentPage() {
  const params = useParams()
  const router = useRouter()
  const slug = String(params?.slug || '')
  const meta = CFAC_COMPONENTS.find((c) => c.slug === slug)
  const label = meta?.label || slug
  const Icon = (Icons[(meta?.icon as keyof typeof Icons) || 'Folder'] || Icons.Folder) as React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>

  const [sources, setSources] = useState<Source[]>([])
  const [tiles, setTiles] = useState<Tile[]>([])
  const [ops, setOps] = useState<OpsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authFetch(`/api/data/sources?component=${encodeURIComponent(slug)}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { if (active) { setSources(d.sources || []); setLoading(false) } })
      .catch((e) => { if (active) { setErr(String(e.message || e)); setLoading(false) } })
    // KPI tiles load independently — a metrics hiccup must not blank the sources list.
    authFetch(`/api/components/${encodeURIComponent(slug)}/summary`)
      .then(async (r) => (r.ok ? r.json() : { tiles: [] }))
      .then((d) => { if (active) setTiles(d.tiles || []) })
      .catch(() => { if (active) setTiles([]) })
    if (slug === 'operations') {
      authFetch('/api/operations/summary')
        .then(async (r) => (r.ok ? r.json() : null))
        .then((d) => { if (active) setOps(d) })
        .catch(() => { if (active) setOps(null) })
    } else {
      setOps(null)
    }
    return () => { active = false }
  }, [slug])

  const totalMetrics = sources.reduce((n, s) => n + s.metricCount, 0)

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Component</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <Icon size={26} strokeWidth={1.5} color={GOLD} />
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: 0 }}>{label}</h1>
      </div>
      <p style={{ color: TEXT2, fontSize: 13, margin: '0 0 24px' }}>
        {sources.length} data source{sources.length === 1 ? '' : 's'} · {totalMetrics} metrics
      </p>

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      {!loading && sources.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: TEXT2, margin: '4px 0 12px' }}>Key Metrics</div>
          {slug === 'operations' && ops && (
            <OperationsSummary summary={ops} />
          )}
          {tiles.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
              {tiles.map((t) => {
                const up = (t.deltaPct ?? 0) >= 0
                return (
                  <div key={t.key} onClick={() => router.push(`/metric/${encodeURIComponent(t.key)}`)} title="Click to drill in"
                    style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}>
                    <div style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT2, marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.label}</div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 26, color: TEXT, lineHeight: 1 }}>{fmtNum(t.value)}</div>
                    <div style={{ fontSize: 11, color: TEXT2, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{t.period}</span>
                      {t.deltaPct !== null && t.priorPeriod && (
                        <span style={{ color: up ? SUCCESS : WARN, fontWeight: 600 }}>{up ? '▲' : '▼'} {Math.abs(t.deltaPct)}%</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ color: TEXT4, fontSize: 13, fontStyle: 'italic', marginBottom: 28 }}>
              No metrics imported yet — <button onClick={() => router.push('/admin/data/import')} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>import data</button> to populate this dashboard.
            </div>
          )}
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: TEXT2, margin: '4px 0 12px' }}>Data Sources</div>
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {sources.map((s) => {
          const KIcon = (Icons[KIND_ICON[s.kind] || 'Database'] || Icons.Database) as React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
          return (
            <div key={s.id} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <KIcon size={18} strokeWidth={1.5} color={TEAL} />
                <span style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>{s.name}</span>
              </div>
              {s.description && <div style={{ color: TEXT2, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>{s.description}</div>}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: TEXT2 }}>
                <span><strong style={{ color: TEXT }}>{s.metricCount}</strong> metrics</span>
                <span style={{ textTransform: 'capitalize' }}>{s.kind}</span>
                <span>imported {fmtDate(s.lastImportedAt)}</span>
                {s.issueCount > 0 && <span style={{ color: WARN }}>{s.issueCount} issues</span>}
              </div>
            </div>
          )
        })}
        {!loading && !sources.length && !err && (
          <div style={{ color: TEXT4, fontStyle: 'italic' }}>
            No data sources for {label} yet. <button onClick={() => router.push('/admin/data/import')} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13 }}>Import data</button>.
          </div>
        )}
      </div>
    </div>
  )
}

function SmallBarList({ title, rows }: { title: string; rows: OpsBreakdown[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: TEXT2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.slice(0, 5).map((r) => (
          <div key={r.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: TEXT }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ color: TEXT2 }}>{fmtNum(r.value)}</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 3 }}>
              <div style={{ height: 4, width: `${Math.max(4, (r.value / max) * 100)}%`, background: TEAL, borderRadius: 2 }} />
            </div>
          </div>
        ))}
        {!rows.length && <div style={{ color: TEXT4, fontSize: 12, fontStyle: 'italic' }}>No breakdown yet.</div>}
      </div>
    </div>
  )
}

function OperationsSummary({ summary }: { summary: OpsSummary }) {
  const t = summary.totals
  return (
    <div style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>Operations Snapshot</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>{summary.period || 'latest period'}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <MiniStat label="Requests" value={t.maintenance_requests_total || 0} />
        <MiniStat label="On Time" value={t.maintenance_on_time_yes || 0} />
        <MiniStat label="Trips" value={t.fleet_trips_total || 0} />
        <MiniStat label="Miles" value={t.fleet_miles_driven || 0} />
        <MiniStat label="Costs" value={t.maintenance_actual_cost || 0} prefix="$" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
        <SmallBarList title="Request Type" rows={summary.maintenance.byType} />
        <SmallBarList title="Priority" rows={summary.maintenance.byPriority} />
        <SmallBarList title="Vehicle" rows={summary.fleet.byVehicleType} />
        <SmallBarList title="Purpose" rows={summary.fleet.byPurpose} />
      </div>
    </div>
  )
}

function MiniStat({ label, value, prefix = '' }: { label: string; value: number; prefix?: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 10, color: TEXT2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 700, color: TEXT }}>{prefix}{fmtNum(value)}</div>
    </div>
  )
}

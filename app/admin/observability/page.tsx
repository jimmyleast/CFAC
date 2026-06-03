'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

// ───── tokens ─────
const BG2 = '#111111'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT3 = '#555250'
const GOLD = '#C9A84C'
const SUCCESS = '#059669'
const CRITICAL = '#DC2626'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'

type ObservabilityPayload = {
  range: { days: number; since: string }
  status?: 'ok' | 'degraded'
  note?: string | null
  summary: {
    totalEvents: number
    morganRequests: number
    morganErrors: number
    exportsCompleted: number
    processesCreated: number
    avgLatencyMs: number
    p95LatencyMs: number
    errorRatePct: number
  }
  funnel: {
    processCreated: number
    morganStarted: number
    exportCompleted: number
  }
  daily: Array<{ day: string; requests: number; errors: number; exports: number; created: number }>
  topErrors: Array<{ message: string; count: number }>
  recent: Array<{
    id: string
    event_name: string
    category: string
    route: string | null
    status: string | null
    duration_ms: number | null
    created_at: string
  }>
}

export default function ObservabilityPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [days, setDays] = useState(7)
  const [payload, setPayload] = useState<ObservabilityPayload | null>(null)

  const load = useCallback(async (windowDays: number) => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch(`/api/admin/observability?days=${windowDays}`)
      if (res.status === 401) { router.replace('/auth/login'); return }
      if (res.status === 403) { setAccessDenied(true); return }
      if (!res.ok) {
        const message = await res.json().then((data: { error?: string }) => data.error).catch(() => '')
        setLoadError(message || 'Failed to load observability metrics.')
        return
      }
      setPayload((await res.json()) as ObservabilityPayload)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load observability metrics.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { void load(days) }, [days, load])

  const conversionRate = useMemo(() => {
    if (!payload?.funnel.processCreated) return 0
    return Math.round((payload.funnel.exportCompleted / payload.funnel.processCreated) * 100)
  }, [payload])

  if (accessDenied) {
    return (
      <div style={{ padding: 60, color: TEXT2, textAlign: 'center' }}>
        <p>Admin access required.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 28px 100px', color: TEXT, fontFamily: 'var(--font-body)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Tools</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36, letterSpacing: '0.02em', textTransform: 'uppercase', margin: 0, lineHeight: 1.05 }}>Observability</h1>
          <p style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
            In-app telemetry for Morgan reliability, funnel progression, and export outcomes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[1, 7, 14, 30].map((option) => (
            <button key={option} onClick={() => setDays(option)} style={{
              background: days === option ? BG2 : 'transparent',
              color: days === option ? TEXT : TEXT2,
              border: `1px solid ${days === option ? LINE2 : 'transparent'}`,
              padding: '8px 14px',
              fontFamily: 'var(--font-heading)', fontSize: 12, fontWeight: 600,
              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
            }}>{option}d</button>
          ))}
        </div>
      </div>

      {payload?.status === 'degraded' && payload.note && (
        <div style={{
          marginBottom: 16, border: `1px solid ${GOLD}`,
          background: 'rgba(201,168,76,0.08)', color: GOLD,
          padding: '10px 14px', fontSize: 12, fontFamily: 'var(--font-mono)',
          borderLeft: `2px solid ${GOLD}`,
        }}>
          {payload.note}
        </div>
      )}

      {loadError && (
        <div style={{
          marginBottom: 16, border: `1px solid rgba(220,38,38,0.4)`,
          background: 'rgba(220,38,38,0.08)', color: '#FCA5A5',
          padding: '10px 14px', fontSize: 13,
        }}>Metrics unavailable: {loadError}</div>
      )}

      {loading || !payload ? (
        <>
          <style>{`@keyframes obsShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          <ObservabilitySkeleton />
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
            <Kpi label="Morgan help items" value={payload.summary.morganRequests} />
            <Kpi label="Morgan error rate" value={`${payload.summary.errorRatePct}%`} accent={payload.summary.errorRatePct > 5 ? CRITICAL : SUCCESS} />
            <Kpi label="Avg / P95 latency" value={`${payload.summary.avgLatencyMs} / ${payload.summary.p95LatencyMs} ms`} />
            <Kpi label="Created to export" value={`${conversionRate}%`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: 10, marginBottom: 12 }}>
            <Panel title="Daily activity">
              <div style={{ display: 'grid', gap: 6 }}>
                {payload.daily.length === 0 ? (
                  <div style={{ color: TEXT3, fontSize: 13 }}>No events in this window.</div>
                ) : payload.daily.map((d) => (
                  <div key={d.day} style={{
                    display: 'grid', gridTemplateColumns: '110px repeat(4, 1fr)', gap: 10,
                    fontSize: 12, fontFamily: 'var(--font-mono)', paddingBottom: 4,
                  }}>
                    <span style={{ color: TEXT2 }}>{d.day}</span>
                    <span><span style={{ color: TEXT3 }}>req</span> {d.requests}</span>
                    <span><span style={{ color: TEXT3 }}>err</span> {d.errors}</span>
                    <span><span style={{ color: TEXT3 }}>exp</span> {d.exports}</span>
                    <span><span style={{ color: TEXT3 }}>new</span> {d.created}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Funnel">
              <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                <FunnelRow label="Process created" value={payload.funnel.processCreated} />
                <FunnelRow label="Morgan started" value={payload.funnel.morganStarted} />
                <FunnelRow label="Export completed" value={payload.funnel.exportCompleted} />
              </div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: TEXT3, marginTop: 18, marginBottom: 8, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Top errors</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {payload.topErrors.length === 0 ? (
                  <span style={{ color: TEXT3, fontSize: 12 }}>No errors recorded.</span>
                ) : payload.topErrors.map((entry) => (
                  <div key={entry.message} style={{ fontSize: 12, color: '#FCA5A5', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ color: TEXT3 }}>{entry.count}×</span> {entry.message}
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Recent events">
            <div style={{ display: 'grid', gap: 6 }}>
              {payload.recent.length === 0 ? (
                <div style={{ color: TEXT3, fontSize: 13 }}>No events.</div>
              ) : payload.recent.map((event) => (
                <div key={event.id} style={{
                  display: 'grid', gridTemplateColumns: '170px 180px 110px 100px 1fr', gap: 12,
                  fontSize: 12, fontFamily: 'var(--font-mono)', paddingBottom: 4,
                }}>
                  <span style={{ color: TEXT2 }}>{new Date(event.created_at).toLocaleString()}</span>
                  <span style={{ color: TEXT }}>{event.event_name}</span>
                  <span style={{ color: event.status === 'error' || event.category === 'error' ? '#FCA5A5' : TEXT2 }}>{event.status || '-'}</span>
                  <span style={{ color: TEXT2 }}>{typeof event.duration_ms === 'number' ? `${event.duration_ms}ms` : '-'}</span>
                  <span style={{ color: TEXT3 }}>{event.route || '-'}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 18px' }}>
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: TEXT3, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-heading)', fontSize: 28, fontWeight: 700,
        color: accent || TEXT, lineHeight: 1, marginTop: 10,
      }}>{value}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 18px' }}>
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: TEXT3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function FunnelRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: TEXT2 }}>{label}</span>
      <span style={{ color: TEXT, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

function ObservabilitySkeleton() {
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
    backgroundSize: '200% 100%',
    animation: 'obsShimmer 1.4s ease-in-out infinite',
  }
  const block = (w: number | string, h: number, mb = 0): React.CSSProperties => ({ ...shimmer, width: w, height: h, marginBottom: mb })
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 18px' }}>
            <div style={block(110, 10, 10)} />
            <div style={block(80, 26)} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: 10, marginBottom: 12 }}>
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 18px' }}>
          <div style={block(100, 10, 14)} />
          {[0, 1, 2, 3, 4].map(i => <div key={i} style={block('100%', 12, 10)} />)}
        </div>
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 18px' }}>
          <div style={block(80, 10, 14)} />
          {[0, 1, 2].map(i => <div key={i} style={block('100%', 14, 10)} />)}
          <div style={{ ...block(80, 10), marginTop: 16, marginBottom: 10 }} />
          {[0, 1].map(i => <div key={i} style={block('100%', 12, 8)} />)}
        </div>
      </div>
      <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 18px' }}>
        <div style={block(100, 10, 14)} />
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} style={block('100%', 12, 10)} />)}
      </div>
    </>
  )
}

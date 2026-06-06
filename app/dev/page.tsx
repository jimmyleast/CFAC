'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type ServiceHealth = {
  name: string
  url: string | null
  status: 'healthy' | 'degraded' | 'down' | 'unconfigured'
  latency_ms: number | null
}

type BuilderJob = {
  id: string
  title: string | null
  description: string | null
  builder_job_id: string
  builder_status: string | null
  builder_result: Record<string, string> | null
  created_at: string
  updated_at: string
}

type AuditEntry = {
  id: string
  event_name: string
  category: string
  status: string
  route: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

type EnvVar = { key: string; set: boolean }

type MemoryStats = { episodic: number; procedural: number; semantic: number }

const STATUS_DOTS: Record<string, { color: string; label: string }> = {
  healthy: { color: '#22C55E', label: 'HEALTHY' },
  degraded: { color: '#F59E0B', label: 'DEGRADED' },
  down: { color: '#EF4444', label: 'DOWN' },
  unconfigured: { color: '#555', label: 'NOT SET' },
}

const BUILDER_COLORS: Record<string, string> = {
  pending: '#C9A84C',
  building: '#FFFFFF',
  deployed: '#059669',
  failed: '#DC2626',
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function DevConsoleSkeleton() {
  const BG2 = '#111111'
  const LINE = '#2A2A2A'
  const LINE2 = '#3A3A3A'
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
    backgroundSize: '200% 100%',
    animation: 'devShimmer 1.4s ease-in-out infinite',
  }
  const block = (w: number | string, h: number, mb = 0): React.CSSProperties => ({ ...shimmer, width: w, height: h, marginBottom: mb })
  return (
    <div className="page-shell">
      <style>{`@keyframes devShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <div style={{ marginBottom: 28 }}>
        <div style={block(50, 11, 8)} />
        <div style={block(240, 36, 6)} />
        <div style={block(360, 13)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{ background: BG2, border: `1px solid ${LINE}`, padding: '16px 14px' }}>
            <div style={block(100, 12, 8)} />
            <div style={block(60, 14, 6)} />
            <div style={block(40, 10)} />
          </div>
        ))}
      </div>
      <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: 16, marginBottom: 32 }}>
        <div style={block(120, 12, 14)} />
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 100px 80px', gap: 10, paddingBottom: 10 }}>
            <div style={block('80%', 12)} />
            <div style={block('60%', 12)} />
            <div style={block('70%', 12)} />
            <div style={block('60%', 12)} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 32 }}>
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: 16 }}>
          <div style={block(120, 12, 14)} />
          {[0, 1, 2, 3, 4].map(i => <div key={i} style={block('100%', 12, 8)} />)}
        </div>
        <div>
          <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: 14, marginBottom: 16 }}>
            <div style={block(100, 12, 14)} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ background: 'transparent', border: `1px solid ${LINE2}`, padding: 12, textAlign: 'center' }}>
                  <div style={{ ...block(50, 10), margin: '0 auto 6px' }} />
                  <div style={{ ...block(40, 22), margin: '0 auto' }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: 14 }}>
            <div style={block(120, 12, 14)} />
            {[0, 1, 2, 3].map(i => <div key={i} style={block('100%', 11, 8)} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DevDashboardPage() {
  const router = useRouter()
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const [services, setServices] = useState<ServiceHealth[]>([])
  const [checkedAt, setCheckedAt] = useState('')
  const [builderJobs, setBuilderJobs] = useState<BuilderJob[]>([])
  const [selectedJob, setSelectedJob] = useState<BuilderJob | null>(null)
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null)
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const loadHealth = useCallback(async () => {
    const res = await fetch('/api/dev/health')
    if (res.ok && mountedRef.current) {
      const d = await res.json()
      setServices(d.services || [])
      setCheckedAt(d.checked_at || '')
    }
  }, [])

  const loadAll = useCallback(async () => {
    const [, buildRes, auditRes, memRes, envRes] = await Promise.all([
      loadHealth(),
      fetch('/api/dev/builder-jobs'),
      fetch('/api/dev/audit-log'),
      fetch('/api/dev/memory-stats'),
      fetch('/api/dev/env-check'),
    ])

    if (!mountedRef.current) return

    if (buildRes.ok) { const d = await buildRes.json(); setBuilderJobs(d.jobs || []) }
    if (auditRes.ok) { const d = await auditRes.json(); setAuditLog(d.entries || []) }
    if (memRes.ok) { const d = await memRes.json(); setMemoryStats(d.stats || null) }
    if (envRes.ok) { const d = await envRes.json(); setEnvVars(d.vars || []) }
  }, [loadHealth])

  useEffect(() => {
    mountedRef.current = true
    const init = async () => {
      const meRes = await fetch('/api/me')
      if (meRes.status === 401) { router.replace('/auth/login'); return }
      const me = meRes.ok ? await meRes.json() : null
      if (!me?.is_admin) { setAccessDenied(true); setLoading(false); return }
      await loadAll()
      setLoading(false)
    }
    void init()
    return () => { mountedRef.current = false }
  }, [loadAll, router])

  // Auto-refresh builder jobs every 10s when active
  useEffect(() => {
    if (accessDenied || loading) return
    const hasActive = builderJobs.some((j) => j.builder_status === 'pending' || j.builder_status === 'building')
    if (!hasActive) return
    const id = setInterval(() => {
      void fetch('/api/dev/builder-jobs').then(async (r) => {
        if (r.ok && mountedRef.current) { const d = await r.json(); setBuilderJobs(d.jobs || []) }
      })
    }, 10000)
    return () => clearInterval(id)
  }, [accessDenied, loading, builderJobs])

  // Auto-refresh audit log every 15s
  useEffect(() => {
    if (accessDenied || loading) return
    const id = setInterval(() => {
      void fetch('/api/dev/audit-log').then(async (r) => {
        if (r.ok && mountedRef.current) { const d = await r.json(); setAuditLog(d.entries || []) }
      })
    }, 15000)
    return () => clearInterval(id)
  }, [accessDenied, loading])

  async function refreshAll() {
    setRefreshing(true)
    await loadAll()
    setRefreshing(false)
  }

  async function loadMoreAudit() {
    if (auditLog.length === 0) return
    const last = auditLog[auditLog.length - 1]
    const res = await fetch(`/api/dev/audit-log?before=${encodeURIComponent(last.created_at)}`)
    if (res.ok) {
      const d = await res.json()
      setAuditLog((prev) => [...prev, ...(d.entries || [])])
    }
  }

  if (accessDenied) {
    return (
      <div className="page-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-title">Admin access required</div>
          <p className="empty-copy">Only developers and admins can access the dev dashboard.</p>
          <button onClick={() => router.push('/overview')} className="btn btn-secondary">← Back to dashboard</button>
        </div>
      </div>
    )
  }

  if (loading) {
    return <DevConsoleSkeleton />
  }

  const sinceChecked = checkedAt ? `${Math.round((Date.now() - new Date(checkedAt).getTime()) / 1000)}s ago` : '—'

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-eyebrow" style={{ color: '#C9A84C' }}>Tools</div>
          <h1 className="page-title">Dev Console</h1>
          <p className="page-copy">Hope logs, service health, env check. Last refreshed {sinceChecked}.</p>
        </div>
        <div className="hero-actions">
          <Link href="/" className="btn btn-ghost">← Dashboard</Link>
          <button onClick={refreshAll} disabled={refreshing} className="btn btn-primary">
            {refreshing ? 'Refreshing…' : 'Refresh all'}
          </button>
        </div>
      </div>

      {/* Service Health Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
        {services.map((svc) => {
          const dot = STATUS_DOTS[svc.status] || STATUS_DOTS.down
          return (
            <div key={svc.name} className="surface-card" style={{ padding: '16px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-condensed)', fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-primary)', fontWeight: 700 }}>
                  {svc.name}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: dot.color }}>
                {dot.label}
              </div>
              {svc.latency_ms !== null && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {svc.latency_ms}ms
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Builder Jobs */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>Builder Jobs</h2>
        <div className="table-card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {['Job ID', 'Gap Description', 'Status', 'Time'].map((h) => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {builderJobs.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 20, color: 'var(--text-secondary)' }}>No builder jobs found.</td></tr>
                ) : builderJobs.map((job) => {
                  const statusColor = BUILDER_COLORS[job.builder_status || ''] || '#888'
                  return (
                    <tr
                      key={job.id}
                      className="data-row"
                      onClick={() => setSelectedJob(job)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {(job.builder_job_id || '').slice(0, 12)}
                      </td>
                      <td style={{ maxWidth: 300 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.title || job.description?.slice(0, 60) || 'Untitled'}
                        </div>
                      </td>
                      <td>
                        <span style={{ color: statusColor, textTransform: 'uppercase', fontFamily: 'var(--font-condensed)', fontSize: 12, letterSpacing: '0.06em' }}>
                          {job.builder_status || 'unknown'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{timeAgo(job.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Two column: Audit Log + Memory/Env */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 32 }}>
        {/* Audit Log */}
        <div>
          <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>Live Audit Log</h2>
          <div className="surface-card" style={{ padding: 0, maxHeight: 420, overflowY: 'auto' }}>
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  {['Timestamp', 'Event', 'Status'].map((h) => <th key={h} style={{ fontSize: 11 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr><td colSpan={3} style={{ padding: 20, color: 'var(--text-secondary)' }}>No audit entries.</td></tr>
                ) : auditLog.map((entry) => (
                  <tr key={entry.id} className="data-row">
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td style={{ color: 'var(--text-primary)' }}>{entry.event_name}</td>
                    <td>
                      <span style={{ color: entry.status === 'ok' || entry.status === 'started' ? 'var(--success)' : entry.status === 'error' || entry.status === 'generation_failed' ? 'var(--error)' : 'var(--text-secondary)' }}>
                        {entry.status === 'ok' || entry.status === 'started' ? '✓' : entry.status === 'error' || entry.status === 'generation_failed' ? '✗' : '·'} {entry.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {auditLog.length >= 10 && (
              <div style={{ padding: '8px 12px', textAlign: 'center' }}>
                <button onClick={loadMoreAudit} className="btn btn-ghost btn-sm">Load more</button>
              </div>
            )}
          </div>
        </div>

        {/* Right column: Memory + Env */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Memory Stats */}
          <div>
            <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>Memory Stats</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { label: 'Episodic', value: memoryStats?.episodic ?? '—' },
                { label: 'Procedural', value: memoryStats?.procedural ?? '—' },
                { label: 'Semantic', value: memoryStats?.semantic ?? '—' },
              ].map((m) => (
                <div key={m.label} className="surface-card" style={{ textAlign: 'center', padding: '14px 10px' }}>
                  <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Env Check */}
          <div>
            <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>Env / Config Check</h2>
            <div className="surface-card" style={{ padding: '12px 14px', maxHeight: 260, overflowY: 'auto' }}>
              {envVars.map((v) => (
                <div key={v.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: v.set ? 'var(--text-secondary)' : 'var(--error)' }}>{v.key}</span>
                  <span style={{ fontFamily: 'var(--font-condensed)', fontSize: 11, letterSpacing: '0.06em', color: v.set ? 'var(--success)' : 'var(--error)' }}>
                    {v.set ? '✓ SET' : '✗ MISSING'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Builder Job Detail Slide-in Panel */}
      {selectedJob && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedJob(null) }}
        >
          <div style={{
            width: '100%',
            maxWidth: 480,
            background: 'var(--bg-surface)',
            borderLeft: '1px solid var(--border)',
            height: '100vh',
            overflowY: 'auto',
            padding: '28px 24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 20, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 4 }}>
                  {selectedJob.title || 'Untitled Job'}
                </h2>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {selectedJob.builder_job_id} ·{' '}
                  <span style={{ color: BUILDER_COLORS[selectedJob.builder_status || ''] || '#888', textTransform: 'uppercase' }}>
                    {selectedJob.builder_status || 'unknown'}
                  </span>
                  {' '}· Started {timeAgo(selectedJob.created_at)}
                </div>
              </div>
              <button onClick={() => setSelectedJob(null)} className="btn btn-ghost btn-sm">✕</button>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>Gap Description</div>
              <div style={{ color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.6, padding: '12px 14px', background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                {selectedJob.description || 'No description available.'}
              </div>
            </div>

            {selectedJob.builder_result && Object.keys(selectedJob.builder_result).length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>Result</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedJob.builder_result.app_name && (
                    <div style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>App: </span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedJob.builder_result.app_name}</span>
                    </div>
                  )}
                  {selectedJob.builder_result.github_repo_url && (
                    <div style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>GitHub: </span>
                      <a href={selectedJob.builder_result.github_repo_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
                        {selectedJob.builder_result.github_repo_url}
                      </a>
                    </div>
                  )}
                  {selectedJob.builder_result.railway_url && (
                    <div style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Railway: </span>
                      <a href={selectedJob.builder_result.railway_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
                        {selectedJob.builder_result.railway_url}
                      </a>
                    </div>
                  )}
                  {selectedJob.builder_result.supabase_url && (
                    <div style={{ fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Supabase: </span>
                      <a href={selectedJob.builder_result.supabase_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
                        {selectedJob.builder_result.supabase_url}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

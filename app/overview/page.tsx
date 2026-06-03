'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Stats = { sops_built: number; sops_in_progress: number; requests_pending: number; requests_building: number; active_users: number }
type TopRequest = { id: string; title: string | null; rice_score: number | null; status: string; builder_status: string | null }
type RecentSop = { id: string; name: string; owner: string | null; status: string; phase: number; completion: number; updated_at: string }
type BuilderJob = { id: string; title: string | null; description: string | null; builder_status: string | null; builder_result: Record<string, string> | null; created_at: string }

const BUILDER_COLORS: Record<string, string> = { pending: '#5bc0be', building: '#ffffff', deployed: '#22C55E', failed: '#EF4444' }

function riceLabel(score: number) {
  if (score >= 100) return 'CRITICAL'
  if (score >= 50) return 'HIGH'
  if (score >= 20) return 'MEDIUM'
  return 'LOW'
}

function riceColor(score: number) {
  if (score >= 100) return '#EF4444'
  if (score >= 50) return '#F59E0B'
  if (score >= 20) return '#22C55E'
  return '#888'
}

export default function OverviewPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [topRequests, setTopRequests] = useState<TopRequest[]>([])
  const [recentSops, setRecentSops] = useState<RecentSop[]>([])
  const [builderJobs, setBuilderJobs] = useState<BuilderJob[]>([])
  const [approvalCount, setApprovalCount] = useState(0)
  const mountedRef = useRef(true)

  const loadAll = useCallback(async () => {
    const [statsRes, reqRes, sopRes, buildRes, appRes] = await Promise.all([
      fetch('/api/admin/stats'),
      fetch('/api/admin/top-requests'),
      fetch('/api/admin/recent-sops'),
      fetch('/api/admin/builder-jobs'),
      fetch('/api/approvals'),
    ])
    if (!mountedRef.current) return
    if (statsRes.ok) setStats(await statsRes.json())
    if (reqRes.ok) { const d = await reqRes.json(); setTopRequests(d.requests || []) }
    if (sopRes.ok) { const d = await sopRes.json(); setRecentSops(d.sops || []) }
    if (buildRes.ok) { const d = await buildRes.json(); setBuilderJobs(d.jobs || []) }
    if (appRes.ok) { const d = await appRes.json(); setApprovalCount(d.count || 0) }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const init = async () => {
      const meRes = await fetch('/api/me')
      if (meRes.status === 401) { router.replace('/auth/login'); return }
      const me = meRes.ok ? await meRes.json() : null
      if (!me?.is_admin) { setAccessDenied(true); setLoading(false); return }
      setDisplayName(me.display_name || me.email?.split('@')[0] || '')
      await loadAll()
      setLoading(false)
    }
    void init()
    return () => { mountedRef.current = false }
  }, [loadAll, router])

  // Auto-refresh stats 30s
  useEffect(() => {
    if (accessDenied || loading) return
    const id = setInterval(() => {
      void fetch('/api/admin/stats').then(async (r) => { if (r.ok && mountedRef.current) setStats(await r.json()) })
    }, 30000)
    return () => clearInterval(id)
  }, [accessDenied, loading])

  // Auto-refresh builder 10s when active
  useEffect(() => {
    if (accessDenied || loading) return
    const hasActive = builderJobs.some((j) => j.builder_status === 'pending' || j.builder_status === 'building')
    if (!hasActive) return
    const id = setInterval(() => {
      void fetch('/api/admin/builder-jobs').then(async (r) => { if (r.ok && mountedRef.current) { const d = await r.json(); setBuilderJobs(d.jobs || []) } })
    }, 10000)
    return () => clearInterval(id)
  }, [accessDenied, loading, builderJobs])

  if (accessDenied) {
    return (
      <div className="page-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
        <div className="empty-state">
          <div className="empty-icon">🔒</div>
          <div className="empty-title">Admin access required</div>
          <button onClick={() => router.push('/home')} className="btn btn-secondary">← Back</button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-shell">
        <style>{`@keyframes oShim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } } .o-skel { background: linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%); background-size: 200% 100%; animation: oShim 1.4s ease-in-out infinite; display: block; }`}</style>
        <div style={{ marginBottom: 28 }}>
          <span className="o-skel" style={{ height: 11, width: 80, marginBottom: 10 }} />
          <span className="o-skel" style={{ height: 32, width: 280, marginBottom: 8 }} />
          <span className="o-skel" style={{ height: 13, width: 220 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {[0,1,2,3].map(i => <span key={i} className="o-skel" style={{ height: 96 }} />)}
        </div>
      </div>
    )
  }

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="page-shell">
      {/* Canonical header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: '#C9A84C', marginBottom: 8,
        }}>Overview</div>
        <h1 style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36,
          letterSpacing: '0.02em', textTransform: 'uppercase',
          marginBottom: 6, color: '#F0EDE6',
        }}>{greeting}{displayName ? `, ${displayName}` : ''}</h1>
        <p style={{ fontSize: 13, color: '#8A8680', maxWidth: 720, lineHeight: 1.5 }}>
          {today}. Cross-team rollups and what needs your attention today.
        </p>
      </div>

      {/* Action Needed Banner */}
      {approvalCount > 0 && (
        <div
          className="surface-card"
          style={{ padding: '16px 20px', marginBottom: 20, borderColor: 'var(--warning)', cursor: 'pointer' }}
          onClick={() => router.push('/approvals')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ color: 'var(--warning)', fontFamily: 'var(--font-condensed)', fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                ⚡ ACTION NEEDED
              </span>
              <div style={{ color: 'var(--text-primary)', marginTop: 4 }}>
                {approvalCount} item{approvalCount !== 1 ? 's' : ''} need{approvalCount === 1 ? 's' : ''} your approval
              </div>
            </div>
            <span className="btn btn-ghost btn-sm">Review now →</span>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 32 }}>
        {[
          { label: 'SOPs BUILT', value: stats?.sops_built ?? '—' },
          { label: 'REQUESTS PENDING', value: stats?.requests_pending ?? '—' },
          { label: 'BUILDING NOW', value: stats?.requests_building ?? '—' },
          { label: 'STAFF ACTIVE', value: stats?.active_users ?? '—' },
        ].map((c) => (
          <div key={c.label} className="surface-card" style={{ textAlign: 'center', padding: '18px 12px' }}>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontFamily: 'var(--font-condensed)', fontSize: '2.2rem', fontWeight: 700, lineHeight: 1 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Builder Jobs */}
      {builderJobs.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>What Morgan is building</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {builderJobs.slice(0, 3).map((job) => {
              const color = BUILDER_COLORS[job.builder_status || ''] || '#888'
              const deployed = job.builder_status === 'deployed'
              return (
                <div key={job.id} className="surface-card" style={{ padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-condensed)', fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color, marginBottom: 4 }}>
                    {deployed ? '✓' : '⚡'} {deployed ? 'DEPLOYED' : job.builder_status === 'building' ? 'BUILDING NOW' : 'QUEUED'}
                  </div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{job.title || 'Untitled'}</div>
                  {job.description && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{job.description.slice(0, 100)}</div>}
                  {deployed && job.builder_result?.railway_url && (
                    <a href={job.builder_result.railway_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--gold)', display: 'inline-block', marginTop: 6 }}>
                      View live tool →
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Two-column: priorities + processes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Top priorities</h2>
            <Link href="/requests/backlog" className="btn btn-ghost btn-sm">View all →</Link>
          </div>
          {topRequests.length === 0 ? (
            <div className="surface-card" style={{ padding: 20, color: 'var(--text-secondary)' }}>No requests yet.</div>
          ) : topRequests.slice(0, 5).map((req, i) => {
            const score = Number(req.rice_score || 0)
            return (
              <div key={req.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => router.push(`/requests/backlog/${req.id}`)}>
                <span style={{ fontFamily: 'var(--font-condensed)', fontWeight: 700, color: 'var(--gold)', minWidth: 18 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{req.title || 'Untitled'}</span>
                <span style={{ fontFamily: 'var(--font-condensed)', fontSize: 11, color: riceColor(score), letterSpacing: '0.04em' }}>{riceLabel(score)}</span>
              </div>
            )
          })}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontFamily: 'var(--font-condensed)', fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Recent processes</h2>
            <Link href="/" className="btn btn-ghost btn-sm">View all →</Link>
          </div>
          {recentSops.length === 0 ? (
            <div className="surface-card" style={{ padding: 20, color: 'var(--text-secondary)' }}>No processes yet.</div>
          ) : recentSops.slice(0, 5).map((sop) => (
            <div key={sop.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => router.push(`/process/${sop.id}`)}>
              <span style={{ flex: 1, fontSize: 14 }}>{(sop.name || 'Untitled').replace(/^\[Request\]\s*/, '')}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{sop.completion >= 100 ? 'COMPLETE' : `Phase ${sop.phase}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

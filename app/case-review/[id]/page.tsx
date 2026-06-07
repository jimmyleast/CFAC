'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const WARN = '#E0846B'

const STATUSES = ['new', 'pending', 'criminal', 'closed'] as const

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

export default function CaseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id || '')
  const [data, setData] = useState<{ case: Record<string, unknown>; events: Record<string, unknown>[]; phiGateReady?: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [moving, setMoving] = useState(false)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await authFetch(`/api/cases/${encodeURIComponent(id)}`)
      if (res.status === 404) { setErr('Case not found.'); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [id])

  async function move() {
    if (!to) return
    setMoving(true)
    try {
      const res = await authFetch(`/api/cases/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, note }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) }
      else { setTo(''); setNote(''); await load() }
    } finally { setMoving(false) }
  }

  const c = (data?.case || {}) as Record<string, string | boolean | null>
  const events = data?.events || []

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px' }}>
      <button onClick={() => router.push('/case-review')} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <Icons.ArrowLeft size={14} /> Case Review
      </button>

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      {data && (
        <>
          <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Case · {String(c.status)}</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 28, color: TEXT, margin: '0 0 16px' }}>{String(c.case_number || 'Case')}</h1>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              ['Priority', c.priority], ['Agenda', c.agenda], ['Household', c.household_id], ['Last update', c.last_update],
            ].map(([label, val]) => (
              <div key={String(label)} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: TEXT4 }}>{String(label)}</div>
                <div style={{ fontSize: 14, color: TEXT, marginTop: 3 }}>{val ? String(val) : '—'}</div>
              </div>
            ))}
          </div>

          {c.summary && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT2, marginBottom: 8 }}>Summary</div>
              <p style={{ color: '#D7D3CC', fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>{String(c.summary)}</p>
            </div>
          )}

          {/* Human-in-the-loop status move */}
          <div style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT2, marginBottom: 12 }}>Move case</div>
            {data.phiGateReady === false ? (
              <div style={{ color: TEXT4, fontSize: 12.5 }}>🔒 Status moves are locked until the HIPAA infrastructure is in place.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={to} onChange={(e) => setTo(e.target.value)} style={{ background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 10px' }}>
                  <option value="">Move to…</option>
                  {STATUSES.filter((s) => s !== c.status).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / note (optional)" style={{ flex: 1, minWidth: 200, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 12px' }} />
                <button disabled={!to || moving} onClick={move} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: !to || moving ? 'not-allowed' : 'pointer' }}>{moving ? 'Moving…' : 'Move'}</button>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: TEXT2, marginBottom: 12 }}>History</div>
          {events.length === 0 ? <div style={{ color: TEXT4, fontSize: 13 }}>No status changes yet.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {events.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, color: TEXT2 }}>
                  <span style={{ color: TEXT4, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{new Date(String(e.created_at)).toLocaleDateString()}</span>
                  <span><strong style={{ color: TEXT }}>{String(e.from_status)}</strong> → <strong style={{ color: TEXT }}>{String(e.to_status)}</strong>{e.note ? ` · ${String(e.note)}` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

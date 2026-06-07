'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const ERR = '#EB5757'

type Case = { id: string; caseNumber: string | null; status: string; priority: string | null; summary: string | null; agency: string | null }

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

export default function ReviewQueuePage() {
  const router = useRouter()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [phiReady, setPhiReady] = useState(true)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await authFetch('/api/cases?review=1')
      if (res.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setCases(d.cases || []); setPhiReady(d.phiGateReady !== false)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function approve(id: string) {
    setBusy(id)
    try {
      const res = await authFetch(`/api/cases/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clearReview: true }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else await load()
    } finally { setBusy(null) }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>MDT</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Review Queue</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 640 }}>
        Cases extracted from imports that need a human to confirm before they&apos;re treated as final — the human-in-the-loop step. Open a case to check the details, then approve.
      </p>

      {!phiReady && (
        <div style={{ color: ERR, fontSize: 13, padding: '12px 16px', border: `1px solid ${ERR}55`, borderRadius: 10, background: 'rgba(235,87,87,0.06)', marginBottom: 20 }}>
          🔒 Case data is gated until the HIPAA infrastructure is in place. The queue fills once Collaborate imports run behind the gate.
        </div>
      )}
      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: ERR }}>{err}</div>}

      {!loading && !err && cases.length === 0 && (
        <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: 32, color: TEXT2, textAlign: 'center' }}>
          <Icons.CheckCircle2 size={28} color={OK} style={{ margin: '0 auto 12px' }} />
          <div>Nothing waiting for review.</div>
          <div style={{ fontSize: 12, color: TEXT4, marginTop: 6 }}>Newly-imported cases appear here for approval.</div>
        </div>
      )}

      {!loading && cases.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cases.map((c) => (
            <div key={c.id} style={{ background: BG2, border: `1px solid ${GOLD}44`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {c.priority && <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 4, padding: '1px 6px' }}>{c.priority}</span>}
              <span onClick={() => router.push(`/case-review/${c.id}`)} style={{ fontWeight: 600, fontSize: 14, color: TEXT, cursor: 'pointer', minWidth: 90 }}>{c.caseNumber || 'Case'}</span>
              <span style={{ flex: 1, color: TEXT2, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary || ''}</span>
              {c.agency && <span style={{ fontSize: 12, color: TEXT4 }}>{c.agency}</span>}
              <button disabled={busy === c.id} onClick={() => approve(c.id)} style={{ background: OK, color: '#0D0D0F', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{busy === c.id ? '…' : 'Approve'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

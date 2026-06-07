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
const WARN = '#E0846B'
const ERR = '#EB5757'

type Agenda = { key: string; label: string; hint: string }
type Case = {
  id: string; caseNumber: string | null; status: string; agenda: string | null
  priority: string | null; householdId: string | null; reviewFlag: boolean
  lastUpdate: string | null; summary: string | null; agency: string | null
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#EB5757', P2: '#E0A24B', P3: '#7DD3C7' }

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}

export default function CaseReviewPage() {
  const router = useRouter()
  const [agendas, setAgendas] = useState<Agenda[]>([])
  const [active, setActive] = useState<string>('new')
  const [cases, setCases] = useState<Case[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [phiReady, setPhiReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function load(agenda: string) {
    setLoading(true); setErr(null)
    try {
      const res = await authFetch(`/api/cases?agenda=${encodeURIComponent(agenda)}`)
      if (res.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setAgendas(d.agendas || []); setCases(d.cases || []); setCounts(d.counts || {}); setPhiReady(d.phiGateReady !== false)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load(active) }, [active])

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>MDT</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 32, color: TEXT, margin: '0 0 6px' }}>Case Review</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 20px', maxWidth: 680 }}>
        The multidisciplinary team agendas — every P1/P2 case routed so it gets seen. Cases come from Collaborate; reviews and status moves are human-approved before they&apos;re final.
      </p>

      {!phiReady && (
        <div style={{ color: ERR, fontSize: 13, padding: '12px 16px', border: `1px solid ${ERR}55`, borderRadius: 10, background: 'rgba(235,87,87,0.06)', marginBottom: 20 }}>
          🔒 Case data is gated until the HIPAA infrastructure is in place (see the PHI checklist). The workflow below is ready — cases will appear once Collaborate is connected behind the gate.
        </div>
      )}

      {/* Agenda tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {agendas.map((a) => (
          <button key={a.key} onClick={() => setActive(a.key)}
            style={{
              background: active === a.key ? 'rgba(91,163,217,0.14)' : 'transparent',
              border: `1px solid ${active === a.key ? GOLD : LINE}`, color: active === a.key ? GOLD : TEXT2,
              borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>
            {a.label}{counts[a.key] ? <span style={{ marginLeft: 6, color: TEXT4 }}>{counts[a.key]}</span> : ''}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: TEXT4, marginBottom: 16 }}>{agendas.find((a) => a.key === active)?.hint}</div>

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      {!loading && !err && cases.length === 0 && (
        <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: 32, color: TEXT2, textAlign: 'center' }}>
          <Icons.Inbox size={28} color={TEXT4} style={{ margin: '0 auto 12px' }} />
          <div>No cases on this agenda yet.</div>
          <div style={{ fontSize: 12, color: TEXT4, marginTop: 6 }}>Cases appear once Collaborate intakes are imported.</div>
        </div>
      )}

      {!loading && cases.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cases.map((c) => (
            <div key={c.id} onClick={() => router.push(`/case-review/${c.id}`)}
              style={{ background: BG2, border: `1px solid ${c.reviewFlag ? GOLD + '66' : LINE}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', flexWrap: 'wrap' }}>
              {c.priority && <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLOR[c.priority] || TEXT2, border: `1px solid ${(PRIORITY_COLOR[c.priority] || TEXT2)}55`, borderRadius: 4, padding: '1px 6px' }}>{c.priority}</span>}
              <span style={{ fontWeight: 600, fontSize: 14, color: TEXT, minWidth: 90 }}>{c.caseNumber || 'Case'}</span>
              <span style={{ flex: 1, color: TEXT2, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary || ''}</span>
              {c.agency && <span style={{ fontSize: 12, color: TEXT4 }}>{c.agency}</span>}
              {c.reviewFlag && <span style={{ fontSize: 10, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.06em' }}>needs review</span>}
              <span style={{ fontSize: 12, color: TEXT4 }}>{c.lastUpdate || ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const ERR = '#EB5757'

type Scorecard = {
  agencyId: string | null; name: string; type: string | null
  total: number; open: number; closed: number
  byStatus: { new: number; pending: number; criminal: number; closed: number }
  criminalRatePct: number | null; closedRatePct: number | null
}

async function authFetch(url: string) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
}

export default function AccountabilityPage() {
  const [cards, setCards] = useState<Scorecard[]>([])
  const [phiReady, setPhiReady] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    authFetch('/api/cases/accountability')
      .then(async (r) => { if (r.status === 401) throw new Error('Please sign in.'); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { if (active) { setCards(d.scorecards || []); setPhiReady(d.phiGateReady !== false); setTruncated(!!d.truncated); setLoading(false) } })
      .catch((e) => { if (active) { setErr(String(e.message || e)); setLoading(false) } })
    return () => { active = false }
  }, [])

  const hasData = cards.some((c) => c.total > 0)

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>MDT</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Agency Accountability</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 660 }}>
        Per-partner case volume, status mix, and prosecution/closure rates — the grant-reporting scorecards across the multidisciplinary team.
      </p>

      {!phiReady && (
        <div style={{ color: ERR, fontSize: 13, padding: '12px 16px', border: `1px solid ${ERR}55`, borderRadius: 10, background: 'rgba(235,87,87,0.06)', marginBottom: 20 }}>
          🔒 Scorecards populate from case data, which is gated until the HIPAA infrastructure is in place.
        </div>
      )}

      {truncated && (
        <div style={{ color: ERR, fontSize: 13, padding: '10px 14px', border: `1px solid ${ERR}55`, borderRadius: 8, background: 'rgba(235,87,87,0.06)', marginBottom: 16 }}>
          ⚠ Partial scan — more than 20,000 cases. Scorecards may under-count; do not use for final grant figures until aggregated server-side.
        </div>
      )}
      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: ERR }}>{err}</div>}

      {!loading && !err && !hasData && (
        <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: 32, color: TEXT2, textAlign: 'center' }}>
          <Icons.BarChart3 size={28} color={TEXT4} style={{ margin: '0 auto 12px' }} />
          <div>No case data yet — scorecards appear once cases are routed to agencies.</div>
        </div>
      )}

      {!loading && hasData && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cards.map((c) => (
            <div key={c.agencyId || 'unassigned'} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{c.name}{c.type && <span style={{ marginLeft: 8, fontSize: 11, color: TEXT4 }}>{c.type.replace(/_/g, ' ')}</span>}</span>
                <span style={{ fontSize: 13, color: TEXT2 }}>{c.total} case{c.total === 1 ? '' : 's'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                <Stat label="Open" value={c.open} />
                <Stat label="Closed" value={c.closed} />
                <Stat label="In prosecution" value={c.byStatus.criminal} />
                <Stat label="Prosecution rate" value={c.criminalRatePct === null ? '—' : `${c.criminalRatePct}%`} accent={GOLD} />
                <Stat label="Closure rate" value={c.closedRatePct === null ? '—' : `${c.closedRatePct}%`} accent="#7DD3C7" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, color: accent || TEXT, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: TEXT2, marginTop: 5 }}>{label}</div>
    </div>
  )
}

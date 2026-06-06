'use client'

import { useEffect, useState } from 'react'
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

type Person = {
  id: string; email: string; display_name: string | null; title: string | null
  phone: string | null; is_admin: boolean; active: boolean; created_at: string
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

export default function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await authFetch('/api/admin/users')
      if (res.status === 403) { setErr('Admin access required.'); setLoading(false); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setPeople(d.users || [])
    } catch (e: any) { setErr(String(e.message || e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const res = await authFetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || `Update failed (${res.status})`) }
      else await load()
    } finally { setBusyId(null) }
  }

  const filtered = people.filter(p => {
    if (!q.trim()) return true
    const s = q.toLowerCase()
    return (p.display_name || '').toLowerCase().includes(s) || p.email.toLowerCase().includes(s) || (p.title || '').toLowerCase().includes(s)
  })

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Admin</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 4px' }}>People</h1>
          <p style={{ color: TEXT2, fontSize: 13, margin: 0 }}>CFAC staff with access to this platform.</p>
        </div>
        <button onClick={() => setInviteOpen(true)}
          style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icons.UserPlus size={16} strokeWidth={2} /> Invite
        </button>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email, or title…"
        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', color: TEXT, fontSize: 14, marginBottom: 16 }} />

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(p => (
          <div key={p.id} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: p.active ? 1 : 0.5 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ color: TEXT, fontSize: 15, fontWeight: 600 }}>
                {p.display_name || p.email.split('@')[0]}
                {p.is_admin && <span style={{ marginLeft: 8, fontSize: 10, color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Admin</span>}
                {!p.active && <span style={{ marginLeft: 8, fontSize: 10, color: WARN }}>inactive</span>}
              </div>
              <div style={{ color: TEXT2, fontSize: 12 }}>{p.email}{p.title ? ` · ${p.title}` : ''}</div>
            </div>
            <button disabled={busyId === p.id} onClick={() => patch(p.id, { is_admin: !p.is_admin })}
              style={{ background: 'none', border: `1px solid ${LINE}`, color: TEXT2, borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
              {p.is_admin ? 'Remove admin' : 'Make admin'}
            </button>
            <button disabled={busyId === p.id} onClick={() => patch(p.id, { active: !p.active })}
              style={{ background: 'none', border: `1px solid ${LINE}`, color: p.active ? WARN : OK, borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
              {p.active ? 'Deactivate' : 'Reactivate'}
            </button>
          </div>
        ))}
        {!loading && !filtered.length && !err && <div style={{ color: TEXT4, fontStyle: 'italic' }}>No people found.</div>}
      </div>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onDone={() => { setInviteOpen(false); load() }} />}
    </div>
  )
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function send() {
    if (!email.trim()) return
    setBusy(true); setMsg(null)
    try {
      const res = await authFetch('/api/admin/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setMsg(d.error || `Failed (${res.status})`)
      else { onDone() }
    } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#141416', border: `1px solid ${LINE}`, borderRadius: 12, padding: 24, width: 380, maxWidth: '90vw' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, color: TEXT, margin: '0 0 6px' }}>Invite someone</h2>
        <p style={{ color: TEXT2, fontSize: 13, margin: '0 0 16px' }}>They'll get an email with a magic link to sign in.</p>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="colleague@cfacbentonco.com"
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', color: TEXT, fontSize: 14, marginBottom: 14 }} />
        {msg && <div style={{ color: WARN, fontSize: 13, marginBottom: 12 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${LINE}`, color: TEXT2, borderRadius: 8, padding: '9px 14px', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy || !email.trim()} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 600, fontSize: 14, cursor: busy ? 'not-allowed' : 'pointer' }}>{busy ? 'Sending…' : 'Send invite'}</button>
        </div>
      </div>
    </div>
  )
}

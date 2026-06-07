'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const WARN = '#E0846B'
const OK = '#7DD3C7'

type Agency = { id: string; name: string; type: string; active: boolean }

const TYPES = [
  ['law_enforcement', 'Law Enforcement'], ['dhs', 'DHS / DCFS'], ['prosecution', 'Prosecution'],
  ['cac', 'CAC'], ['medical', 'Medical'], ['mental_health', 'Mental Health'], ['other', 'Other'],
] as const
const TYPE_LABEL = Object.fromEntries(TYPES) as Record<string, string>

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState('law_enforcement')
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [aRes, roleRes] = await Promise.all([authFetch('/api/agencies'), authFetch('/api/user/role').catch(() => null)])
      if (aRes.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!aRes.ok) throw new Error(`HTTP ${aRes.status}`)
      setAgencies((await aRes.json()).agencies || [])
      if (roleRes?.ok) setIsAdmin((await roleRes.json()).role === 'admin')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function add() {
    if (!name.trim()) return
    setBusy('add')
    try {
      const res = await authFetch('/api/agencies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), type }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else { setName(''); await load() }
    } finally { setBusy(null) }
  }
  async function toggle(a: Agency) {
    setBusy(a.id)
    try {
      const res = await authFetch('/api/agencies', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, active: !a.active }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else await load()
    } finally { setBusy(null) }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>MDT</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Partner Agencies</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 600 }}>
        The multidisciplinary-team partners cases are routed to and tracked against — law enforcement, DHS/DCFS, prosecution, and CFAC programs.
      </p>

      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agency name (e.g. Benton County Sheriff)"
            style={{ flex: 1, minWidth: 220, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 12px' }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 10px' }}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button disabled={busy === 'add' || !name.trim()} onClick={add} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add agency</button>
        </div>
      )}

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {agencies.map((a) => (
          <div key={a.id} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', opacity: a.active ? 1 : 0.5 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: TEXT, flex: 1, minWidth: 160 }}>{a.name}</span>
            <span style={{ fontSize: 11, color: TEXT4, border: `1px solid ${LINE}`, borderRadius: 4, padding: '2px 8px' }}>{TYPE_LABEL[a.type] || a.type}</span>
            <span style={{ fontSize: 11, color: a.active ? OK : TEXT4 }}>{a.active ? 'active' : 'inactive'}</span>
            {isAdmin && <button disabled={busy === a.id} onClick={() => toggle(a)} style={{ background: 'none', border: `1px solid ${LINE}`, color: a.active ? WARN : OK, borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>{a.active ? 'Deactivate' : 'Reactivate'}</button>}
          </div>
        ))}
        {!loading && !agencies.length && !err && <div style={{ color: TEXT4, fontStyle: 'italic' }}>No agencies yet.{isAdmin ? ' Add your MDT partners above.' : ''}</div>}
      </div>
    </div>
  )
}

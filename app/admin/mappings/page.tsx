'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEAL = '#7DD3C7'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const WARN = '#E0846B'

type Def = { key: string; display_name: string; category: string; is_dedup_rule: boolean; sort_order: number }
type Mapping = { id: string; definition_key: string; source_metric_key: string; agg: string; status: string }

const CATEGORY_LABELS: Record<string, string> = {
  impact: 'Impact metrics', program_client: 'Per-program client-served', service: 'Service categories',
  program: 'Program metrics', operational: 'Operational metrics',
}
const CATEGORY_ORDER = ['impact', 'program_client', 'service', 'program', 'operational']

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

export default function MappingsPage() {
  const [defs, setDefs] = useState<Def[]>([])
  const [maps, setMaps] = useState<Mapping[]>([])
  const [keys, setKeys] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [mRes, roleRes] = await Promise.all([authFetch('/api/mappings'), authFetch('/api/user/role').catch(() => null)])
      if (mRes.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!mRes.ok) throw new Error(`HTTP ${mRes.status}`)
      const d = await mRes.json()
      setDefs(d.definitions || []); setMaps(d.mappings || []); setKeys(d.availableKeys || [])
      if (roleRes?.ok) { const r = await roleRes.json(); setIsAdmin(r.role === 'admin') }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function addMapping(definition_key: string, source_metric_key: string) {
    if (!source_metric_key) return
    setBusy(true)
    try {
      const res = await authFetch('/api/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition_key, source_metric_key, agg: 'latest' }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else await load()
    } finally { setBusy(false) }
  }
  async function removeMapping(definition_key: string, source_metric_key: string) {
    setBusy(true)
    try {
      const res = await authFetch('/api/mappings', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ definition_key, source_metric_key }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else await load()
    } finally { setBusy(false) }
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({ cat, items: defs.filter((d) => d.category === cat) })).filter((g) => g.items.length)

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Governance</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Metric Mapping</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 28px', maxWidth: 660 }}>
        Which source metric feeds each definition — the lineage behind every reported number. The three impact metrics are computed from these mappings. A definition with no source is flagged <span style={{ color: WARN }}>unmapped</span>.{isAdmin ? ' Admins can add or remove sources.' : ''}
      </p>

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      {!loading && grouped.map(({ cat, items }) => (
        <div key={cat} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEAL, marginBottom: 12, fontWeight: 600 }}>{CATEGORY_LABELS[cat] || cat}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((d) => {
              const dm = maps.filter((m) => m.definition_key === d.key)
              const unmapped = dm.length === 0
              const used = new Set(dm.map((m) => m.source_metric_key))
              return (
                <div key={d.key} style={{ background: BG2, border: `1px solid ${unmapped ? WARN + '55' : LINE}`, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, color: TEXT, fontWeight: 600 }}>{d.display_name}
                      <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: TEXT4 }}>{d.key}</span>
                      {unmapped && <span style={{ marginLeft: 8, fontSize: 10, color: WARN, border: `1px solid ${WARN}55`, borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase' }}>unmapped</span>}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    {dm.map((m) => (
                      <span key={m.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'var(--font-mono)', color: TEAL, border: `1px solid ${LINE}`, borderRadius: 6, padding: '3px 8px' }}>
                        {m.source_metric_key}<span style={{ color: TEXT4 }}>·{m.agg}</span>
                        {isAdmin && <button disabled={busy} onClick={() => removeMapping(d.key, m.source_metric_key)} title="Remove" style={{ background: 'none', border: 'none', color: TEXT4, cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>✕</button>}
                      </span>
                    ))}
                    {isAdmin && (
                      <select disabled={busy} defaultValue="" onChange={(e) => { addMapping(d.key, e.target.value); e.currentTarget.value = '' }}
                        style={{ fontSize: 12, background: '#0D0D0F', color: TEXT2, border: `1px dashed ${LINE}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
                        <option value="">+ add source…</option>
                        {keys.filter((k) => !used.has(k)).map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    )}
                    {!dm.length && !isAdmin && <span style={{ color: TEXT4, fontSize: 12, fontStyle: 'italic' }}>no source mapped</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

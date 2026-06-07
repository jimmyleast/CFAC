'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEAL = '#7DD3C7'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const WARN = '#E0846B'

type Def = {
  id: string; key: string; display_name: string; definition: string
  category: string; program_area: string | null; unit: string
  calc_rule: string | null; parent_key: string | null; owner: string | null
  source_note: string | null; is_dedup_rule: boolean; sort_order: number
}

const CATEGORY_LABELS: Record<string, string> = {
  impact: 'Impact metrics (the three the org reports on)',
  program_client: 'Per-program "client served" rules',
  service: 'Service categories',
  program: 'Program metrics',
  operational: 'Operational metrics',
}
const CATEGORY_ORDER = ['impact', 'program_client', 'service', 'program', 'operational']

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

export default function DefinitionsPage() {
  const [defs, setDefs] = useState<Def[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ definition: string; calc_rule: string; owner: string }>({ definition: '', calc_rule: '', owner: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [defRes, roleRes] = await Promise.all([
        authFetch('/api/definitions'),
        authFetch('/api/user/role').catch(() => null),
      ])
      if (defRes.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!defRes.ok) throw new Error(`HTTP ${defRes.status}`)
      const d = await defRes.json()
      setDefs(d.definitions || [])
      if (roleRes?.ok) { const r = await roleRes.json(); setIsAdmin(r.role === 'admin') }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  function startEdit(d: Def) {
    setEditing(d.key)
    setDraft({ definition: d.definition, calc_rule: d.calc_rule || '', owner: d.owner || '' })
  }

  async function save(key: string) {
    setSaving(true)
    try {
      const res = await authFetch('/api/definitions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, patch: draft }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Save failed (${res.status})`); return }
      setEditing(null); await load()
    } finally { setSaving(false) }
  }

  const grouped = CATEGORY_ORDER
    .map((cat) => ({ cat, items: defs.filter((d) => d.category === cat) }))
    .filter((g) => g.items.length > 0)

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Governance</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Operational Definitions</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 28px', maxWidth: 640 }}>
        The single source of truth for what every metric means, so teams stop counting differently. Each value the platform reports traces back to one of these definitions.
        {isAdmin ? ' As an admin you can refine the wording — changes apply org-wide.' : ''}
      </p>

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}
      {!loading && !err && defs.length === 0 && (
        <div style={{ color: TEXT4, fontStyle: 'italic' }}>No definitions loaded yet.</div>
      )}

      {!loading && grouped.map(({ cat, items }) => (
        <div key={cat} style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEAL, marginBottom: 12, fontWeight: 600 }}>
            {CATEGORY_LABELS[cat] || cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((d) => (
              <div key={d.id} style={{ background: BG2, border: `1px solid ${d.is_dedup_rule ? GOLD + '66' : LINE}`, borderRadius: 10, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>{d.display_name}</span>
                    {d.is_dedup_rule && <span style={{ marginLeft: 8, fontSize: 10, color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>dedup rule</span>}
                    <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 11, color: TEXT4 }}>{d.key}</span>
                  </div>
                  {isAdmin && editing !== d.key && (
                    <button onClick={() => startEdit(d)} style={{ background: 'none', border: `1px solid ${LINE}`, color: TEXT2, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Edit</button>
                  )}
                </div>

                {editing === d.key ? (
                  <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                    <label style={{ fontSize: 11, color: TEXT2 }}>Definition
                      <textarea value={draft.definition} onChange={(e) => setDraft({ ...draft, definition: e.target.value })} rows={4}
                        style={{ width: '100%', marginTop: 4, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: 10, resize: 'vertical' }} />
                    </label>
                    <label style={{ fontSize: 11, color: TEXT2 }}>Calculation rule
                      <textarea value={draft.calc_rule} onChange={(e) => setDraft({ ...draft, calc_rule: e.target.value })} rows={2}
                        style={{ width: '100%', marginTop: 4, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: 10, resize: 'vertical' }} />
                    </label>
                    <label style={{ fontSize: 11, color: TEXT2 }}>Owner
                      <input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                        style={{ width: '100%', marginTop: 4, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13, padding: '8px 10px' }} />
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={saving} onClick={() => save(d.key)} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 6, padding: '7px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
                      <button disabled={saving} onClick={() => setEditing(null)} style={{ background: 'none', border: `1px solid ${LINE}`, color: TEXT2, borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ color: '#D7D3CC', fontSize: 13, lineHeight: 1.6, margin: '10px 0 0' }}>{d.definition}</p>
                    {d.calc_rule && (
                      <div style={{ marginTop: 10, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 6, padding: '8px 10px' }}>
                        <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT4 }}>Calc rule</span>
                        <div style={{ color: TEXT2, fontSize: 12.5, fontFamily: 'var(--font-mono)', lineHeight: 1.5, marginTop: 4 }}>{d.calc_rule}</div>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: TEXT4, marginTop: 10 }}>
                      {d.owner && <span>Owner: <span style={{ color: TEXT2 }}>{d.owner}</span></span>}
                      {d.program_area && <span style={{ textTransform: 'capitalize' }}>{d.program_area.replace(/_/g, ' ')}</span>}
                      {d.parent_key && <span>rolls up → {d.parent_key}</span>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

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
const ON = '#1E9E6A'
const OFF = '#C2410C'
const WARN = '#E0846B'

type Measurable = {
  id: string; name: string; owner: string | null; goal: number | null; goalDirection: 'at_least' | 'at_most'
  unit: string; metricKey: string | null; component: string | null
  points: { period: string; value: number }[]; latest: number | null; status: 'on' | 'off' | 'unknown'
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}
const fmt = (n: number) => n.toLocaleString('en-US')

export default function ScorecardPage() {
  const [rows, setRows] = useState<Measurable[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', owner: '', goalValue: '', goalDirection: 'at_least', metricKey: '' })
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; value: string; dir: 'at_least' | 'at_most' } | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [sRes, roleRes] = await Promise.all([authFetch('/api/scorecard'), authFetch('/api/user/role').catch(() => null)])
      if (sRes.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!sRes.ok) throw new Error(`HTTP ${sRes.status}`)
      setRows((await sRes.json()).measurables || [])
      if (roleRes?.ok) setIsAdmin((await roleRes.json()).role === 'admin')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function add() {
    if (!draft.name.trim()) return
    setBusy(true)
    try {
      const res = await authFetch('/api/scorecard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name.trim(), owner: draft.owner.trim() || undefined, goalValue: draft.goalValue ? Number(draft.goalValue) : undefined, goalDirection: draft.goalDirection, metricKey: draft.metricKey.trim() || undefined }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) }
      else { setDraft({ name: '', owner: '', goalValue: '', goalDirection: 'at_least', metricKey: '' }); setAdding(false); await load() }
    } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!confirm('Remove this measurable from the scorecard?')) return
    setBusy(true)
    try {
      const res = await authFetch(`/api/scorecard?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else await load()
    } finally { setBusy(false) }
  }
  async function patchGoal(id: string, goalValue: number | null, goalDirection: 'at_least' | 'at_most') {
    setBusy(true)
    try {
      const res = await authFetch('/api/scorecard', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, goalValue, goalDirection }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) }
      else { setEditing(null); await load() }
    } finally { setBusy(false) }
  }

  // Distinct period columns across all rows (most recent up to 6), descending.
  const periods = Array.from(new Set(rows.flatMap((r) => r.points.map((p) => p.period)))).slice(-6)

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>EOS</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: 0 }}>Scorecard</h1>
        {isAdmin && <button onClick={() => setAdding((v) => !v)} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{adding ? 'Close' : 'Add measurable'}</button>}
      </div>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 20px', maxWidth: 660 }}>
        The weekly leading-indicator numbers the team runs on — each measurable has an owner, a goal, and its recent actuals. Linked measurables fill in automatically from your data.
      </p>

      {isAdmin && adding && (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 20, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Measurable (e.g. Cash on hand)" style={inp(1, 200)} />
            <input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Owner" style={inp(0, 120)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={draft.goalDirection} onChange={(e) => setDraft({ ...draft, goalDirection: e.target.value })} style={inp(0, 110)}>
              <option value="at_least">at least</option><option value="at_most">at most</option>
            </select>
            <input value={draft.goalValue} onChange={(e) => setDraft({ ...draft, goalValue: e.target.value })} placeholder="Goal value" inputMode="decimal" style={inp(0, 110)} />
            <input value={draft.metricKey} onChange={(e) => setDraft({ ...draft, metricKey: e.target.value })} placeholder="Link metric key (optional)" style={inp(1, 180)} />
            <button disabled={busy || !draft.name.trim()} onClick={add} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
          </div>
        </div>
      )}

      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      {!loading && !err && rows.length === 0 && (
        <div style={{ border: `1px dashed ${LINE}`, borderRadius: 12, padding: 32, color: TEXT2, textAlign: 'center' }}>
          <Icons.Target size={28} color={TEXT4} style={{ margin: '0 auto 12px' }} />
          <div>No measurables yet.{isAdmin ? ' Add the numbers your team reviews each week.' : ''}</div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                <th style={th(true)}>Measurable</th>
                <th style={th(true)}>Owner</th>
                <th style={th(false)}>Goal</th>
                {periods.map((p) => <th key={p} style={th(false)}>{p}</th>)}
                {isAdmin && <th style={th(false)} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const byPeriod = new Map(r.points.map((p) => [p.period, p.value]))
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                    <td style={td()}>
                      <span style={{ color: TEXT, fontWeight: 600 }}>{r.name}</span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', marginLeft: 8, background: r.status === 'on' ? ON : r.status === 'off' ? OFF : TEXT4 }} />
                      {r.component && <span style={{ marginLeft: 8, fontSize: 11, color: TEXT4 }}>{r.component}</span>}
                    </td>
                    <td style={{ ...td(), color: TEXT2 }}>{r.owner || '—'}</td>
                    <td style={{ ...td(), color: TEXT2 }}>
                      {editing?.id === r.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          <select value={editing.dir} onChange={(e) => setEditing({ ...editing, dir: e.target.value as 'at_least' | 'at_most' })} style={{ ...inp(0, 52), padding: '4px 6px' }}>
                            <option value="at_least">≥</option><option value="at_most">≤</option>
                          </select>
                          <input autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} inputMode="decimal" placeholder="goal"
                            onKeyDown={(e) => { if (e.key === 'Enter') void patchGoal(r.id, editing.value ? Number(editing.value) : null, editing.dir); if (e.key === 'Escape') setEditing(null) }}
                            style={{ ...inp(0, 64), padding: '4px 6px' }} />
                          <button disabled={busy} onClick={() => patchGoal(r.id, editing.value ? Number(editing.value) : null, editing.dir)} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>✓</button>
                          <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', color: TEXT4, cursor: 'pointer' }}>✕</button>
                        </span>
                      ) : isAdmin ? (
                        <button onClick={() => setEditing({ id: r.id, value: r.goal === null ? '' : String(r.goal), dir: r.goalDirection })} title="Set goal"
                          style={{ background: 'none', border: 'none', color: r.goal === null ? GOLD : TEXT2, cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: r.goal === null ? 'underline' : 'none' }}>
                          {r.goal === null ? 'set goal' : `${r.goalDirection === 'at_most' ? '≤' : '≥'} ${fmt(r.goal)}`}
                        </button>
                      ) : (
                        r.goal === null ? '—' : `${r.goalDirection === 'at_most' ? '≤' : '≥'} ${fmt(r.goal)}`
                      )}
                    </td>
                    {periods.map((p) => {
                      const v = byPeriod.get(p)
                      const g = r.goal
                      const on = v !== undefined && g !== null && (r.goalDirection === 'at_most' ? v <= g : v >= g)
                      // No goal set → show the actual in a neutral color (don't imply off-track).
                      const color = v === undefined ? TEXT4 : g === null ? TEXT : on ? ON : OFF
                      return <td key={p} style={{ ...td(), textAlign: 'right', color, fontWeight: v === undefined ? 400 : 600 }}>{v === undefined ? '·' : fmt(v)}</td>
                    })}
                    {isAdmin && <td style={{ ...td(), textAlign: 'right' }}><button disabled={busy} onClick={() => remove(r.id)} style={{ background: 'none', border: 'none', color: TEXT4, cursor: 'pointer', fontSize: 13 }}>✕</button></td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const inp = (flex: number, min: number): React.CSSProperties => ({ flex: flex || undefined, minWidth: min, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 12px' })
const th = (left: boolean): React.CSSProperties => ({ textAlign: left ? 'left' : 'right', padding: '8px 10px', color: TEXT2, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' })
const td = (): React.CSSProperties => ({ padding: '10px', whiteSpace: 'nowrap' })

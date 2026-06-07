'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT4 = '#555250'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const WARN = '#E0846B'
const ERR = '#EB5757'

type Provider = {
  id: string; name: string; authKind: 'oauth2' | 'apikey'; description: string
  phiAllowed: boolean; baa: 'yes' | 'no' | 'unknown'; configured: boolean
  blockedReason: 'phi_gate' | 'needs_setup' | null
  status: 'connected' | 'disconnected' | 'error'; externalLabel: string | null
  lastSyncAt: string | null; lastError: string | null
}

type FileSource = {
  id: string; name: string; slug: string; kind: string
  lastImportedAt: string | null; metricCount: number; issueCount: number
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(url, { ...opts, headers })
}

function Inner() {
  const params = useSearchParams()
  const [providers, setProviders] = useState<Provider[]>([])
  const [encryptionReady, setEncryptionReady] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [sources, setSources] = useState<FileSource[]>([])
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState('spreadsheet')
  const [creating, setCreating] = useState(false)
  const [inviteLink, setInviteLink] = useState<{ provider: string; link: string } | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const [cRes, sRes, roleRes] = await Promise.all([
        authFetch('/api/connections'),
        authFetch('/api/data/sources').catch(() => null),
        authFetch('/api/user/role').catch(() => null),
      ])
      if (cRes.status === 401) { setErr('Please sign in.'); setLoading(false); return }
      if (!cRes.ok) throw new Error(`HTTP ${cRes.status}`)
      const d = await cRes.json()
      setProviders(d.providers || []); setEncryptionReady(d.encryptionReady !== false)
      if (sRes?.ok) { const sd = await sRes.json(); setSources(sd.sources || []) }
      if (roleRes?.ok) { const r = await roleRes.json(); setIsAdmin(r.role === 'admin') }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function createSource() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await authFetch('/api/data/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, kind: newKind }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) }
      else { setNewName(''); await load() }
    } finally { setCreating(false) }
  }

  async function connectApiKey(id: string) {
    const apiKey = (keyDraft[id] || '').trim()
    if (!apiKey) return
    setBusy(id)
    try {
      const res = await authFetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: id, apiKey }) })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) }
      else { setKeyDraft({ ...keyDraft, [id]: '' }); await load() }
    } finally { setBusy(null) }
  }
  async function inviteOwner(id: string) {
    setBusy(id); setInviteLink(null)
    try {
      const res = await authFetch('/api/connect-invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: id }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert(d.error || `Failed (${res.status})`); return }
      setInviteLink({ provider: id, link: d.link })
      try { await navigator.clipboard.writeText(d.link) } catch { /* clipboard may be blocked */ }
    } finally { setBusy(null) }
  }
  async function syncNow(id: string) {
    setBusy(id)
    try {
      const res = await authFetch(`/api/connections/${encodeURIComponent(id)}/sync`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) alert(d.error || `Sync failed (${res.status})`)
      else alert(`Synced — ${d.rows ?? 0} metric(s) loaded.`)
      await load()
    } finally { setBusy(null) }
  }
  async function disconnect(id: string) {
    if (!confirm(`Disconnect ${id}? Stored credentials will be removed.`)) return
    setBusy(id)
    try {
      const res = await authFetch(`/api/connections?provider=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || `Failed (${res.status})`) } else await load()
    } finally { setBusy(null) }
  }

  const connectedFlag = params.get('connected')
  const errorFlag = params.get('error')

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Admin</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 30, color: TEXT, margin: '0 0 6px' }}>Connections</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, margin: '0 0 24px', maxWidth: 640 }}>
        Link the systems CFAC uses so the platform can pull data automatically. Credentials are encrypted at rest and never leave the server. PHI-bearing systems stay gated until the compliance prerequisites are met.
      </p>

      {connectedFlag && <Banner color={OK}>Connected {connectedFlag}.</Banner>}
      {errorFlag && <Banner color={ERR}>Connection failed: {errorFlag.replace(/_/g, ' ')}.</Banner>}
      {!encryptionReady && <Banner color={ERR}>Token encryption key (CONNECTOR_ENC_KEY) is not set — connecting is disabled until it is configured in the server env.</Banner>}
      {loading && <div style={{ color: TEXT2 }}>Loading…</div>}
      {err && <div style={{ color: WARN }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {providers.map((p) => {
          const statusColor = p.status === 'connected' ? OK : p.status === 'error' ? ERR : TEXT4
          return (
            <div key={p.id} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: TEXT }}>{p.name}</span>
                    <span style={{ fontSize: 10, color: statusColor, border: `1px solid ${statusColor}66`, borderRadius: 4, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{p.status}</span>
                    <span style={{ fontSize: 10, color: p.baa === 'yes' ? OK : p.baa === 'no' ? WARN : TEXT4 }}>
                      {p.baa === 'yes' ? 'BAA ✓ PHI-ok' : p.baa === 'no' ? 'no BAA · non-PHI' : 'BAA unverified'}
                    </span>
                  </div>
                  <div style={{ color: TEXT2, fontSize: 12.5, marginTop: 4 }}>{p.description}</div>
                  {p.status === 'connected' && p.lastSyncAt && <div style={{ color: TEXT4, fontSize: 11, marginTop: 3 }}>Last synced {new Date(p.lastSyncAt).toLocaleString()}</div>}
                  {p.lastError && <div style={{ color: ERR, fontSize: 11, marginTop: 4 }}>Last error: {p.lastError}</div>}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {p.status === 'connected' ? (
                    isAdmin && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button disabled={busy === p.id} onClick={() => syncNow(p.id)} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{busy === p.id ? 'Syncing…' : 'Sync now'}</button>
                        <button disabled={busy === p.id} onClick={() => disconnect(p.id)} style={{ background: 'none', border: `1px solid ${LINE}`, color: WARN, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>Disconnect</button>
                      </div>
                    )
                  ) : !p.configured && p.authKind === 'oauth2' ? (
                    <span style={{ fontSize: 12, color: TEXT4, fontStyle: 'italic' }}>{p.blockedReason === 'phi_gate' ? 'PHI gate pending' : 'needs setup'}</span>
                  ) : p.authKind === 'oauth2' ? (
                    isAdmin && <a href={`/api/connect/${p.id}/start`} style={{ background: GOLD, color: '#0D0D0F', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Connect</a>
                  ) : null}
                </div>
              </div>

              {/* API-key connect form + delegated invite */}
              {isAdmin && p.authKind === 'apikey' && p.status !== 'connected' && encryptionReady && (
                <>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <input type="password" value={keyDraft[p.id] || ''} onChange={(e) => setKeyDraft({ ...keyDraft, [p.id]: e.target.value })}
                      placeholder={`${p.name} API key`} style={{ flex: 1, minWidth: 200, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 12px' }} />
                    <button disabled={busy === p.id || !(keyDraft[p.id] || '').trim()} onClick={() => connectApiKey(p.id)}
                      style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Connect</button>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: TEXT2 }}>
                    Don&apos;t have the key? <button disabled={busy === p.id} onClick={() => inviteOwner(p.id)} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 12 }}>Invite the system owner to connect it</button> — they paste their own key.
                  </div>
                  {inviteLink?.provider === p.id && (
                    <div style={{ marginTop: 8, background: '#0D0D0F', border: `1px solid ${GOLD}55`, borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: OK, marginBottom: 6 }}>✓ Invite link created (copied to clipboard). Send it to the owner — it expires in 7 days and works once.</div>
                      <input readOnly value={inviteLink.link} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%', background: '#000', border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT2, fontSize: 11, padding: '6px 8px', fontFamily: 'var(--font-mono)' }} />
                    </div>
                  )}
                </>
              )}
              {!p.phiAllowed && <div style={{ fontSize: 11, color: TEXT4, marginTop: 10 }}>⚠ No BAA — connect for non-PHI data only.</div>}
            </div>
          )
        })}
      </div>

      {/* Files & spreadsheets — the no-API sources (Collaborate exports, the 12 sheets). */}
      {!loading && (
        <div style={{ marginTop: 36 }}>
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 20, color: TEXT, margin: '0 0 4px' }}>Files &amp; spreadsheets</h2>
          <p style={{ color: TEXT2, fontSize: 12.5, margin: '0 0 16px', maxWidth: 640 }}>
            For systems without an API (Collaborate exports, the reporting spreadsheets), register the source here, then upload its file — the platform parses, validates, and loads it.
          </p>

          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New source name (e.g. Collaborate Export)"
                style={{ flex: 1, minWidth: 220, background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 12px' }} />
              <select value={newKind} onChange={(e) => setNewKind(e.target.value)} style={{ background: '#0D0D0F', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 13, padding: '8px 10px' }}>
                <option value="spreadsheet">Spreadsheet</option>
                <option value="form">Form</option>
                <option value="manual">Manual</option>
                <option value="system">System export</option>
              </select>
              <button disabled={creating || !newName.trim()} onClick={createSource} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{creating ? 'Adding…' : 'Add source'}</button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sources.map((s) => (
              <div key={s.id} style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{s.name}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: TEXT4, textTransform: 'capitalize' }}>{s.kind}</span>
                  <div style={{ fontSize: 11.5, color: TEXT2, marginTop: 3 }}>
                    {s.metricCount} metrics · {s.lastImportedAt ? `updated ${new Date(s.lastImportedAt).toLocaleDateString()}` : 'no data yet'}
                    {s.issueCount > 0 && <span style={{ color: WARN }}> · {s.issueCount} issues</span>}
                  </div>
                </div>
                {isAdmin && (
                  <a href={`/admin/data/import?source=${encodeURIComponent(s.slug)}`} style={{ background: 'rgba(91,163,217,0.12)', border: `1px solid ${GOLD}`, color: GOLD, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>Upload data</a>
                )}
              </div>
            ))}
            {!sources.length && <div style={{ color: TEXT4, fontSize: 13, fontStyle: 'italic' }}>No file sources yet.{isAdmin ? ' Add one above.' : ''}</div>}
          </div>
        </div>
      )}

      {!loading && !isAdmin && <div style={{ color: TEXT4, fontSize: 12, fontStyle: 'italic', marginTop: 16 }}>Connecting systems is admin-only.</div>}
    </div>
  )
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return <div style={{ color, fontSize: 13, padding: '10px 14px', border: `1px solid ${color}55`, borderRadius: 8, background: `${color}11`, marginBottom: 16 }}>{children}</div>
}

export default function ConnectionsPage() {
  return <Suspense fallback={<div style={{ padding: 40, color: TEXT2 }}>Loading…</div>}><Inner /></Suspense>
}

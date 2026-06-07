'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Pinwheel from '@/components/Pinwheel'

const GOLD = '#5BA3D9'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const OK = '#7DD3C7'
const WARN = '#E0846B'

type State =
  | { phase: 'loading' }
  | { phase: 'invalid'; reason: string }
  | { phase: 'form'; provider: { id: string; name: string; description: string } }
  | { phase: 'done'; provider: string }

export default function ConnectInvitePage() {
  const params = useParams()
  const token = String(params?.token || '')
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [apiKey, setApiKey] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/connect-invites/${encodeURIComponent(token)}`).catch(() => null)
      if (!res) { setState({ phase: 'invalid', reason: 'network' }); return }
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.status === 'ok') setState({ phase: 'form', provider: d.provider })
      else setState({ phase: 'invalid', reason: d.status || 'invalid' })
    })()
  }, [token])

  async function submit() {
    if (!apiKey.trim()) { setErr('Please paste your API key.'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/connect-invites/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim(), name: name.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(d.error || `Failed (${res.status})`); return }
      setState({ phase: 'done', provider: d.provider })
    } finally { setBusy(false) }
  }

  const reasonText: Record<string, string> = {
    used: 'This invite link has already been used.',
    expired: 'This invite link has expired. Ask your administrator for a new one.',
    not_found: 'This invite link is not valid.',
    rate_limited: 'Too many attempts — please wait a minute and refresh.',
    network: 'Could not reach the server. Please try again.',
    invalid: 'This invite link is not valid.',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'grid', placeItems: 'center', padding: 24, color: TEXT }}>
      <div style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Pinwheel size={48} /></div>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 28, color: GOLD, marginBottom: 6 }}>CFAC</div>

        {state.phase === 'loading' && <div style={{ color: TEXT2 }}>Checking your invite…</div>}

        {state.phase === 'invalid' && (
          <div style={{ color: WARN, fontSize: 14, marginTop: 12 }}>{reasonText[state.reason] || reasonText.invalid}</div>
        )}

        {state.phase === 'done' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: OK, fontSize: 16, fontWeight: 600 }}>✓ {state.provider} is connected.</div>
            <p style={{ color: TEXT2, fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>Thank you. CFAC can now pull data from {state.provider}. You can close this page.</p>
          </div>
        )}

        {state.phase === 'form' && (
          <div style={{ textAlign: 'left', marginTop: 12 }}>
            <p style={{ color: TEXT2, fontSize: 14, lineHeight: 1.6, marginBottom: 20, textAlign: 'center' }}>
              You&apos;ve been asked to connect <strong style={{ color: TEXT }}>{state.provider.name}</strong> to CFAC. Paste your API key below — it&apos;s encrypted and stored securely; no one at CFAC sees it.
            </p>
            <label style={{ fontSize: 12, color: TEXT2, display: 'block', marginBottom: 6 }}>Your name (optional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe"
              style={{ width: '100%', background: '#1C1C20', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 14, padding: '11px 14px', marginBottom: 14, boxSizing: 'border-box' }} />
            <label style={{ fontSize: 12, color: TEXT2, display: 'block', marginBottom: 6 }}>{state.provider.name} API key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your API key"
              style={{ width: '100%', background: '#1C1C20', border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, fontSize: 14, padding: '11px 14px', boxSizing: 'border-box' }} />
            {err && <div style={{ color: WARN, fontSize: 13, marginTop: 12 }}>{err}</div>}
            <button disabled={busy || !apiKey.trim()} onClick={submit}
              style={{ width: '100%', marginTop: 16, background: busy || !apiKey.trim() ? 'rgba(91,163,217,0.4)' : GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '13px', fontWeight: 600, fontSize: 15, cursor: busy || !apiKey.trim() ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Connecting…' : `Connect ${state.provider.name}`}
            </button>
            <p style={{ color: TEXT2, fontSize: 11, marginTop: 12, textAlign: 'center' }}>This link works once and expires after 7 days.</p>
          </div>
        )}
      </div>
    </div>
  )
}

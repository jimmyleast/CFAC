'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const WARN = '#E0846B'

function MfaChallengeInner() {
  const params = useSearchParams()
  const next = params.get('next') || '/home'
  // Avoid open-redirects: require a single leading slash followed by a non-slash,
  // non-backslash char. Rejects //evil.com, /\evil.com, /\/evil.com, https://…
  // (browsers normalize backslashes to slashes, so they must be excluded too).
  const safeNext = /^\/[^/\\]/.test(next) ? next : '/home'
  const supabase = createClient()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function init() {
    setLoading(true); setErr(null)
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.currentLevel === 'aal2') { window.location.assign(safeNext); return }
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      const factor = (data?.totp || []).find((f) => f.status === 'verified')
      if (!factor) { window.location.assign(safeNext); return } // no 2FA enrolled → nothing to challenge
      setFactorId(factor.id)
      setLoading(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start verification. Please retry.')
      setLoading(false)
    }
  }

  useEffect(() => { void init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function verify() {
    if (!factorId || code.length !== 6) return
    setBusy(true); setErr(null)
    try {
      // Create a fresh challenge at verify-time so it can't expire while the user types.
      const ch = await supabase.auth.mfa.challenge({ factorId })
      if (ch.error) { setErr(ch.error.message); setBusy(false); return }
      const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code })
      if (v.error) { setErr(v.error.message); setCode(''); setBusy(false); return }
      // Full-page navigation (not router.replace) so the server re-reads the now-AAL2
      // session and we don't bounce back here on a stale client-side route.
      window.location.assign(safeNext)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verification failed. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0F', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 40, color: GOLD, marginBottom: 4 }}>CFAC</div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22, color: TEXT, margin: '12px 0 8px' }}>Two-factor verification</h1>
        <p style={{ color: TEXT2, fontSize: 14, marginBottom: 24 }}>Enter the 6-digit code from your authenticator app.</p>
        {loading ? <div style={{ color: TEXT2 }}>Preparing…</div> : !factorId ? (
          <>
            {err && <div style={{ color: WARN, fontSize: 13, marginBottom: 12 }}>{err}</div>}
            <button onClick={() => void init()}
              style={{ width: '100%', background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '13px', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
              Retry
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.assign('/auth/login') }}
              style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 12, marginTop: 16, cursor: 'pointer' }}>Sign out</button>
          </>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') verify() }}
              placeholder="123456" inputMode="numeric" autoFocus
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, borderRadius: 8, padding: '14px', color: TEXT, fontSize: 22, letterSpacing: '0.3em', textAlign: 'center' }}
            />
            {err && <div style={{ color: WARN, fontSize: 13, marginTop: 12 }}>{err}</div>}
            <button disabled={busy || code.length !== 6} onClick={verify}
              style={{ width: '100%', marginTop: 16, background: code.length === 6 ? GOLD : 'rgba(201,168,76,0.35)', color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '13px', fontWeight: 600, fontSize: 15, cursor: code.length === 6 ? 'pointer' : 'not-allowed' }}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.assign('/auth/login') }}
              style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 12, marginTop: 16, cursor: 'pointer' }}>Sign out</button>
          </>
        )}
      </div>
    </div>
  )
}

export default function MfaChallengePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0D0D0F' }} />}>
      <MfaChallengeInner />
    </Suspense>
  )
}

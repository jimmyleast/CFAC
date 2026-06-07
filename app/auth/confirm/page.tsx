'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Handles Supabase auth redirects for:
 * - Password reset (type=recovery)
 * - Magic link (type=magiclink)
 *
 * Depending on Supabase flow settings, auth data can arrive as:
 * - Query params (PKCE): ?code=...&type=...
 * - URL hash tokens: #access_token=...&refresh_token=...&type=...
 */
export default function ConfirmPage() {
  const [status, setStatus] = useState<'loading' | 'reset' | 'done' | 'error'>('loading')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    const url = new URL(window.location.href)
    const code = url.searchParams.get('code')
    const queryType = url.searchParams.get('type')
    const tokenHash = url.searchParams.get('token_hash')
    const mode = url.searchParams.get('mode')
    const isRecoveryIntent = mode === 'recovery' || queryType === 'recovery'

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          if (isRecoveryIntent) {
            setStatus('reset')
            return
          }
          setStatus('error')
          return
        }
        if (isRecoveryIntent) {
          setStatus('reset')
        } else {
          window.location.href = '/'
        }
      })
      return
    }

    if (tokenHash && queryType) {
      supabase.auth.verifyOtp({ type: queryType as any, token_hash: tokenHash }).then(({ error }) => {
        if (error) { setStatus('error'); return }
        if (isRecoveryIntent) {
          setStatus('reset')
        } else {
          window.location.href = '/'
        }
      })
      return
    }

    const hash = window.location.hash
    if (!hash) {
      if (isRecoveryIntent) {
        setStatus('reset')
      } else {
        window.location.href = '/auth/login'
      }
      return
    }

    const params = new URLSearchParams(hash.replace('#', '?'))
    const type = params.get('type')
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (!accessToken || !refreshToken) { window.location.href = '/auth/login'; return }

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
      if (error) { setStatus('error'); return }
      if (type === 'recovery' || mode === 'recovery') {
        setStatus('reset')
      } else {
        // Magic link or other — just go home
        window.location.href = '/'
      }
    })
  }, [])

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      const msg = /auth session missing|session/i.test(error.message)
        ? 'This reset link has expired or was already used. Request a new password reset email and open it right away.'
        : error.message
      setError(msg)
      setSaving(false)
      return
    }
    setStatus('done')
    setTimeout(() => { window.location.href = '/' }, 2000)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: '#1C1C20',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: '11px 14px', color: '#F0EDE6', fontSize: 14,
    outline: 'none', boxSizing: 'border-box',
    fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0D0D0F', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: '0 24px' }}>

        {status === 'loading' && (
          <p style={{ color: '#555250', textAlign: 'center' }}>Verifying…</p>
        )}

        {status === 'error' && (
          <p style={{ color: '#C4605A', textAlign: 'center' }}>Link is invalid or expired. <a href="/auth/login" style={{ color: '#5BA3D9' }}>Back to sign in</a></p>
        )}

        {status === 'done' && (
          <p style={{ color: '#5BA3D9', textAlign: 'center' }}>Password updated — redirecting…</p>
        )}

        {status === 'reset' && (
          <>
            <h2 style={{ color: '#F0EDE6', fontSize: 22, fontWeight: 600, marginBottom: 24 }}>Set a new password</h2>
            <form onSubmit={handleSetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#8A8680', marginBottom: 6, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>New password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" required style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#8A8680', marginBottom: 6, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600 }}>Confirm password</label>
                <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required style={inputStyle} />
              </div>
              {error && <p style={{ color: '#C4605A', fontSize: 13, margin: 0 }}>{error}</p>}
              <button
                type="submit"
                disabled={saving}
                style={{
                  width: '100%', background: saving ? 'rgba(91,163,217,0.35)' : '#5BA3D9',
                  border: 'none', borderRadius: 8, padding: '13px 0', color: '#0D0D0F',
                  fontWeight: 600, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
                }}
              >
                {saving ? 'Saving…' : 'Set Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const ALLOWED_SIGNUP_DOMAINS = ['cfacbentonco.com']

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1C1C20',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8, padding: '11px 14px', color: '#F0EDE6', fontSize: 14,
  outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
  fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#8A8680', marginBottom: 6,
  letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600,
}

function friendlyError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.'
  if (/email not confirmed/i.test(msg)) return 'Incorrect email or password.'
  if (/user already registered/i.test(msg)) return 'An account with this email already exists. Try signing in instead.'
  if (/missing required environment variable/i.test(msg)) return msg
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the auth service. Verify the production environment and try again.'
  return msg
}

function PasswordInput({ value, onChange, placeholder, disabled, id }: {
  value: string; onChange: (v: string) => void; placeholder: string; disabled: boolean; id: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        disabled={disabled}
        style={{ ...inputStyle, paddingRight: 44 }}
        onFocus={e => { e.target.style.borderColor = '#C9A84C' }}
        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)' }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#555250', fontSize: 13, padding: '2px 4px', lineHeight: 1,
        }}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function switchMode(m: 'signin' | 'signup') {
    setMode(m)
    setError('')
    setSuccess('')
    setPassword('')
    setConfirmPassword('')
  }

  async function handleResetPassword() {
    if (!email.trim()) { setError('Enter your email address above, then click reset.'); return }
    setError('')
    setLoading(true)
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(friendlyError(payload?.error || 'Unable to send reset email right now.'))
        return
      }
      setSuccess('Password reset email sent — check your inbox.')
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    const normalizedEmail = email.trim().toLowerCase()
    const supabase = createClient()

    function safeNextPath() {
      const next = new URLSearchParams(window.location.search).get('next') || ''
      return next.startsWith('/') && !next.startsWith('//') ? next : '/hub'
    }

    async function finishLoginRedirect() {
      await fetch('/api/auth/setup-profile', { method: 'POST' }).catch(() => null)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const meRes = await fetch('/api/me', { cache: 'no-store' }).catch(() => null)
        if (meRes?.ok) {
          window.location.assign(safeNextPath())
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }

      window.location.assign(safeNextPath())
    }

    try {
      const { error: clientError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (!clientError) {
        await finishLoginRedirect()
        return
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, password }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(friendlyError(clientError.message || payload?.error || 'Invalid email or password.'))
        return
      }

      await finishLoginRedirect()
    } catch (err) {
      console.error('Sign in error:', err)
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setError(friendlyError(message))
    } finally {
      setLoading(false)
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const domain = email.trim().split('@')[1]?.toLowerCase()
    if (!ALLOWED_SIGNUP_DOMAINS.includes(domain)) {
      setError(`Sign-up is restricted to ${ALLOWED_SIGNUP_DOMAINS.join(' and ')} email addresses.`)
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      if (error) { setError(friendlyError(error.message)); return }
      // Create user_profiles row immediately after signup
      if (data.user) {
        await fetch('/api/auth/setup-profile', { method: 'POST' }).catch(() => null)
      }
      // If email confirmation is disabled, Supabase returns a session immediately
      if (data.session) {
        window.location.assign('/hub')
        return
      }
      setMode('signin')
      setError('')
      setSuccess('Account created — you can now sign in.')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      console.error('Sign up error:', err)
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.'
      setError(friendlyError(message))
    } finally {
      setLoading(false)
    }
  }

  const btnSignInDisabled = loading || !email.trim() || !password
  const btnSignUpDisabled = loading || !email.trim() || !password || !confirmPassword

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif' }}>

      {/* ── LEFT: Brand panel ─────────────────────────────── */}
      <div style={{
        flex: 1, background: '#141416',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '60px 48px',
        borderRight: '1px solid rgba(201,168,76,0.12)',
        position: 'relative',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, letterSpacing: '0.06em', fontSize: 56, color: '#C9A84C', marginBottom: 4, lineHeight: 1 }}>
            CFAC
          </div>
          <div style={{ fontSize: 11, letterSpacing: '.2em', textTransform: 'uppercase', color: '#555250', marginBottom: 28, fontWeight: 600 }}>Children &amp; Family Advocacy Center</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, letterSpacing: '0.02em', fontSize: 28, color: '#F0EDE6', marginBottom: 24, lineHeight: 1.1 }}>
            Data &amp; Operations
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#F0EDE6', lineHeight: 1.8, marginBottom: 20 }}>
            Track Data.<br />Measure Impact.<br />Serve Families.
          </div>
          <div style={{ width: 40, height: 2, background: '#C9A84C', margin: '0 auto 20px', borderRadius: 1 }} />
          <p style={{ color: '#555250', fontSize: 15, lineHeight: 1.6 }}>Internal operations &amp; data platform for CFAC staff.</p>
        </div>
        <div style={{ position: 'absolute', bottom: 28, fontSize: 11, color: '#2A2A2C', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Children &amp; Family Advocacy Center · Internal Tool
        </div>
      </div>

      {/* ── RIGHT: Auth panel ──────────────────────────────── */}
      <div style={{ flex: 1, background: '#0D0D0F', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 48px' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>

          {/* Tab toggle */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 36, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            {(['signin', 'signup'] as const).map((m) => {
              const active = mode === m
              return (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '10px 0', marginRight: 28,
                    fontSize: 15, fontWeight: active ? 600 : 400,
                    color: active ? '#C9A84C' : '#555250',
                    borderBottom: active ? '2px solid #C9A84C' : '2px solid transparent',
                    marginBottom: -1, transition: 'color 0.15s',
                    fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
                  }}
                >
                  {m === 'signin' ? 'Sign In' : 'Sign Up'}
                </button>
              )
            })}
          </div>

          {success && (
            <div style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.25)', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
              <p style={{ color: '#C9A84C', fontSize: 13, margin: 0 }}>{success}</p>
            </div>
          )}

          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle} htmlFor="si-email">Email address</label>
                <input
                  id="si-email"
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@cfacbentonco.com" required disabled={loading}
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = '#C9A84C' }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)' }}
                />
              </div>
              <div>
                <label style={labelStyle} htmlFor="si-pw">Password</label>
                <PasswordInput id="si-pw" value={password} onChange={setPassword} placeholder="••••••••" disabled={loading} />
              </div>
              {error && <p style={{ color: '#C4605A', fontSize: 13, margin: 0, lineHeight: 1.5 }}>{error}</p>}
              <button
                type="submit" disabled={btnSignInDisabled}
                style={{
                  width: '100%', background: btnSignInDisabled ? 'rgba(201,168,76,0.35)' : '#C9A84C',
                  border: 'none', borderRadius: 8, padding: '13px 0', color: '#0D0D0F',
                  fontWeight: 600, fontSize: 14, cursor: btnSignInDisabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', marginTop: 4,
                }}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={loading}
                style={{
                  background: 'transparent', border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                  color: '#555250', fontSize: 12, padding: 0, textAlign: 'center', width: '100%',
                  fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
                }}
              >
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={labelStyle} htmlFor="su-email">Email address</label>
                <input
                  id="su-email"
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@cfacbentonco.com" required disabled={loading}
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = '#C9A84C' }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)' }}
                />
              </div>
              <div>
                <label style={labelStyle} htmlFor="su-pw">Password</label>
                <PasswordInput id="su-pw" value={password} onChange={setPassword} placeholder="Min 8 characters" disabled={loading} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="su-cpw">Confirm password</label>
                <PasswordInput id="su-cpw" value={confirmPassword} onChange={setConfirmPassword} placeholder="••••••••" disabled={loading} />
              </div>
              {error && <p style={{ color: '#C4605A', fontSize: 13, margin: 0, lineHeight: 1.5 }}>{error}</p>}
              <button
                type="submit" disabled={btnSignUpDisabled}
                style={{
                  width: '100%', background: btnSignUpDisabled ? 'rgba(201,168,76,0.35)' : '#C9A84C',
                  border: 'none', borderRadius: 8, padding: '13px 0', color: '#0D0D0F',
                  fontWeight: 600, fontSize: 14, cursor: btnSignUpDisabled ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif', marginTop: 4,
                }}
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
              <p style={{ color: '#454340', fontSize: 12, textAlign: 'center', margin: 0 }}>
                Restricted to @cfacbentonco.com addresses.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

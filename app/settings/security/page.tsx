'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const GOLD = '#C9A84C'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const LINE = '#2A2A2A'
const BG2 = 'rgba(255,255,255,0.025)'
const OK = '#7DD3C7'
const WARN = '#E0846B'

type Factor = { id: string; friendly_name?: string | null; status: string }

export default function SecurityPage() {
  const router = useRouter()
  // Browser-only client: null during static prerender (no NEXT_PUBLIC_* at build),
  // real client after hydration. All usage below is in effects/handlers (browser).
  const [supabase] = useState(() => (typeof window === 'undefined' ? null : createClient()))
  const [factors, setFactors] = useState<Factor[]>([])
  const [loading, setLoading] = useState(true)
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function refresh() {
    if (!supabase) return
    setLoading(true)
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors([...(data?.totp || [])] as Factor[])
    setLoading(false)
  }
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function startEnroll() {
    if (!supabase) return
    setMsg(null); setBusy(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
  }

  async function verifyEnroll() {
    if (!supabase || !enroll || !code.trim()) return
    setMsg(null); setBusy(true)
    const ch = await supabase.auth.mfa.challenge({ factorId: enroll.id })
    if (ch.error) { setBusy(false); setMsg(ch.error.message); return }
    const v = await supabase.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.data.id, code: code.trim() })
    setBusy(false)
    if (v.error) { setMsg(v.error.message); return }
    setEnroll(null); setCode(''); setMsg('Two-factor authentication enabled.')
    refresh()
  }

  async function removeFactor(id: string) {
    if (!supabase) return
    setBusy(true)
    await supabase.auth.mfa.unenroll({ factorId: id })
    setBusy(false)
    refresh()
  }

  const hasMfa = factors.some((f) => f.status === 'verified')

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      <button onClick={() => router.push('/settings')} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>← Settings</button>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Security</div>
      <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 28, color: TEXT, margin: '0 0 6px' }}>Two-Factor Authentication</h1>
      <p style={{ color: TEXT2, fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
        CFAC requires 2FA to protect sensitive data (HIPAA / SOC 2). Add an authenticator app (Google Authenticator, Authy, 1Password) below. Once enabled, you’ll enter a 6-digit code at each sign-in.
      </p>

      <div style={{ background: BG2, border: `1px solid ${LINE}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 15, color: TEXT }}>Authenticator app</span>
          <span style={{ fontSize: 12, color: hasMfa ? OK : WARN }}>{hasMfa ? '● Enabled' : '● Not enabled'}</span>
        </div>

        {loading ? <div style={{ color: TEXT2 }}>Loading…</div> : (
          <>
            {factors.map((f) => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${LINE}` }}>
                <span style={{ color: TEXT, fontSize: 14 }}>{f.friendly_name || 'Authenticator'} <span style={{ color: TEXT2, fontSize: 12 }}>({f.status})</span></span>
                <button disabled={busy} onClick={() => removeFactor(f.id)} style={{ background: 'none', border: `1px solid ${LINE}`, color: WARN, borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}

            {!enroll && (
              <button disabled={busy} onClick={startEnroll} style={{ marginTop: 14, background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                {hasMfa ? 'Add another device' : 'Enable 2FA'}
              </button>
            )}

            {enroll && (
              <div style={{ marginTop: 16, borderTop: `1px solid ${LINE}`, paddingTop: 16 }}>
                <p style={{ color: TEXT2, fontSize: 13, marginBottom: 12 }}>Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enroll.qr} alt="2FA QR code" style={{ width: 180, height: 180, background: '#fff', borderRadius: 8, marginBottom: 10 }} />
                <div style={{ color: TEXT2, fontSize: 11, marginBottom: 12, wordBreak: 'break-all' }}>Or enter this secret manually: <span style={{ color: TEXT, fontFamily: 'monospace' }}>{enroll.secret}</span></div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" inputMode="numeric"
                    style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', color: TEXT, fontSize: 16, letterSpacing: '0.2em' }} />
                  <button disabled={busy || code.length !== 6} onClick={verifyEnroll} style={{ background: GOLD, color: '#0D0D0F', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>Verify</button>
                </div>
              </div>
            )}
            {msg && <div style={{ marginTop: 12, color: msg.includes('enabled') ? OK : WARN, fontSize: 13 }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  )
}

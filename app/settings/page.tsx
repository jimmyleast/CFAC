'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const ROLE_LABELS: Record<string, string> = {
  student: 'Student / Trainee',
  staff: 'Instructor / Staff',
  admin: 'Leadership / Admin',
  developer: 'Developer / Tech',
}

export default function SettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('')
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [changingRole, setChangingRole] = useState(false)

  useEffect(() => {
    const init = async () => {
      const meRes = await fetch('/api/me')
      if (meRes.status === 401) { router.replace('/auth/login'); return }
      const me = meRes.ok ? await meRes.json() : null
      if (me) {
        setEmail(me.email || '')
        setDisplayName(me.display_name || '')
        setEditName(me.display_name || '')
        setPhone(me.phone || '')
        setEditPhone(me.phone || '')
      }

      const roleRes = await fetch('/api/user/role')
      if (roleRes.ok) {
        const data = await roleRes.json()
        setRole(data.role || '')
      }

      setLoading(false)
    }
    void init()
  }, [router])

  async function saveProfile() {
    setSaving(true)
    setSaveError('')
    const res = await fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: editName, phone: editPhone }),
    })
    if (res.ok) {
      setDisplayName(editName)
      setPhone(editPhone)
      setEditing(false)
    } else {
      const err = await res.json().catch(() => ({}))
      setSaveError(err.error || 'Failed to save')
    }
    setSaving(false)
  }

  async function changeRole() {
    setChangingRole(true)
    router.push('/onboarding')
  }

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/auth/login'
  }

  if (loading) {
    return (
      <div className="page-shell" style={{ maxWidth: 480 }}>
        <style>{`@keyframes stShim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } } .st-skel { background: linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.02) 100%); background-size: 200% 100%; animation: stShim 1.4s ease-in-out infinite; display: block; }`}</style>
        <div style={{ marginBottom: 28 }}>
          <span className="st-skel" style={{ height: 11, width: 80, marginBottom: 10 }} />
          <span className="st-skel" style={{ height: 32, width: 200, marginBottom: 8 }} />
          <span className="st-skel" style={{ height: 13, width: 240 }} />
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.025)', border: '1px solid #2A2A2A',
          padding: '24px', display: 'grid', gap: 14,
        }}>
          <span className="st-skel" style={{ height: 12, width: 80 }} />
          <span className="st-skel" style={{ height: 36 }} />
          <span className="st-skel" style={{ height: 12, width: 80 }} />
          <span className="st-skel" style={{ height: 36 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="page-shell" style={{ maxWidth: 480 }}>
      {/* Canonical header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: '#C9A84C', marginBottom: 8,
        }}>Account</div>
        <h1 style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36,
          letterSpacing: '0.02em', textTransform: 'uppercase',
          marginBottom: 6, color: '#F0EDE6',
        }}>Settings</h1>
        <p style={{ fontSize: 13, color: '#8A8680', maxWidth: 480, lineHeight: 1.5 }}>
          Your profile, preferences, and account details.
        </p>
      </div>

      <div className="surface-card" style={{ padding: '24px' }}>
        {editing ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Display Name</label>
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                style={{ width: '100%', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Phone</label>
              <input
                value={editPhone}
                onChange={e => setEditPhone(e.target.value)}
                placeholder="e.g. +1 555 000 0000"
                style={{ width: '100%', background: 'var(--surface-raised)', border: '1px solid var(--border)', padding: '8px 12px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            {saveError && <div style={{ fontSize: 12, color: '#EB5757', marginBottom: 12 }}>{saveError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={saveProfile} disabled={saving} className="btn btn-primary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setEditing(false); setEditName(displayName); setEditPhone(phone); setSaveError('') }} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Name</div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{displayName || '—'}</div>
                </div>
                <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit</button>
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Email</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{email}</div>
            </div>

            {phone && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Phone</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{phone}</div>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Role</div>
                  <div style={{ fontWeight: 600 }}>{ROLE_LABELS[role] || role || 'Not set'}</div>
                </div>
                <button onClick={changeRole} disabled={changingRole} className="btn btn-ghost btn-sm">Change</button>
              </div>
            </div>
          </>
        )}
      </div>

      <button onClick={signOut} className="btn btn-ghost" style={{ width: '100%', marginTop: 24 }}>
        Sign out
      </button>
    </div>
  )
}

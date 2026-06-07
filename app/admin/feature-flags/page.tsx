'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

// ───── tokens ─────
const BG = '#0A0A0A'
const BG2 = '#111111'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT3 = '#555250'
const GOLD = '#5BA3D9'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'

type FeatureFlag = {
  key: string
  description: string | null
  enabled: boolean
  rollout_percent: number
  target_roles: string[] | null
  allowed_user_ids: string[] | null
  updated_at: string
}

export default function FeatureFlagsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState('')
  const [accessDenied, setAccessDenied] = useState(false)
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const response = await fetch('/api/admin/feature-flags')
    if (response.status === 401) { router.replace('/auth/login'); return }
    if (response.status === 403) { setAccessDenied(true); setLoading(false); return }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as { error?: string }))
      setError(payload.error || 'Failed to load feature flags.')
      setLoading(false)
      return
    }
    setFlags((await response.json()) as FeatureFlag[])
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  const hasFlags = useMemo(() => flags.length > 0, [flags])

  async function patchFlag(key: string, patch: Partial<FeatureFlag>) {
    setSavingKey(key)
    const response = await fetch('/api/admin/feature-flags', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, ...patch }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({} as { error?: string }))
      setError(payload.error || 'Failed to update feature flag.')
      setSavingKey('')
      return
    }
    const updated = (await response.json()) as FeatureFlag
    setFlags((prev) => prev.map((item) => (item.key === updated.key ? updated : item)))
    setSavingKey('')
  }

  if (accessDenied) {
    return (
      <div style={{ padding: 60, color: TEXT2, textAlign: 'center' }}>
        <p>Admin access required.</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 28px 100px', color: TEXT, fontFamily: 'var(--font-body)' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Tools</div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36, letterSpacing: '0.02em', textTransform: 'uppercase', margin: 0, lineHeight: 1.05 }}>Feature Flags</h1>
        <p style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
          Control in-house capabilities, rollout percentages, and role targeting.
        </p>
      </div>

      {error && (
        <div style={{
          marginBottom: 16, border: `1px solid rgba(220,38,38,0.4)`,
          background: 'rgba(220,38,38,0.08)', color: '#FCA5A5',
          padding: '10px 14px', fontSize: 13,
        }}>{error}</div>
      )}

      {loading ? (
        <div>
          <style>{`@keyframes ffShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          <div style={{ display: 'grid', gap: 10 }}>
            {[0, 1, 2, 3, 4].map(i => <FlagRowSkeleton key={i} />)}
          </div>
        </div>
      ) : !hasFlags ? (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '60px 40px', textAlign: 'center', color: TEXT3 }}>
          No flags found. Run supabase/002_observability.sql to seed defaults.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {flags.map((flag) => {
            const isSaving = savingKey === flag.key
            const rolesText = (flag.target_roles || []).join(', ')
            return (
              <div key={flag.key} style={{ background: BG2, border: `1px solid ${LINE}`, padding: '14px 18px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 140px 1.2fr auto', gap: 14, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, fontFamily: 'var(--font-mono)' }}>{flag.key}</div>
                    <div style={{ color: TEXT2, fontSize: 12, marginTop: 2 }}>{flag.description || 'No description'}</div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: TEXT, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={flag.enabled}
                      disabled={isSaving}
                      onChange={(event) => void patchFlag(flag.key, { enabled: event.target.checked })}
                      style={{ accentColor: GOLD, cursor: 'pointer' }}
                    />
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>
                      Enabled
                    </span>
                  </label>

                  <div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: TEXT3, marginBottom: 4, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Rollout %</div>
                    <input
                      type="number" min={0} max={100}
                      value={flag.rollout_percent}
                      disabled={isSaving}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setFlags((prev) => prev.map((item) => item.key === flag.key ? { ...item, rollout_percent: Number.isFinite(value) ? value : item.rollout_percent } : item))
                      }}
                      onBlur={(event) => void patchFlag(flag.key, { rollout_percent: Number(event.target.value) })}
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: TEXT3, marginBottom: 4, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Target roles (CSV)</div>
                    <input
                      type="text"
                      value={rolesText}
                      disabled={isSaving}
                      onChange={(event) => {
                        const nextRoles = event.target.value
                        setFlags((prev) => prev.map((item) => item.key === flag.key ? { ...item, target_roles: nextRoles.split(',').map((role) => role.trim()).filter(Boolean) } : item))
                      }}
                      onBlur={(event) => void patchFlag(flag.key, { target_roles: event.target.value.split(',').map((role) => role.trim()).filter(Boolean) })}
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ color: TEXT3, fontSize: 11, textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {isSaving ? 'Saving...' : new Date(flag.updated_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FlagRowSkeleton() {
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
    backgroundSize: '200% 100%',
    animation: 'ffShimmer 1.4s ease-in-out infinite',
  }
  const block = (w: number | string, h: number, mb = 0): React.CSSProperties => ({ ...shimmer, width: w, height: h, marginBottom: mb })
  return (
    <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '14px 18px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 140px 1.2fr auto', gap: 14, alignItems: 'center' }}>
        <div>
          <div style={block(180, 14, 4)} />
          <div style={block('80%', 12)} />
        </div>
        <div style={block(80, 16)} />
        <div>
          <div style={block(60, 10, 6)} />
          <div style={{ ...block('100%', 30), border: `1px solid ${LINE2}` }} />
        </div>
        <div>
          <div style={block(90, 10, 6)} />
          <div style={{ ...block('100%', 30), border: `1px solid ${LINE2}` }} />
        </div>
        <div style={block(120, 11)} />
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: BG,
  border: `1px solid ${LINE}`,
  padding: '8px 10px',
  color: TEXT,
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

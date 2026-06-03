'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ───── tokens ─────
const BG = '#0A0A0A'
const BG2 = '#111111'
const BG3 = '#1A1A1A'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT3 = '#555250'
const TEXT4 = '#3A3835'
const WHITE = '#FFFFFF'
const GOLD = '#C9A84C'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'

interface Team {
  id: string
  name: string
  slug: string
  description: string | null
  programs: string[] | null
  color: string | null
  icon: string | null
  active: boolean
  lead: { id: string; display_name: string; email: string } | null
  team_members: [{ count: number }] | null
}

export default function TeamsPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/teams')
    if (res.status === 401) { router.replace('/auth/login'); return }
    if (res.ok) setTeams(await res.json())
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  const filtered = search.trim()
    ? teams.filter(t => {
        const q = search.toLowerCase()
        return t.name.toLowerCase().includes(q)
          || (t.description || '').toLowerCase().includes(q)
          || (t.programs || []).some(p => p.toLowerCase().includes(q))
          || (t.lead?.display_name || '').toLowerCase().includes(q)
      })
    : teams

  const totalMembers = teams.reduce((s, t) => s + (t.team_members?.[0]?.count || 0), 0)

  async function createTeam(payload: { name: string; description: string; color: string; programs: string[] }) {
    const res = await fetch('/api/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error || 'Create failed', 'err'); return false }
    showToast(`Team "${payload.name}" created`)
    void load()
    return true
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 28px 100px', color: TEXT, fontFamily: 'var(--font-body)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Admin</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36, letterSpacing: '0.02em', textTransform: 'uppercase', margin: 0, lineHeight: 1.05 }}>Teams</h1>
          <p style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
            {teams.length} {teams.length === 1 ? 'team' : 'teams'} · {totalMembers} {totalMembers === 1 ? 'member' : 'members'} total.
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)} style={btnPrimary}>+ New Team</button>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, program, lead..."
          style={{
            background: BG2, border: `1px solid ${LINE}`, padding: '10px 14px',
            color: TEXT, fontFamily: 'var(--font-body)', fontSize: 13,
            width: '100%', maxWidth: 380, outline: 'none', boxSizing: 'border-box',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = LINE2)}
          onBlur={e => (e.currentTarget.style.borderColor = LINE)}
        />
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
          <style>{`@keyframes teamShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          {[0, 1, 2, 3, 4, 5].map(i => <TeamCardSkeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '60px 40px', textAlign: 'center', color: TEXT3 }}>
          {search ? `No teams match "${search}"` : 'No teams yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 14 }}>
          {filtered.map(team => (
            <TeamCard key={team.id} team={team} onClick={() => router.push(`/admin/teams/${team.slug}`)} />
          ))}
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 96, zIndex: 50,
          background: toast.type === 'ok' ? 'rgba(5,150,105,0.12)' : 'rgba(220,38,38,0.12)',
          border: `1px solid ${toast.type === 'ok' ? 'rgba(76,201,168,0.4)' : 'rgba(220,38,38,0.4)'}`,
          color: toast.type === 'ok' ? '#4CC9A8' : '#FCA5A5',
          padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-mono)',
        }}>{toast.msg}</div>
      )}

      {createOpen && (
        <CreateTeamModal
          onClose={() => setCreateOpen(false)}
          onSubmit={async (payload) => {
            const ok = await createTeam(payload)
            if (ok) setCreateOpen(false)
          }}
        />
      )}
    </div>
  )
}

function TeamCard({ team, onClick }: { team: Team; onClick: () => void }) {
  const memberCount = team.team_members?.[0]?.count || 0
  const accent = team.color || TEXT3
  return (
    <div
      onClick={onClick}
      style={{
        background: BG2, border: `1px solid ${LINE}`,
        padding: '20px 22px', cursor: 'pointer',
        transition: 'border-color 120ms, background 120ms',
        position: 'relative',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = BG3
        e.currentTarget.style.borderColor = LINE2
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = BG2
        e.currentTarget.style.borderColor = LINE
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />

      <h2 style={{
        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18,
        textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px',
        color: TEXT,
      }}>{team.name}</h2>

      {team.description && (
        <p style={{ fontSize: 12, color: TEXT2, margin: '0 0 14px', lineHeight: 1.5 }}>
          {team.description}
        </p>
      )}

      {(team.programs && team.programs.length > 0) && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          {team.programs.map(p => (
            <span key={p} style={{
              fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 600,
              color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>{p}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontSize: 11, color: TEXT2 }}>
          {team.lead?.display_name ? (
            <>Lead <span style={{ color: TEXT, fontWeight: 600 }}>{team.lead.display_name}</span></>
          ) : (
            <span style={{ color: TEXT4, fontStyle: 'italic' }}>No lead assigned</span>
          )}
        </div>
        <span style={{
          fontFamily: 'var(--font-heading)', fontSize: 10, fontWeight: 700,
          color: TEXT, textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>
    </div>
  )
}

function TeamCardSkeleton() {
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
    backgroundSize: '200% 100%',
    animation: 'teamShimmer 1.4s ease-in-out infinite',
  }
  const block = (w: number | string, h: number, mb = 0): React.CSSProperties => ({ ...shimmer, width: w, height: h, marginBottom: mb })
  return (
    <div style={{
      background: BG2, border: `1px solid ${LINE}`,
      padding: '20px 22px', position: 'relative',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: BG3 }} />
      <div style={block(140, 18, 10)} />
      <div style={block('90%', 12, 4)} />
      <div style={block('70%', 12, 14)} />
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <div style={block(60, 10)} />
        <div style={block(70, 10)} />
        <div style={block(50, 10)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
        <div style={block(110, 11)} />
        <div style={block(70, 11)} />
      </div>
    </div>
  )
}

// ───── CREATE TEAM MODAL ─────
function CreateTeamModal({ onClose, onSubmit }: {
  onClose: () => void
  onSubmit: (payload: { name: string; description: string; color: string; programs: string[] }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#C9A84C')
  const [programsText, setProgramsText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const COLORS = ['#C9A84C', '#5B7FA0', '#8A6B9F', '#A05B5B', '#5BA08A', '#A0875B']

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
    }}>
      <div style={{
        background: BG2, border: `1px solid ${LINE}`, padding: '26px 28px 24px',
        maxWidth: 460, width: '100%',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22,
          textTransform: 'uppercase', letterSpacing: '0.04em', color: TEXT, margin: '0 0 4px',
        }}>New team</h2>
        <p style={{ fontSize: 13, color: TEXT2, margin: '0 0 22px' }}>
          Teams group people by department or function. You can assign squads inside them later.
        </p>

        <Field label="Name">
          <Input value={name} onChange={setName} placeholder="e.g. Operations" />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={setDescription} placeholder="What does this team do?" />
        </Field>
        <Field label="Programs (comma-separated, optional)">
          <Input value={programsText} onChange={setProgramsText} placeholder="CPT, IHC, CNC" />
        </Field>
        <Field label="Color">
          <div style={{ display: 'flex', gap: 8 }}>
            {COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)} style={{
                width: 32, height: 32, background: c, border: `2px solid ${color === c ? TEXT : 'transparent'}`,
                cursor: 'pointer',
              }} />
            ))}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button
            onClick={async () => {
              if (!name.trim() || busy) return
              setBusy(true)
              await onSubmit({
                name: name.trim(),
                description: description.trim(),
                color,
                programs: programsText.split(',').map(p => p.trim()).filter(Boolean),
              })
              setBusy(false)
            }}
            disabled={!name.trim() || busy}
            style={{ ...btnGold, opacity: !name.trim() || busy ? 0.5 : 1 }}
          >{busy ? 'Creating...' : 'Create team'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: 'block', fontFamily: 'var(--font-heading)', fontSize: 10,
        color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6,
      }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{
        width: '100%', background: BG, border: `1px solid ${LINE}`, padding: '10px 12px',
        color: TEXT, fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = LINE2)}
      onBlur={e => (e.currentTarget.style.borderColor = LINE)}
    />
  )
}

const btnPrimary: React.CSSProperties = {
  background: WHITE, color: BG, border: 'none', padding: '10px 18px',
  fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
  textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
}
const btnGhost: React.CSSProperties = {
  background: 'transparent', color: TEXT, border: `1px solid ${LINE2}`,
  padding: '10px 18px',
  fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
  textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
}
const btnGold: React.CSSProperties = {
  background: 'rgba(201,168,76,0.15)', color: GOLD, border: `1px solid ${GOLD}`,
  padding: '10px 18px',
  fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
  textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
}

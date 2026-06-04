'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ───── tokens ─────
const BG = '#0A0A0A'
const BG2 = '#111111'
const BG3 = '#1A1A1A'
const BG4 = '#222226'
const TEXT = '#F0EDE6'
const TEXT2 = '#8A8680'
const TEXT3 = '#555250'
const TEXT4 = '#3A3835'
const WHITE = '#FFFFFF'
const GOLD = '#C9A84C'
const CRITICAL = '#DC2626'
const LINE = '#2A2A2A'
const LINE2 = '#3A3A3A'

interface UserSquad {
  squad_id: string
  role: string
  squads: { id: string; name: string; color: string; area: string | null }
}
interface UserTeam { id: string; slug: string; name: string; role: string }
interface User {
  id: string
  email: string
  display_name: string | null
  title: string | null
  is_admin: boolean
  created_at: string
  last_sign_in: string | null
  banned_until: string | null
  squads: UserSquad[]
  teams: UserTeam[]
}
interface Squad { id: string; name: string; color: string; area: string | null }
interface Team { id: string; name: string; slug: string }
type FilterTab = 'all' | 'pending' | 'admins' | 'deactivated'

// ───── helpers ─────
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month} month${month === 1 ? '' : 's'} ago`
  return `${Math.floor(month / 12)} year${Math.floor(month / 12) === 1 ? '' : 's'} ago`
}
function shortAgo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}
function initials(u: User): string {
  const name = u.display_name || u.email
  return name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
}
function isPending(u: User): boolean { return !u.last_sign_in }
function isDeactivated(u: User): boolean {
  if (!u.banned_until) return false
  return new Date(u.banned_until).getTime() > Date.now()
}

// ───── PAGE ─────
export default function PeoplePage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [squads, setSquads] = useState<Squad[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterTab>('all')
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deactivateUser, setDeactivateUser] = useState<User | null>(null)
  const [reactivateUser, setReactivateUser] = useState<User | null>(null)
  const [cancelInviteUser, setCancelInviteUser] = useState<User | null>(null)

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    const [usersRes, squadsRes, teamsRes] = await Promise.all([
      fetch('/api/admin/users'),
      fetch('/api/admin/squads'),
      fetch('/api/teams'),
    ])
    if (usersRes.status === 401 || squadsRes.status === 401 || teamsRes.status === 401) {
      router.replace('/auth/login')
      return
    }
    if (usersRes.status === 403) {
      setAccessDenied(true); setLoading(false); return
    }
    if (usersRes.ok) setUsers(await usersRes.json())
    if (squadsRes.ok) setSquads(await squadsRes.json())
    if (teamsRes.ok) setTeams(await teamsRes.json())
    setLoading(false)
  }, [router])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!openMenuFor) return
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('[data-row-menu]')) setOpenMenuFor(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenuFor(null) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuFor])

  const filtered = users.filter(u => {
    if (filter === 'pending' && !isPending(u)) return false
    if (filter === 'admins' && !u.is_admin) return false
    if (filter === 'deactivated' && !isDeactivated(u)) return false
    if (filter === 'all' && isDeactivated(u)) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matches =
        (u.display_name || '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.teams.some(t => t.name.toLowerCase().includes(q)) ||
        u.squads.some(s => s.squads?.name?.toLowerCase?.().includes(q))
      if (!matches) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    const aPending = isPending(a) ? 1 : 0
    const bPending = isPending(b) ? 1 : 0
    if (aPending !== bPending) return bPending - aPending
    const aTime = a.last_sign_in ? new Date(a.last_sign_in).getTime() : new Date(a.created_at).getTime()
    const bTime = b.last_sign_in ? new Date(b.last_sign_in).getTime() : new Date(b.created_at).getTime()
    return bTime - aTime
  })

  const counts = {
    all: users.filter(u => !isDeactivated(u)).length,
    pending: users.filter(u => isPending(u) && !isDeactivated(u)).length,
    admins: users.filter(u => u.is_admin && !isDeactivated(u)).length,
    deactivated: users.filter(u => isDeactivated(u)).length,
  }
  const teamCount = new Set(users.flatMap(u => u.teams.map(t => t.slug))).size

  // ───── actions ─────
  async function sendInvite(email: string, teamId: string | null, squadId: string | null) {
    const body: Record<string, unknown> = { email }
    if (squadId) {
      body.squad_id = squadId
      body.squad_name = squads.find(s => s.id === squadId)?.name
    }
    const res = await fetch('/api/admin/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error || 'Invite failed', 'err'); return false }
    if (teamId && data.user_id) {
      await fetch('/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: data.user_id, team_id: teamId, team_action: 'upsert', role: 'member' }),
      })
    }
    showToast(`Invite sent to ${email}`)
    void load()
    return true
  }

  async function resendInvite(u: User) {
    setOpenMenuFor(null)
    const res = await fetch('/api/admin/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) showToast(data.error || 'Resend failed', 'err')
    else { showToast(`Invite resent to ${u.email}`); void load() }
  }

  async function toggleAdmin(u: User) {
    setOpenMenuFor(null)
    const res = await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.id, is_admin: !u.is_admin }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      showToast(data.error || 'Failed', 'err')
    } else {
      showToast(u.is_admin ? `Removed admin from ${u.display_name || u.email}` : `${u.display_name || u.email} is now admin`)
      void load()
    }
  }

  async function saveEdit(user_id: string, display_name: string, title: string, is_admin: boolean) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, display_name, title, is_admin }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error || 'Save failed', 'err'); return false }
    showToast('Profile saved')
    void load()
    return true
  }

  async function deactivate(u: User) {
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error || 'Deactivate failed', 'err'); return false }
    showToast(`${u.display_name || u.email} deactivated`)
    void load()
    return true
  }

  async function reactivate(u: User) {
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error || 'Reactivate failed', 'err'); return false }
    showToast(`${u.display_name || u.email} reactivated`)
    void load()
    return true
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28, gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, marginBottom: 8 }}>Admin</div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 36, letterSpacing: '0.02em', textTransform: 'uppercase', margin: 0, lineHeight: 1.05 }}>People</h1>
          <p style={{ fontSize: 13, color: TEXT2, marginTop: 6 }}>
            {counts.all} {counts.all === 1 ? 'person' : 'people'} across {teamCount} {teamCount === 1 ? 'team' : 'teams'}.
          </p>
        </div>
        <button onClick={() => setInviteOpen(true)} style={btnPrimary}>+ Invite Someone</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, team, squad..."
          style={{
            background: BG2, border: `1px solid ${LINE}`, padding: '10px 14px',
            color: TEXT, fontFamily: 'var(--font-body)', fontSize: 13,
            flex: 1, maxWidth: 380, outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = LINE2)}
          onBlur={e => (e.currentTarget.style.borderColor = LINE)}
        />
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {(['all', 'pending', 'admins', 'deactivated'] as FilterTab[]).map(tab => (
            <button key={tab} onClick={() => setFilter(tab)} style={{
              background: filter === tab ? BG2 : 'transparent',
              color: filter === tab ? TEXT : TEXT2,
              border: `1px solid ${filter === tab ? LINE2 : 'transparent'}`,
              padding: '7px 12px', fontFamily: 'var(--font-body)', fontSize: 12,
              cursor: 'pointer', textTransform: 'capitalize',
            }}>
              {tab} <span style={{ color: filter === tab ? TEXT2 : TEXT3, marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{counts[tab]}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ background: BG2, border: `1px solid ${LINE}` }}>
          <style>{`@keyframes peopleShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          {[0, 1, 2, 3, 4, 5].map(i => <PeopleRowSkeleton key={i} />)}
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ background: BG2, border: `1px solid ${LINE}`, padding: '60px 40px', textAlign: 'center', color: TEXT3 }}>
          {search ? `No people match "${search}"`
            : filter === 'pending' ? 'No pending invites'
            : filter === 'admins' ? 'No admins'
            : filter === 'deactivated' ? 'No deactivated users'
            : 'No people yet'}
        </div>
      ) : (
        <div style={{ background: BG2, border: `1px solid ${LINE}` }}>
          {sorted.map(u => (
            <PeopleRow
              key={u.id} user={u}
              menuOpen={openMenuFor === u.id}
              onKebabClick={() => setOpenMenuFor(openMenuFor === u.id ? null : u.id)}
              onEdit={() => { setEditUser(u); setOpenMenuFor(null) }}
              onResend={() => resendInvite(u)}
              onToggleAdmin={() => toggleAdmin(u)}
              onDeactivate={() => { setDeactivateUser(u); setOpenMenuFor(null) }}
              onReactivate={() => { setReactivateUser(u); setOpenMenuFor(null) }}
              onCancelInvite={() => { setCancelInviteUser(u); setOpenMenuFor(null) }}
            />
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

      {inviteOpen && (
        <InviteModal
          squads={squads} teams={teams}
          onClose={() => setInviteOpen(false)}
          onSubmit={async (email, teamId, squadId) => {
            const ok = await sendInvite(email, teamId, squadId)
            if (ok) setInviteOpen(false)
          }}
        />
      )}

      {editUser && (
        <EditModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSubmit={async (display_name, title, is_admin) => {
            const ok = await saveEdit(editUser.id, display_name, title, is_admin)
            if (ok) setEditUser(null)
          }}
        />
      )}

      {deactivateUser && (
        <ConfirmDialog
          title={`Deactivate ${deactivateUser.display_name || deactivateUser.email}?`}
          body="This ends active sessions and prevents future sign-ins. Squad and team memberships are kept so reactivation restores everything in one step."
          extra={(deactivateUser.teams.some(t => t.role === 'lead') || deactivateUser.squads.some(s => s.role === 'lead'))
            ? 'This person is a Lead on at least one team or squad. Deactivating leaves it without a designated lead.' : null}
          confirmLabel="Deactivate" danger
          onCancel={() => setDeactivateUser(null)}
          onConfirm={async () => {
            const ok = await deactivate(deactivateUser)
            if (ok) setDeactivateUser(null)
          }}
        />
      )}

      {reactivateUser && (
        <ConfirmDialog
          title={`Reactivate ${reactivateUser.display_name || reactivateUser.email}?`}
          body="This restores sign-in access. Existing squad and team memberships return as they were."
          confirmLabel="Reactivate"
          onCancel={() => setReactivateUser(null)}
          onConfirm={async () => {
            const ok = await reactivate(reactivateUser)
            if (ok) setReactivateUser(null)
          }}
        />
      )}

      {cancelInviteUser && (
        <ConfirmDialog
          title={`Cancel invite to ${cancelInviteUser.email}?`}
          body="This prevents the magic link from being used. You can re-invite them later if needed."
          confirmLabel="Cancel invite" danger
          onCancel={() => setCancelInviteUser(null)}
          onConfirm={async () => {
            const ok = await deactivate(cancelInviteUser)
            if (ok) setCancelInviteUser(null)
          }}
        />
      )}
    </div>
  )
}

// ───── ROW ─────
function PeopleRow({
  user: u, menuOpen, onKebabClick,
  onEdit, onResend, onToggleAdmin, onDeactivate, onReactivate, onCancelInvite,
}: {
  user: User
  menuOpen: boolean
  onKebabClick: () => void
  onEdit: () => void
  onResend: () => void
  onToggleAdmin: () => void
  onDeactivate: () => void
  onReactivate: () => void
  onCancelInvite: () => void
}) {
  const pending = isPending(u)
  const deactivated = isDeactivated(u)
  return (
    <div data-row-menu style={{
      position: 'relative',
      display: 'grid', gridTemplateColumns: '3px 36px 1fr auto 32px',
      alignItems: 'center', gap: 14, padding: '14px 18px',
      borderBottom: `1px solid ${LINE}`,
      opacity: deactivated ? 0.42 : 1,
      transition: 'background 100ms',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = BG3 }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ width: 3, height: 28, background: pending && !deactivated ? GOLD : 'transparent' }} />

      <div style={{
        width: 36, height: 36, background: BG3, border: `1px solid ${LINE2}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13, color: TEXT, letterSpacing: '0.04em',
      }}>{initials(u)}</div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 14,
            fontWeight: pending ? 500 : 600,
            color: pending ? TEXT2 : TEXT,
          }}>{u.display_name || u.email}</span>
          {pending && !deactivated && (
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>Pending</span>
          )}
          {u.is_admin && !pending && !deactivated && (
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>Admin</span>
          )}
          {deactivated && (
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 10, color: TEXT3, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 600 }}>Deactivated</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: TEXT2, marginBottom: 6 }}>
          {pending && !deactivated ? (<>Invite sent {timeAgo(u.created_at)}</>)
            : deactivated ? u.email
            : u.title ? (<>{u.title}<span style={{ color: TEXT4, margin: '0 6px' }}>·</span>{u.email}</>)
            : u.email}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px' }}>
          {u.teams.map(t => (
            <span key={t.id} style={{
              fontFamily: 'var(--font-heading)', color: TEXT3, textTransform: 'uppercase',
              letterSpacing: '0.1em', fontWeight: 600, fontSize: 10,
            }}>
              {t.name}{t.role === 'lead' && (
                <span style={{ color: TEXT4, marginLeft: 5, textTransform: 'none', letterSpacing: '0.02em', fontWeight: 500 }}>lead</span>
              )}
            </span>
          ))}
          {u.squads.map(sm => (
            <span key={sm.squad_id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 9px', background: BG3, color: TEXT,
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 500,
            }}>
              <span style={{ width: 7, height: 7, background: (sm.squads?.color && sm.squads.color.toLowerCase() !== '#1aafa0') ? sm.squads.color : GOLD }} />
              {sm.squads?.name}
              {sm.role === 'lead' && <span style={{ color: TEXT3, marginLeft: 2, fontSize: 10 }}>lead</span>}
            </span>
          ))}
          {u.teams.length === 0 && u.squads.length === 0 && (
            <span style={{ color: TEXT4, fontStyle: 'italic', fontSize: 11 }}>no teams or squads</span>
          )}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: TEXT3, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {deactivated ? (u.last_sign_in ? `Last seen ${new Date(u.last_sign_in).toLocaleDateString()}` : 'Never signed in')
          : pending ? ''
          : u.last_sign_in ? `${shortAgo(u.last_sign_in)} ago` : 'never'}
      </div>

      <button onClick={onKebabClick} aria-label="Actions" style={{
        color: menuOpen ? TEXT : TEXT3, background: menuOpen ? BG4 : 'transparent',
        border: 'none', width: 32, height: 32, cursor: 'pointer',
        fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>⋯</button>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: 56, right: 12, zIndex: 20,
          background: BG3, border: `1px solid ${LINE2}`,
          minWidth: 220, padding: '4px 0',
          boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
        }}>
          {deactivated ? (
            <>
              <MenuItem label="Reactivate" onClick={onReactivate} />
              <MenuItem label="Edit profile" onClick={onEdit} />
            </>
          ) : pending ? (
            <>
              <MenuItem label="Resend invite" ago={`sent ${shortAgo(u.created_at)} ago`} onClick={onResend} />
              <MenuItem label="Edit profile" onClick={onEdit} />
              <Divider />
              <MenuItem label="Cancel invite" danger onClick={onCancelInvite} />
            </>
          ) : (
            <>
              <MenuItem label="Edit profile" onClick={onEdit} />
              <MenuItem label={u.is_admin ? 'Remove admin' : 'Make admin'} onClick={onToggleAdmin} />
              <Divider />
              <MenuItem label="Deactivate" danger onClick={onDeactivate} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PeopleRowSkeleton() {
  const shimmer: React.CSSProperties = {
    background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0.02) 100%)',
    backgroundSize: '200% 100%',
    animation: 'peopleShimmer 1.4s ease-in-out infinite',
  }
  const block = (w: number | string, h: number, mb = 0): React.CSSProperties => ({ ...shimmer, width: w, height: h, marginBottom: mb })
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '3px 36px 1fr auto 32px',
      alignItems: 'center', gap: 14, padding: '14px 18px',
      borderBottom: `1px solid ${LINE}`,
    }}>
      <div style={{ width: 3, height: 28 }} />
      <div style={{ ...block(36, 36), border: `1px solid ${LINE2}` }} />
      <div>
        <div style={block(160, 14, 6)} />
        <div style={block(240, 11, 8)} />
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={block(60, 10)} />
          <div style={block(70, 10)} />
        </div>
      </div>
      <div style={block(60, 11)} />
      <div />
    </div>
  )
}

function MenuItem({ label, ago, onClick, danger }: { label: string; ago?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      background: 'transparent', border: 'none', padding: '9px 14px',
      fontFamily: 'var(--font-body)', fontSize: 13,
      color: danger ? CRITICAL : TEXT, cursor: 'pointer',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? 'rgba(220,38,38,0.06)' : BG4)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
      {ago && <span style={{ color: TEXT3, marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-mono)' }}>{ago}</span>}
    </button>
  )
}

function Divider() { return <div style={{ height: 1, background: LINE, margin: '4px 0' }} /> }

// ───── INVITE MODAL ─────
function InviteModal({ squads, teams, onClose, onSubmit }: {
  squads: Squad[]; teams: Team[]; onClose: () => void
  onSubmit: (email: string, teamId: string | null, squadId: string | null) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [teamId, setTeamId] = useState('')
  const [squadId, setSquadId] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell onClose={onClose}>
      <ModalBody>
        <ModalHeader title="Invite someone" sub="They'll get an email with a magic link to sign in. No password required." />
        <ModalField label="Email"><ModalInput type="email" placeholder="colleague@cfacbentonco.com" value={email} onChange={setEmail} /></ModalField>
        <ModalField label="Team (optional)">
          <ModalSelect value={teamId} onChange={setTeamId}>
            <option value="">No team yet</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </ModalSelect>
        </ModalField>
        <ModalField label="Squad (optional)">
          <ModalSelect value={squadId} onChange={setSquadId}>
            <option value="">No squad yet</option>
            {squads.map(s => <option key={s.id} value={s.id}>{s.name}{s.area ? ` · ${s.area}` : ''}</option>)}
          </ModalSelect>
        </ModalField>
        <ModalActions>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button
            onClick={async () => {
              if (!email.trim() || busy) return
              setBusy(true); await onSubmit(email.trim(), teamId || null, squadId || null); setBusy(false)
            }}
            disabled={!email.trim() || busy}
            style={{ ...btnGold, opacity: !email.trim() || busy ? 0.5 : 1 }}
          >{busy ? 'Sending...' : 'Send invite'}</button>
        </ModalActions>
      </ModalBody>
    </ModalShell>
  )
}

// ───── EDIT MODAL ─────
function EditModal({ user, onClose, onSubmit }: {
  user: User; onClose: () => void
  onSubmit: (display_name: string, title: string, is_admin: boolean) => Promise<void>
}) {
  const [display_name, setName] = useState(user.display_name || '')
  const [title, setTitle] = useState(user.title || '')
  const [is_admin, setIsAdmin] = useState(user.is_admin)
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell onClose={onClose}>
      <ModalBody>
        <ModalHeader title="Edit profile" sub={user.display_name || user.email} />
        <ModalField label="Display name"><ModalInput value={display_name} onChange={setName} /></ModalField>
        <ModalField label="Title"><ModalInput value={title} onChange={setTitle} /></ModalField>
        <ModalField label="Email (read-only)"><ModalInput value={user.email} onChange={() => {}} disabled /></ModalField>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '13px 14px', background: BG, border: `1px solid ${LINE}`, marginTop: 4,
        }}>
          <div>
            <div style={{ fontSize: 13, color: TEXT }}>Admin access</div>
            <div style={{ fontSize: 11, color: TEXT3, marginTop: 2 }}>Grants all admin routes including this page</div>
          </div>
          <div style={{ display: 'flex', border: `1px solid ${LINE2}` }}>
            <button onClick={() => setIsAdmin(false)} style={{
              background: !is_admin ? GOLD : 'transparent',
              color: !is_admin ? BG : TEXT2,
              border: 'none', padding: '6px 14px',
              fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
            }}>Off</button>
            <button onClick={() => setIsAdmin(true)} style={{
              background: is_admin ? GOLD : 'transparent',
              color: is_admin ? BG : TEXT2,
              border: 'none', padding: '6px 14px',
              fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
            }}>On</button>
          </div>
        </div>
        <ModalActions>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button
            onClick={async () => {
              if (busy) return
              setBusy(true); await onSubmit(display_name.trim(), title.trim(), is_admin); setBusy(false)
            }}
            disabled={busy}
            style={{ ...btnGold, opacity: busy ? 0.5 : 1 }}
          >{busy ? 'Saving...' : 'Save'}</button>
        </ModalActions>
      </ModalBody>
    </ModalShell>
  )
}

// ───── CONFIRM ─────
function ConfirmDialog({
  title, body, extra, confirmLabel, danger, onCancel, onConfirm,
}: {
  title: string; body: string; extra?: string | null
  confirmLabel: string; danger?: boolean
  onCancel: () => void; onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell onClose={onCancel}>
      <div style={{
        background: BG2, border: `1px solid ${LINE}`,
        borderLeft: `2px solid ${danger ? CRITICAL : GOLD}`,
        padding: '22px 26px', maxWidth: 460, width: '100%',
      }}>
        <h3 style={{
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16,
          textTransform: 'uppercase', letterSpacing: '0.06em', color: TEXT, margin: '0 0 8px',
        }}>{title}</h3>
        <p style={{ fontSize: 13, color: TEXT2, lineHeight: 1.6, margin: '0 0 8px' }}>{body}</p>
        {extra && (
          <p style={{
            fontSize: 12, color: GOLD, lineHeight: 1.5, marginTop: 10,
            padding: '8px 12px', background: 'rgba(201,168,76,0.08)',
            borderLeft: `2px solid ${GOLD}`, marginBottom: 0,
          }}>{extra}</p>
        )}
        <ModalActions>
          <button onClick={onCancel} style={btnGhost}>Cancel</button>
          <button
            onClick={async () => {
              if (busy) return
              setBusy(true); await onConfirm(); setBusy(false)
            }}
            disabled={busy}
            style={{ ...(danger ? btnDanger : btnGold), opacity: busy ? 0.5 : 1 }}
          >{busy ? 'Working...' : confirmLabel}</button>
        </ModalActions>
      </div>
    </ModalShell>
  )
}

// ───── PRIMITIVES ─────
function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
    }}>{children}</div>
  )
}
function ModalBody({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: BG2, border: `1px solid ${LINE}`, padding: '26px 28px 24px',
      maxWidth: 460, width: '100%',
    }}>{children}</div>
  )
}
function ModalHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h2 style={{
        fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 22,
        textTransform: 'uppercase', letterSpacing: '0.04em', color: TEXT, margin: '0 0 4px',
      }}>{title}</h2>
      {sub && <p style={{ fontSize: 13, color: TEXT2, margin: '0 0 22px' }}>{sub}</p>}
    </>
  )
}
function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
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
function ModalInput({ value, onChange, placeholder, type = 'text', disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean
}) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type} disabled={disabled}
      style={{
        width: '100%', background: BG, border: `1px solid ${LINE}`, padding: '10px 12px',
        color: TEXT, fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none',
        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'text', boxSizing: 'border-box',
      }}
      onFocus={e => !disabled && (e.currentTarget.style.borderColor = LINE2)}
      onBlur={e => (e.currentTarget.style.borderColor = LINE)}
    />
  )
}
function ModalSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', background: BG, border: `1px solid ${LINE}`, padding: '10px 12px',
        color: TEXT, fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = LINE2)}
      onBlur={e => (e.currentTarget.style.borderColor = LINE)}
    >{children}</select>
  )
}
function ModalActions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>{children}</div>
  )
}

// ───── BUTTONS ─────
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
const btnDanger: React.CSSProperties = {
  background: 'rgba(220,38,38,0.08)', color: CRITICAL, border: `1px solid ${CRITICAL}`,
  padding: '10px 18px',
  fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 13,
  textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer',
}

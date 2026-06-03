'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Member {
  id: string; role: string; added_at: string
  user_profiles: { id: string; display_name: string; email: string; phone: string | null; title: string | null; active: boolean }
}

interface NotificationRule {
  id: string; event_type: string; channel: string; threshold: string | null; active: boolean
}

interface Team {
  id: string; name: string; slug: string; description: string | null
  programs: string[]; color: string; icon: string | null
  lead: { id: string; display_name: string; email: string } | null
  members: Member[]; notification_rules: NotificationRule[]
}

export default function TeamDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('member')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const router = useRouter()

  async function authFetch(url: string, opts: RequestInit = {}) {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const headers = new Headers(opts.headers)
    if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
    return fetch(url, { ...opts, headers })
  }

  async function load() {
    const res = await authFetch(`/api/teams/${slug}`)
    if (res.ok) setTeam(await res.json())
    setLoading(false)
  }

  useEffect(() => { load() }, [slug])

  async function addMember() {
    if (!addEmail.trim()) return
    setAdding(true); setError('')
    const res = await authFetch(`/api/teams/${slug}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addEmail.trim(), role: addRole }),
    })
    if (res.ok) {
      setAddEmail(''); await load()
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to add member')
    }
    setAdding(false)
  }

  async function removeMember(userId: string) {
    await authFetch(`/api/teams/${slug}/members/${userId}`, { method: 'DELETE' })
    await load()
  }

  async function inviteUser() {
    if (!inviteEmail.trim()) return
    setInviting(true); setInviteMsg('')
    const res = await authFetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), teamSlug: slug, role: 'member' }),
    })
    const data = await res.json()
    if (res.ok) {
      setInviteMsg(data.message || 'Invite sent')
      setInviteEmail(''); setInviteName('')
    } else {
      setInviteMsg(data.error || 'Failed to send invite')
    }
    setInviting(false)
  }

  if (loading) return <div style={{ padding: 40, color: '#8A8680', textAlign: 'center' }}>Loading...</div>
  if (!team) return <div style={{ padding: 40, color: '#EB5757', textAlign: 'center' }}>Team not found</div>

  // Group notification rules by event_type
  const rulesByEvent = new Map<string, NotificationRule[]>()
  for (const r of team.notification_rules) {
    if (!rulesByEvent.has(r.event_type)) rulesByEvent.set(r.event_type, [])
    rulesByEvent.get(r.event_type)!.push(r)
  }

  return (
    <div>
    <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <button onClick={() => router.push('/admin/teams')} style={{
        background: 'transparent', border: 'none', color: '#8A8680', cursor: 'pointer',
        fontSize: 12, padding: 0, marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>← ALL TEAMS</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        {team.icon && <span style={{ fontSize: 28 }}>{team.icon}</span>}
        <h1 style={{
          fontFamily: 'var(--font-heading)', fontSize: 32, textTransform: 'uppercase',
          letterSpacing: '0.06em', margin: 0,
        }}>{team.name}</h1>
      </div>
      {team.description && <p style={{ color: '#8A8680', fontSize: 14, marginBottom: 4 }}>{team.description}</p>}
      {team.lead && <p style={{ color: '#8A8680', fontSize: 12, marginBottom: 24 }}>Lead: <span style={{ color: '#fff' }}>{team.lead.display_name}</span> ({team.lead.email})</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 32 }}>
        {team.programs.map(p => (
          <span key={p} style={{
            fontSize: 10, padding: '3px 10px', border: `1px solid ${team.color || '#333'}`,
            color: team.color || '#8A8680', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
          }}>{p}</span>
        ))}
      </div>

      {/* Members */}
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, borderBottom: '1px solid #222', paddingBottom: 8 }}>
        MEMBERS ({team.members.length})
      </h2>

      <div style={{ display: 'grid', gap: 8, marginBottom: 20 }}>
        {team.members.map(m => (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: '#141416', border: '1px solid #222',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.user_profiles.display_name || m.user_profiles.email}</div>
              <div style={{ fontSize: 11, color: '#8A8680' }}>
                {m.user_profiles.email}
                {m.user_profiles.title && ` · ${m.user_profiles.title}`}
                {m.user_profiles.phone && ` · ${m.user_profiles.phone}`}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 9, padding: '2px 8px', fontWeight: 700,
                color: m.role === 'lead' ? '#C9A84C' : '#8A8680',
                border: `1px solid ${m.role === 'lead' ? '#C9A84C' : '#333'}`,
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>{m.role}</span>
              <button onClick={() => removeMember(m.user_profiles.id)} style={{
                background: 'transparent', border: '1px solid #333', color: '#EB5757',
                fontSize: 10, padding: '4px 10px', cursor: 'pointer', textTransform: 'uppercase',
              }}>REMOVE</button>
            </div>
          </div>
        ))}
      </div>

      {/* Add member */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
        <input
          value={addEmail} onChange={e => setAddEmail(e.target.value)}
          placeholder="Email address" onKeyDown={e => e.key === 'Enter' && addMember()}
          style={{
            flex: 1, background: '#0A0A0A', border: '1px solid #333', padding: '10px 14px',
            color: '#fff', fontSize: 13, outline: 'none',
          }}
        />
        <select value={addRole} onChange={e => setAddRole(e.target.value)} style={{
          background: '#0A0A0A', border: '1px solid #333', padding: '10px 12px',
          color: '#fff', fontSize: 12, outline: 'none',
        }}>
          <option value="member">Member</option>
          <option value="lead">Lead</option>
          <option value="viewer">Viewer</option>
        </select>
        <button onClick={addMember} disabled={adding} style={{
          background: '#fff', color: '#0A0A0A', border: 'none', padding: '10px 20px',
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12,
          textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
        }}>{adding ? 'ADDING...' : 'ADD'}</button>
      </div>
      {error && <p style={{ color: '#EB5757', fontSize: 12, marginTop: -24, marginBottom: 24 }}>{error}</p>}

      {/* Invite new user */}
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, borderBottom: '1px solid #222', paddingBottom: 8 }}>
        INVITE NEW USER
      </h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
        <input
          value={inviteName} onChange={e => setInviteName(e.target.value)}
          placeholder="Name" style={{
            background: '#0A0A0A', border: '1px solid #333', padding: '10px 14px',
            color: '#fff', fontSize: 13, outline: 'none', flex: '1 1 140px',
          }}
        />
        <input
          value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
          placeholder="Email" onKeyDown={e => e.key === 'Enter' && inviteUser()}
          style={{
            flex: 1, background: '#0A0A0A', border: '1px solid #333', padding: '10px 14px',
            color: '#fff', fontSize: 13, outline: 'none',
          }}
        />
        <button onClick={inviteUser} disabled={inviting} style={{
          background: '#C9A84C', color: '#0A0A0A', border: 'none', padding: '10px 20px',
          fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 12,
          textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
        }}>{inviting ? 'SENDING...' : 'INVITE'}</button>
      </div>
      {inviteMsg && <p style={{ color: '#C9A84C', fontSize: 12, marginTop: -24, marginBottom: 24 }}>{inviteMsg}</p>}

      {/* Notification Rules */}
      <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14, borderBottom: '1px solid #222', paddingBottom: 8 }}>
        NOTIFICATION RULES
      </h2>

      {rulesByEvent.size === 0 ? (
        <p style={{ color: '#555', fontSize: 13 }}>No notification rules configured for this team.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {Array.from(rulesByEvent.entries()).map(([event, rules]) => (
            <div key={event} style={{
              padding: '12px 16px', background: '#141416', border: '1px solid #222',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {event.replace(/_/g, ' ')}
                </div>
                <div style={{ fontSize: 11, color: '#8A8680', marginTop: 2 }}>
                  Threshold: {rules[0]?.threshold || 'ALL'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {rules.map(r => (
                  <span key={r.id} style={{
                    fontSize: 9, padding: '3px 8px', fontWeight: 700,
                    color: r.channel === 'sms' ? '#F2994A' : r.channel === 'email' ? '#C9A84C' : '#6C63FF',
                    border: `1px solid ${r.channel === 'sms' ? '#F2994A' : r.channel === 'email' ? '#C9A84C' : '#6C63FF'}55`,
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                    opacity: r.active ? 1 : 0.4,
                  }}>{r.channel}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  )
}

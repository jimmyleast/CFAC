// Pure invite-state logic for the delegated "invite to connect" flow.

export type InviteRow = { provider: string; expires_at: string; used_at: string | null } | null | undefined

export type InviteStatus = 'ok' | 'expired' | 'used' | 'not_found'

export function inviteStatus(invite: InviteRow, nowMs: number): InviteStatus {
  if (!invite) return 'not_found'
  if (invite.used_at) return 'used'
  const exp = new Date(invite.expires_at).getTime()
  if (!Number.isFinite(exp) || exp < nowMs) return 'expired'
  return 'ok'
}

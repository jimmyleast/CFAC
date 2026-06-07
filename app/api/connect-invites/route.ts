import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { getProvider } from '@/lib/connectors/providers'
import { generateState } from '@/lib/connectors/oauth'
import { resolveAppBaseUrl } from '@/lib/url'

export const dynamic = 'force-dynamic'

const INVITE_TTL_DAYS = 7

// GET = list active (unused, unexpired) invites (admin). POST = mint an invite
// for an API-key provider so its staff owner can connect it without admin access.
export async function GET(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const { data } = await getAdminClient()
    .from('connect_invites')
    .select('token, provider, label, expires_at, used_at, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  const base = resolveAppBaseUrl(req)
  const invites = (data || []).map((i) => ({
    provider: i.provider, label: i.label,
    expiresAt: i.expires_at, usedAt: i.used_at, createdAt: i.created_at,
    // Only expose the link for still-actionable invites.
    link: !i.used_at ? `${base}/connect/${i.token}` : null,
  }))
  return NextResponse.json({ invites })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const body = await req.json().catch(() => ({})) as { provider?: string; label?: string }
  const provider = getProvider(String(body.provider || ''))
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  // Invites are for API-key, non-PHI providers only (OAuth/PHI delegation later).
  if (provider.authKind !== 'apikey') return NextResponse.json({ error: 'invites are only for API-key systems right now' }, { status: 400 })
  if (provider.phiAllowed) return NextResponse.json({ error: 'PHI-bearing systems cannot be delegated via invite' }, { status: 400 })

  const token = generateState() + generateState() // ~64 bytes entropy
  const admin = getAdminClient()
  // One active invite per provider: clear prior unused ones.
  await admin.from('connect_invites').delete().eq('provider', provider.id).is('used_at', null)
  const { error } = await admin.from('connect_invites').insert({
    token, provider: provider.id, label: String(body.label || '').slice(0, 120) || null,
    created_by: gate.user.id, expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await emitAppEvent({ eventName: 'connect_invite.created', category: 'system', userId: gate.user.id, route: '/api/connect-invites', status: 'ok', metadata: { provider: provider.id } }).catch(() => {})
  const link = `${resolveAppBaseUrl(req)}/connect/${token}`
  return NextResponse.json({ ok: true, link })
}

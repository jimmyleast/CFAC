import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { getProvider } from '@/lib/connectors/providers'
import { inviteStatus } from '@/lib/connectors/invites'
import { encryptSecret, isEncryptionConfigured } from '@/lib/connectors/crypto'
import { rateLimit } from '@/lib/hope/ratelimit'
import { emitAppEvent } from '@/lib/telemetry/events'

export const dynamic = 'force-dynamic'

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

// PUBLIC (token-gated): the staff owner opens their invite link. GET validates +
// returns the system name; POST accepts THEIR API key (encrypted server-side; the
// admin never sees it). Rate-limited; single-use; non-PHI API-key providers only.
export async function GET(req: Request, { params }: { params: { token: string } }) {
  if (!rateLimit(clientIp(req), Date.now()).ok) return NextResponse.json({ status: 'rate_limited', error: 'Too many requests' }, { status: 429 })

  const admin = getAdminClient()
  const { data: invite } = await admin.from('connect_invites').select('provider, expires_at, used_at').eq('token', params.token).maybeSingle()
  const status = inviteStatus(invite, Date.now())
  if (status !== 'ok') return NextResponse.json({ status }, { status: status === 'not_found' ? 404 : 410 })

  const provider = getProvider(invite!.provider)
  if (!provider || provider.authKind !== 'apikey') return NextResponse.json({ status: 'not_found' }, { status: 404 })
  return NextResponse.json({ status: 'ok', provider: { id: provider.id, name: provider.name, description: provider.description } })
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!rateLimit(clientIp(req), Date.now()).ok) return NextResponse.json({ status: 'rate_limited', error: 'Too many requests' }, { status: 429 })
  if (!isEncryptionConfigured()) return NextResponse.json({ error: 'Connection storage is not configured. Contact your administrator.' }, { status: 503 })

  const admin = getAdminClient()
  const { data: invite } = await admin.from('connect_invites').select('provider, expires_at, used_at, label').eq('token', params.token).maybeSingle()
  const status = inviteStatus(invite, Date.now())
  if (status !== 'ok') return NextResponse.json({ status }, { status: status === 'not_found' ? 404 : 410 })

  const provider = getProvider(invite!.provider)
  if (!provider || provider.authKind !== 'apikey' || provider.phiAllowed) return NextResponse.json({ error: 'invalid invite' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { apiKey?: string; name?: string }
  const apiKey = String(body.apiKey || '').trim()
  if (!apiKey) return NextResponse.json({ error: 'Please paste your API key.' }, { status: 400 })
  const name = String(body.name || '').slice(0, 120) || invite!.label || null

  // Atomically CLAIM the invite first (single-use): the conditional update only
  // succeeds for the one caller who flips used_at from null. A concurrent/replayed
  // POST claims nothing → 410. This is the race-safe gate.
  const claim = await admin.from('connect_invites')
    .update({ used_at: new Date().toISOString(), used_by: name })
    .eq('token', params.token).is('used_at', null).select('token').maybeSingle()
  if (!claim.data) return NextResponse.json({ status: 'used' }, { status: 410 })

  // Store the encrypted credential. If this fails, RELEASE the claim so the owner
  // can retry with their link.
  const up = await admin.from('connections').upsert({
    provider: provider.id, status: 'connected', auth_kind: 'apikey',
    external_label: name, api_key_enc: encryptSecret(apiKey), last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider' })
  if (up.error) {
    await admin.from('connect_invites').update({ used_at: null, used_by: null }).eq('token', params.token).then(() => {}, () => {})
    await emitAppEvent({ eventName: 'connection.changed', category: 'error', route: '/api/connect-invites', status: 'error', metadata: { provider: provider.id, via: 'invite', reason: 'store_failed' } }).catch(() => {})
    return NextResponse.json({ error: 'Could not save the connection.' }, { status: 500 })
  }

  await emitAppEvent({ eventName: 'connection.changed', category: 'system', route: '/api/connect-invites', status: 'connected', metadata: { provider: provider.id, via: 'invite' } }).catch(() => {})
  return NextResponse.json({ ok: true, provider: provider.name })
}

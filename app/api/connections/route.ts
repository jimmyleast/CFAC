import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa, requireAdmin } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { PROVIDERS, getProvider, isConfigured, blockedReason, isPhiGateReady } from '@/lib/connectors/providers'
import { encryptSecret, ensureEncryptionKey } from "@/lib/connectors/crypto"

export const dynamic = 'force-dynamic'

// Connector status + management. GET = per-provider status (staff, MFA).
// POST = connect an API-key provider (admin). DELETE = disconnect (admin).
// Secrets are NEVER returned to the client — only status metadata.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const { data } = await getAdminClient()
    .from('connections')
    .select('provider, status, auth_kind, external_label, last_sync_at, last_error, updated_at')
  const byProvider = new Map((data || []).map((c) => [c.provider, c]))

  const providers = Object.values(PROVIDERS).map((p) => {
    const c = byProvider.get(p.id)
    return {
      id: p.id, name: p.name, authKind: p.authKind, description: p.description,
      phiAllowed: p.phiAllowed, baa: p.baa,
      configured: isConfigured(p.id),
      blockedReason: blockedReason(p.id),
      status: c?.status || 'disconnected',
      externalLabel: c?.external_label ?? null,
      lastSyncAt: c?.last_sync_at ?? null,
      lastError: c?.last_error ?? null,
    }
  })
  return NextResponse.json({ providers, encryptionReady: await ensureEncryptionKey() })
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response
  if (!(await ensureEncryptionKey())) return NextResponse.json({ error: 'Connection storage temporarily unavailable. Try again.' }, { status: 503 })

  const body = await req.json().catch(() => ({})) as { provider?: string; apiKey?: string; label?: string }
  const provider = getProvider(String(body.provider || ''))
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  if (provider.authKind !== 'apikey') return NextResponse.json({ error: 'this provider connects via OAuth, not an API key' }, { status: 400 })
  // PHI-gated providers (e.g. Qualtrics) must NOT be connectable until the HIPAA
  // infra is in place — enforce here, not just in the UI.
  if (provider.phiGated && !isPhiGateReady()) return NextResponse.json({ error: 'This system handles PHI and is blocked until the HIPAA infrastructure is in place.' }, { status: 403 })
  const apiKey = String(body.apiKey || '').trim()
  if (!apiKey) return NextResponse.json({ error: 'apiKey required' }, { status: 400 })

  const { error } = await getAdminClient().from('connections').upsert({
    provider: provider.id,
    status: 'connected',
    auth_kind: 'apikey',
    external_label: String(body.label || '').slice(0, 120) || null,
    api_key_enc: encryptSecret(apiKey),
    last_error: null,
    connected_by: gate.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await emitAppEvent({ eventName: 'connection.changed', category: 'system', userId: gate.user.id, route: '/api/connections', status: 'connected', metadata: { provider: provider.id, authKind: 'apikey' } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const provider = getProvider(String(new URL(req.url).searchParams.get('provider') || ''))
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })

  // Clear secrets + mark disconnected (keep the row for history).
  const { error } = await getAdminClient().from('connections').upsert({
    provider: provider.id, status: 'disconnected',
    access_token_enc: null, refresh_token_enc: null, api_key_enc: null, token_expires_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await emitAppEvent({ eventName: 'connection.changed', category: 'system', userId: gate.user.id, route: '/api/connections', status: 'disconnected', metadata: { provider: provider.id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

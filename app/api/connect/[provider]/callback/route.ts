import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { getProvider, providerEnv } from '@/lib/connectors/providers'
import { isStateExpired } from '@/lib/connectors/oauth'
import { encryptSecret, isEncryptionConfigured } from '@/lib/connectors/crypto'
import { resolveAppBaseUrl } from '@/lib/url'
import { emitAppEvent } from '@/lib/telemetry/events'

export const dynamic = 'force-dynamic'

// OAuth2 callback: verify the state (CSRF), exchange the code for tokens
// server-side with the PKCE verifier + client secret, encrypt + store. The
// client secret and verifier never leave the server. Redirects back to the UI.
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const base = resolveAppBaseUrl(req)
  const back = (q: string) => NextResponse.redirect(`${base || ''}/admin/connections?${q}`)

  const provider = getProvider(params.provider)
  if (!provider || provider.authKind !== 'oauth2') return back('error=unknown_provider')
  if (!isEncryptionConfigured()) return back('error=encryption_not_configured')

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthErr = url.searchParams.get('error')
  if (oauthErr) return back(`error=${encodeURIComponent(oauthErr)}`)
  if (!code || !state) return back('error=missing_code')

  const admin = getAdminClient()
  // Consume the one-time state (CSRF + PKCE verifier).
  const { data: st } = await admin.from('oauth_states').select('provider, code_verifier, created_at, user_id').eq('state', state).maybeSingle()
  await admin.from('oauth_states').delete().eq('state', state)
  if (!st || st.provider !== provider.id) return back('error=bad_state')
  // Session binding: the admin completing the flow MUST be the one who started it
  // (defends against OAuth session-fixation / mix-up on an org-level credential).
  if (st.user_id && st.user_id !== gate.user.id) return back('error=state_user_mismatch')
  if (isStateExpired(st.created_at, Date.now())) return back('error=state_expired')

  const { clientId, clientSecret } = providerEnv(provider.id)
  if (!clientId || !clientSecret) return back('error=not_configured')
  const redirectUri = `${base}/api/connect/${provider.id}/callback`

  // Exchange code → tokens (server-side; secret + verifier never exposed).
  let tokens: { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
  try {
    const res = await fetch(provider.tokenUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: clientId, client_secret: clientSecret, code_verifier: st.code_verifier,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      await markError(admin, provider.id, `token exchange ${res.status}`, gate.user.id)
      return back('error=token_exchange_failed')
    }
    tokens = await res.json()
  } catch {
    await markError(admin, provider.id, 'token exchange network error', gate.user.id)
    return back('error=token_exchange_failed')
  }
  if (!tokens.access_token) return back('error=no_access_token')

  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null
  // Some providers return an account id on the callback (e.g. QuickBooks realmId) —
  // the connector needs it. Store it as the account label.
  const account = url.searchParams.get('realmId') || url.searchParams.get('account') || null
  const { error } = await admin.from('connections').upsert({
    provider: provider.id, status: 'connected', auth_kind: 'oauth2',
    external_label: account,
    scopes: tokens.scope || provider.scopes.join(' '),
    access_token_enc: encryptSecret(tokens.access_token),
    refresh_token_enc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    token_expires_at: expiresAt, last_error: null, connected_by: gate.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider' })
  if (error) return back('error=store_failed')

  void emitAppEvent({ eventName: 'connection.changed', category: 'system', userId: gate.user.id, route: `/api/connect/${provider.id}/callback`, status: 'connected', metadata: { provider: provider.id, authKind: 'oauth2' } }).catch(() => {})
  return back(`connected=${provider.id}`)
}

async function markError(admin: ReturnType<typeof getAdminClient>, provider: string, msg: string, userId: string) {
  await admin.from('connections').upsert({ provider, status: 'error', last_error: msg.slice(0, 300), updated_at: new Date().toISOString() }, { onConflict: 'provider' }).then(() => {}, () => {})
  // Failures belong in the append-only audit stream, not just the mutable row.
  void emitAppEvent({ eventName: 'connection.changed', category: 'error', userId, route: `/api/connect/${provider}/callback`, status: 'error', metadata: { provider, reason: msg.slice(0, 120) } }).catch(() => {})
}

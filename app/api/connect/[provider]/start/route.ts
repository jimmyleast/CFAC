import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireAdmin } from '@/lib/auth/aal'
import { getProvider, providerEnv, isConfigured, blockedReason } from '@/lib/connectors/providers'
import { generateState, generatePkce, buildAuthUrl } from '@/lib/connectors/oauth'
import { resolveAppBaseUrl } from '@/lib/url'

export const dynamic = 'force-dynamic'

// Begin an OAuth2 auth-code + PKCE connect. Admin-only. Stores the state +
// code_verifier server-side and redirects the admin to the provider's consent page.
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const gate = await requireAdmin(req)
  if ('response' in gate) return gate.response

  const provider = getProvider(params.provider)
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })
  if (provider.authKind !== 'oauth2') return NextResponse.json({ error: 'provider does not use OAuth' }, { status: 400 })
  if (!isConfigured(provider.id)) {
    const reason = blockedReason(provider.id)
    const msg = reason === 'phi_gate'
      ? `${provider.name} touches PHI and stays blocked until the compliance infra is in place (Supabase HIPAA add-on + BAAs — see INTEGRATION-ARCHITECTURE.md §5).`
      : `${provider.name} is not configured — register the app and set its client id/secret in Railway (see docs/SETUP-CONNECTORS.md).`
    return NextResponse.json({ error: msg }, { status: 503 })
  }

  const { clientId } = providerEnv(provider.id)
  const base = resolveAppBaseUrl(req)
  if (!base) return NextResponse.json({ error: 'SITE_URL not configured' }, { status: 500 })
  const redirectUri = `${base}/api/connect/${provider.id}/callback`
  const state = generateState()
  const { verifier, challenge } = generatePkce()

  const admin = getAdminClient()
  // Opportunistic GC: drop abandoned handshakes (each holds a PKCE verifier).
  await admin.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 15 * 60_000).toISOString()).then(() => {}, () => {})
  const { error } = await admin.from('oauth_states').insert({
    state, provider: provider.id, code_verifier: verifier, user_id: gate.user.id,
  })
  if (error) return NextResponse.json({ error: 'could not start connect' }, { status: 500 })

  const url = buildAuthUrl({
    authUrl: provider.authUrl!, clientId: clientId!, redirectUri,
    scopes: provider.scopes, state, challenge, extra: provider.extraAuthParams,
  })
  return NextResponse.redirect(url)
}

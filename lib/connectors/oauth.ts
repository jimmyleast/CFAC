import crypto from 'crypto'

// OAuth2 auth-code + PKCE helpers (RFC 9700). Pure + testable.

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateState(): string {
  return b64url(crypto.randomBytes(32))
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Build a provider authorize URL with the standard auth-code + PKCE params. */
export function buildAuthUrl(opts: {
  authUrl: string
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
  challenge: string
  extra?: Record<string, string>
}): string {
  const u = new URL(opts.authUrl)
  const p = u.searchParams
  p.set('client_id', opts.clientId)
  p.set('response_type', 'code')
  p.set('redirect_uri', opts.redirectUri)
  if (opts.scopes.length) p.set('scope', opts.scopes.join(' '))
  p.set('state', opts.state)
  p.set('code_challenge', opts.challenge)
  p.set('code_challenge_method', 'S256')
  for (const [k, v] of Object.entries(opts.extra || {})) p.set(k, v)
  return u.toString()
}

/** True if the OAuth state appears expired (older than ttl seconds). */
export function isStateExpired(createdAtIso: string, nowMs: number, ttlSeconds = 600): boolean {
  const t = new Date(createdAtIso).getTime()
  if (!Number.isFinite(t)) return true
  return nowMs - t > ttlSeconds * 1000
}

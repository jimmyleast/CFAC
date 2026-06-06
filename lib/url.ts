function normalizeBaseUrl(raw?: string | null) {
  const value = String(raw || '').trim()
  if (!value) return ''

  try {
    const url = new URL(value)
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function isLocalhostUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function getForwardedOrigin(request: Request) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || ''
  if (!host) return ''

  const protocolFromUrl = new URL(request.url).protocol.replace(':', '')
  const proto = forwardedProto || protocolFromUrl || 'https'
  return normalizeBaseUrl(`${proto}://${host}`)
}

/**
 * Resolve the external app base URL for auth redirects.
 * Prefers forwarded request origin in hosted environments to avoid localhost links.
 */
export function resolveAppBaseUrl(request: Request) {
  const configured = [
    normalizeBaseUrl(process.env.SITE_URL),
    normalizeBaseUrl(process.env.APP_URL),
    normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL),
  ].filter(Boolean)

  // Always prefer a configured, non-localhost URL.
  const preferredConfigured = configured.find((url) => !isLocalhostUrl(url))
  if (preferredConfigured) return preferredConfigured

  // SECURITY: in production, NEVER derive auth-link base URLs from request
  // headers (Host / X-Forwarded-Host are attacker-controllable → link
  // poisoning / token theft). Require a configured SITE_URL/APP_URL in prod.
  if (process.env.NODE_ENV === 'production') return configured[0] || ''

  // Dev convenience only: fall back to the request/forwarded origin.
  const forwardedOrigin = getForwardedOrigin(request)
  const requestOrigin = normalizeBaseUrl(new URL(request.url).origin)
  return forwardedOrigin || requestOrigin || configured[0] || ''
}

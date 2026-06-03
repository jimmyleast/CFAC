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
  const requestOrigin = normalizeBaseUrl(new URL(request.url).origin)
  const forwardedOrigin = getForwardedOrigin(request)

  const configured = [
    normalizeBaseUrl(process.env.SITE_URL),
    normalizeBaseUrl(process.env.APP_URL),
    normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL),
  ].filter(Boolean)

  const preferredConfigured = configured.find((url) => !isLocalhostUrl(url))
  const preferredForwarded = forwardedOrigin && !isLocalhostUrl(forwardedOrigin) ? forwardedOrigin : ''
  const preferredRequest = requestOrigin && !isLocalhostUrl(requestOrigin) ? requestOrigin : ''

  return (
    preferredConfigured ||
    preferredForwarded ||
    preferredRequest ||
    forwardedOrigin ||
    requestOrigin ||
    configured[0]
  )
}

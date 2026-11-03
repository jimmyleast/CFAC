// In-memory rate limiter for the unauthenticated auth-email endpoints
// (magic-link, reset-password). Same pattern as lib/hope/ratelimit.ts but with
// its OWN buckets — never share state with the public Hope endpoint.
// Per-IP limit AND a global ceiling per window; per server instance.

const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_IP = 5
const MAX_GLOBAL = 60
let perIp = new Map<string, number[]>()
let globalHits: number[] = []

export type RateResult = { ok: boolean; reason?: 'ip' | 'global' }

export function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for') || ''
  return fwd.split(',')[0]?.trim() || 'unknown'
}

export function authEmailRateLimit(ip: string, now: number = Date.now()): RateResult {
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS)
  if (globalHits.length >= MAX_GLOBAL) return { ok: false, reason: 'global' }

  const arr = (perIp.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  if (arr.length >= MAX_PER_IP) { perIp.set(ip, arr); return { ok: false, reason: 'ip' } }

  arr.push(now); perIp.set(ip, arr); globalHits.push(now)
  // Evict only expired keys (never wholesale clear, which would reset everyone).
  if (perIp.size > 5000) for (const [k, v] of perIp) if (!v.some((t) => now - t < WINDOW_MS)) perIp.delete(k)
  return { ok: true }
}

/** Test-only: clear limiter state between cases. */
export function resetAuthEmailRateLimit() {
  perIp = new Map()
  globalHits = []
}

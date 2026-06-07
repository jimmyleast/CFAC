// In-memory rate limiter for the unauthenticated public Hope endpoint.
// Per-IP limit AND a hard global ceiling per window (cost circuit-breaker).
// Per server instance; a shared store would be stronger across instances.

const WINDOW_MS = 5 * 60 * 1000
const MAX_PER_IP = 12
const MAX_GLOBAL = 150
const perIp = new Map<string, number[]>()
let globalHits: number[] = []

export type RateResult = { ok: boolean; reason?: 'ip' | 'global' }

export function rateLimit(ip: string, now: number = Date.now()): RateResult {
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS)
  if (globalHits.length >= MAX_GLOBAL) return { ok: false, reason: 'global' }

  const arr = (perIp.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  if (arr.length >= MAX_PER_IP) { perIp.set(ip, arr); return { ok: false, reason: 'ip' } }

  arr.push(now); perIp.set(ip, arr); globalHits.push(now)
  // Evict only expired keys (never wholesale clear, which would reset everyone).
  if (perIp.size > 5000) for (const [k, v] of perIp) if (!v.some((t) => now - t < WINDOW_MS)) perIp.delete(k)
  return { ok: true }
}

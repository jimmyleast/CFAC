import { describe, it, expect } from 'vitest'
import { rateLimit } from '@/lib/hope/ratelimit'

describe('public route rateLimit', () => {
  it('allows up to the per-IP cap, then blocks with reason "ip"', () => {
    const ip = 'ip-' + Math.random()
    const now = 1_000_000
    for (let i = 0; i < 12; i++) expect(rateLimit(ip, now).ok).toBe(true)
    expect(rateLimit(ip, now)).toEqual({ ok: false, reason: 'ip' })
  })

  it('isolates limits per IP (one IP hitting its cap does not block another)', () => {
    const now = 100_000_000
    const a = 'a-' + Math.random()
    const b = 'b-' + Math.random()
    for (let i = 0; i < 12; i++) rateLimit(a, now)
    expect(rateLimit(b, now).ok).toBe(true)
  })

  it('expires the window (blocked now, allowed after the window passes)', () => {
    const ip = 'exp-' + Math.random()
    const now = 200_000_000
    for (let i = 0; i < 12; i++) rateLimit(ip, now)
    expect(rateLimit(ip, now).ok).toBe(false)
    expect(rateLimit(ip, now + 6 * 60 * 1000).ok).toBe(true)
  })
})

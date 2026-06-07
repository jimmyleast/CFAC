import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// providers → crypto → admin/telemetry: mock the leaf side-effecting modules.
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/auth/aal', () => ({
  requireAdmin: vi.fn(async () => ({ user: { id: 'admin-1', email: 'a@cfac.org' } })),
  requireUserMfa: vi.fn(async () => ({ user: { id: 'admin-1', email: 'a@cfac.org' } })),
}))

import { phiKeyBlocked, assertPhiKeyInvariant, blockedReason } from '@/lib/connectors/providers'
import { __resetKeyCacheForTests } from '@/lib/connectors/crypto'
import { POST } from '@/app/api/connections/route'
import { getAdminClient } from '@/lib/admin'

const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

// Admin mock that supports BOTH the DB-key get-or-create (platform_secrets) and the
// connections upsert, counting how many times a credential is actually sealed/stored.
function adminMock() {
  const calls = { connUpsert: 0 }
  let secretRow: { value: string } | null = null
  mAdmin.mockReturnValue({
    from: (table: string) => {
      if (table === 'platform_secrets') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: secretRow }) }) }),
          insert: async (r: { value: string }) => { secretRow = { value: r.value }; return { error: null } },
        }
      }
      return { upsert: async () => { calls.connUpsert++; return { error: null } } } // connections
    },
  })
  return calls
}

function postReq(body: unknown) {
  return new Request('https://app/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

const envKey = () => crypto.randomBytes(32).toString('base64')

beforeEach(() => {
  vi.clearAllMocks()
  __resetKeyCacheForTests()
  delete process.env.CONNECTOR_ENC_KEY
  delete process.env.PHI_GATE_READY
})

describe('phiKeyBlocked', () => {
  it('blocks a phiGated provider when the gate is open but only the DB key exists', () => {
    process.env.PHI_GATE_READY = 'true' // no env key
    expect(phiKeyBlocked('microsoft')).toBe(true)
    expect(phiKeyBlocked('qualtrics')).toBe(true)
    expect(phiKeyBlocked('docusign')).toBe(true)
  })

  it('does NOT block once the strong env key is in force', () => {
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = envKey()
    expect(phiKeyBlocked('microsoft')).toBe(false)
  })

  it('does NOT block before the gate is open (phi_gate handles that case)', () => {
    delete process.env.PHI_GATE_READY // gate closed
    expect(phiKeyBlocked('microsoft')).toBe(false)
  })

  it('never blocks a non-PHI provider — the DB key is an accepted tradeoff for them', () => {
    process.env.PHI_GATE_READY = 'true' // no env key
    expect(phiKeyBlocked('quickbooks')).toBe(false)
    expect(phiKeyBlocked('bloomerang')).toBe(false)
    expect(phiKeyBlocked('asana')).toBe(false)
  })

  it('blockedReason surfaces phi_key for the UI', () => {
    process.env.PHI_GATE_READY = 'true'
    expect(blockedReason('microsoft')).toBe('phi_key')
    process.env.CONNECTOR_ENC_KEY = envKey()
    process.env.MS_CLIENT_ID = 'x'; process.env.MS_CLIENT_SECRET = 'y'
    expect(blockedReason('microsoft')).toBe(null) // gate open + env key + creds → connectable
  })
})

describe('assertPhiKeyInvariant (startup / CI fail-closed guard)', () => {
  it('throws when PHI mode is on without the strong env key', () => {
    process.env.PHI_GATE_READY = 'true'
    expect(() => assertPhiKeyInvariant()).toThrow(/CONNECTOR_ENC_KEY/)
  })

  it('passes when PHI mode is on AND the env key is set', () => {
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = envKey()
    expect(() => assertPhiKeyInvariant()).not.toThrow()
  })

  it('passes when the PHI gate is closed (soft launch — DB key allowed for non-PHI)', () => {
    delete process.env.PHI_GATE_READY
    expect(() => assertPhiKeyInvariant()).not.toThrow()
  })
})

describe('POST /api/connections — PHI provider connect at the gate', () => {
  it('BLOCKS a phiGated apikey provider when gate-ready with only a DB key (no seal)', async () => {
    process.env.PHI_GATE_READY = 'true' // no env key → DB fallback
    const calls = adminMock()
    const res = await POST(postReq({ provider: 'qualtrics', apiKey: 'paste-me' }))
    expect(res.status).toBe(503)
    expect(calls.connUpsert).toBe(0) // never sealed with the DB key
  })

  it('PROCEEDS for the same provider once the strong env key is set', async () => {
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = envKey()
    const calls = adminMock()
    const res = await POST(postReq({ provider: 'qualtrics', apiKey: 'paste-me' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(calls.connUpsert).toBe(1) // sealed with the env key + stored
  })

  it('leaves the non-PHI DB-key soft launch intact (Bloomerang connects with no env key)', async () => {
    delete process.env.PHI_GATE_READY // no env key either
    const calls = adminMock()
    const res = await POST(postReq({ provider: 'bloomerang', apiKey: 'paste-me' }))
    expect(res.status).toBe(200)
    expect(calls.connUpsert).toBe(1)
  })
})

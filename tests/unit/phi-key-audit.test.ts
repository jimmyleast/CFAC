import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { findPhiConnectorCiphertext, assertNoDbKeySealedPhiCiphertext, phiProviderIds } from '@/lib/connectors/phi-key-audit'
import { __resetKeyCacheForTests } from '@/lib/connectors/crypto'
import { emitAppEvent } from '@/lib/telemetry/events'
import { PROVIDERS } from '@/lib/connectors/providers'
import { getAdminClient } from '@/lib/admin'

const mEmit = emitAppEvent as unknown as ReturnType<typeof vi.fn>
const mGetAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>
const noSleep = { sleep: async () => {} }

// Seal a value with a specific base64 key in the v1 format encryptSecret produces.
function sealWith(keyB64: string, plaintext: string): string {
  const key = Buffer.from(keyB64, 'base64')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`
}

type Row = { provider: string; access_token_enc?: string | null; refresh_token_enc?: string | null; api_key_enc?: string | null }

// Mocks the service-role client: connections.select(...).in('provider', ids)
// returns the seeded rows filtered to the requested phiGated ids (so the audit's
// id filter is genuinely exercised). `error` forces a persistent query failure;
// `errorsBeforeSuccess` simulates a transient blip that recovers after N attempts.
function adminWith(rows: Row[], opts: { error?: { message: string }; errorsBeforeSuccess?: number; throws?: boolean } = {}) {
  let calls = 0
  const norm = (r: Row) => ({
    provider: r.provider,
    access_token_enc: r.access_token_enc ?? null,
    refresh_token_enc: r.refresh_token_enc ?? null,
    api_key_enc: r.api_key_enc ?? null,
  })
  return {
    from: (table: string) => {
      expect(table).toBe('connections')
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => {
            calls++
            if (opts.throws) throw new Error('socket hang up') // transport-level rejection
            if (opts.error) return { data: null, error: opts.error }
            if (opts.errorsBeforeSuccess && calls <= opts.errorsBeforeSuccess) return { data: null, error: { message: 'transient' } }
            return { data: rows.filter((r) => ids.includes(r.provider)).map(norm), error: null }
          },
        }),
      }
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetKeyCacheForTests()
  delete process.env.CONNECTOR_ENC_KEY
})

describe('phi-key-audit — fail closed on DB-key-sealed PHI ciphertext', () => {
  it('THROWS when a PHI-gated provider holds ciphertext and no env key is in force (DB-key-sealed)', async () => {
    const admin = adminWith([{ provider: 'microsoft', access_token_enc: 'v1.aa.bb.cc' }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/FAIL CLOSED/)
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/microsoft \(access_token_enc\)/)
  })

  it('emits a durable connector.phi_audit.violation event (provider + columns only) before throwing', async () => {
    const admin = adminWith([{ provider: 'microsoft', access_token_enc: 'v1.aa.bb.cc' }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/FAIL CLOSED/)
    expect(mEmit).toHaveBeenCalledTimes(1)
    const arg = mEmit.mock.calls[0][0]
    expect(arg.eventName).toBe('connector.phi_audit.violation')
    expect(arg.category).toBe('error')
    expect(arg.metadata.providers).toEqual(['microsoft'])
    // never any ciphertext/plaintext in the event
    expect(JSON.stringify(arg)).not.toContain('v1.aa.bb.cc')
  })

  it('passes and emits a connector.phi_audit.passed heartbeat when no PHI-gated row holds ciphertext', async () => {
    const admin = adminWith([{ provider: 'docusign' }, { provider: 'qualtrics', api_key_enc: null }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).resolves.toBeUndefined()
    expect(mEmit).toHaveBeenCalledTimes(1)
    expect(mEmit.mock.calls[0][0].eventName).toBe('connector.phi_audit.passed')
    expect(await findPhiConnectorCiphertext(admin)).toEqual([])
  })

  it('ignores NON-PHI providers that hold ciphertext (only phiGated ids are audited)', async () => {
    const admin = adminWith([
      { provider: 'quickbooks', access_token_enc: 'v1.x.y.z' },
      { provider: 'asana', access_token_enc: 'v1.x.y.z' },
    ])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).resolves.toBeUndefined()
    expect(await findPhiConnectorCiphertext(admin)).toEqual([])
  })

  it('passes when PHI-gated ciphertext is provably sealed under the strong env key', async () => {
    const envKey = crypto.randomBytes(32).toString('base64')
    process.env.CONNECTOR_ENC_KEY = envKey
    const admin = adminWith([{ provider: 'qualtrics', api_key_enc: sealWith(envKey, 'tok') }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).resolves.toBeUndefined()
    const findings = await findPhiConnectorCiphertext(admin)
    expect(findings).toEqual([{ provider: 'qualtrics', columns: ['api_key_enc'], envKeyDecryptable: true }])
  })

  it('THROWS even with an env key set if the ciphertext was sealed under a DIFFERENT (DB) key', async () => {
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    const dbKey = crypto.randomBytes(32).toString('base64') // the old co-located DB key
    const admin = adminWith([{ provider: 'docusign', access_token_enc: sealWith(dbKey, 'tok') }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/FAIL CLOSED/)
  })

  it('treats a malformed/short CONNECTOR_ENC_KEY as "no env key in force" → DB-sealed ciphertext throws', async () => {
    process.env.CONNECTOR_ENC_KEY = 'too-short' // not 32 bytes → isEnvKeyConfigured() === false
    const admin = adminWith([{ provider: 'qualtrics', api_key_enc: 'v1.aa.bb.cc' }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/FAIL CLOSED/)
  })

  it('flags a MIXED-key row (one column env-sealed, another DB-sealed) as a violation', async () => {
    const envKey = crypto.randomBytes(32).toString('base64')
    process.env.CONNECTOR_ENC_KEY = envKey
    const dbKey = crypto.randomBytes(32).toString('base64')
    const admin = adminWith([{ provider: 'microsoft', access_token_enc: sealWith(envKey, 'a'), refresh_token_enc: sealWith(dbKey, 'r') }])
    const findings = await findPhiConnectorCiphertext(admin)
    expect(findings).toEqual([{ provider: 'microsoft', columns: ['access_token_enc', 'refresh_token_enc'], envKeyDecryptable: false }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/FAIL CLOSED/)
  })

  it('reports MULTIPLE violators in the detail string and event, separated by "; "', async () => {
    const admin = adminWith([
      { provider: 'microsoft', access_token_enc: 'v1.a.b.c' },
      { provider: 'docusign', refresh_token_enc: 'v1.d.e.f' },
    ])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/microsoft \(access_token_enc\); docusign \(refresh_token_enc\)/)
    const arg = mEmit.mock.calls[0][0]
    expect(arg.metadata.providers).toEqual(['microsoft', 'docusign'])
    expect(arg.metadata.findings).toEqual([
      { provider: 'microsoft', columns: ['access_token_enc'] },
      { provider: 'docusign', columns: ['refresh_token_enc'] },
    ])
  })

  it('a telemetry failure never masks the fail-closed throw', async () => {
    mEmit.mockRejectedValueOnce(new Error('telemetry down'))
    const admin = adminWith([{ provider: 'microsoft', access_token_enc: 'v1.a.b.c' }])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/FAIL CLOSED/)
  })

  it('partitions a mix of clean and violating PHI-gated rows (not all-or-nothing)', async () => {
    const envKey = crypto.randomBytes(32).toString('base64')
    process.env.CONNECTOR_ENC_KEY = envKey
    const admin = adminWith([
      { provider: 'qualtrics', api_key_enc: sealWith(envKey, 'ok') }, // env-sealed → clean
      { provider: 'docusign', access_token_enc: sealWith(crypto.randomBytes(32).toString('base64'), 'x') }, // DB-sealed → violation
    ])
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.toThrow(/docusign \(access_token_enc\)/)
    await expect(assertNoDbKeySealedPhiCiphertext(admin)).rejects.not.toThrow(/qualtrics/)
  })

  it('retries a transient query error with bounded backoff, then evaluates once recovered', async () => {
    // First two attempts error; third returns a DB-sealed violation → still fails closed.
    const admin = adminWith([{ provider: 'microsoft', access_token_enc: 'v1.a.b.c' }], { errorsBeforeSuccess: 2 })
    await expect(assertNoDbKeySealedPhiCiphertext(admin, noSleep)).rejects.toThrow(/FAIL CLOSED/)
  })

  it('fails closed + emits connector.phi_audit.unavailable if the query keeps erroring past the retry budget', async () => {
    const admin = adminWith([], { error: { message: 'db unreachable' } })
    await expect(assertNoDbKeySealedPhiCiphertext(admin, noSleep)).rejects.toThrow(/connections query failed after 3 attempt\(s\)/)
    const unavailable = mEmit.mock.calls.find((c) => c[0].eventName === 'connector.phi_audit.unavailable')
    expect(unavailable).toBeTruthy()
    expect(unavailable![0].metadata.attempts).toBe(3)
  })

  it('also retries + fails closed when the query THROWS (transport rejection, not a returned error)', async () => {
    const admin = adminWith([], { throws: true })
    await expect(assertNoDbKeySealedPhiCiphertext(admin, noSleep)).rejects.toThrow(/connections query failed after 3 attempt\(s\): socket hang up/)
    expect(mEmit.mock.calls.some((c) => c[0].eventName === 'connector.phi_audit.unavailable')).toBe(true)
  })

  it('uses getAdminClient() by default when no client is injected (the production call path)', async () => {
    mGetAdmin.mockReturnValue(adminWith([{ provider: 'docusign' }])) // clean
    await expect(assertNoDbKeySealedPhiCiphertext()).resolves.toBeUndefined()
    expect(mGetAdmin).toHaveBeenCalled()
  })
})

describe('phi-key-audit — provider scope invariant', () => {
  it('audits every PHI provider and scope cannot be narrowed by flag drift (phiAllowed ⟹ phiGated)', () => {
    const ids = phiProviderIds()
    for (const p of Object.values(PROVIDERS)) {
      if (p.phiAllowed) {
        expect(ids).toContain(p.id) // any PHI provider is audited
        expect(p.phiGated).toBe(true) // registry keeps the two PHI flags aligned
      }
    }
  })
})

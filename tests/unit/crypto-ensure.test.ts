import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { ensureEncryptionKey, encryptSecret, decryptSecret, __resetKeyCacheForTests } from '@/lib/connectors/crypto'
import { getAdminClient } from '@/lib/admin'

const mAdmin = getAdminClient as unknown as ReturnType<typeof vi.fn>

// Seal a value with a specific base64 key, mirroring encryptSecret's v1 format.
function sealWith(keyB64: string, plaintext: string): string {
  const key = Buffer.from(keyB64, 'base64')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`
}

// A get-or-create store mock: select returns the current row, insert persists it
// (unless forced to return a PostgREST-shaped error). Counts platform_secrets hits.
function storeMock({ insertError }: { insertError?: { code?: string; message?: string } } = {}) {
  const state = { row: null as { value: string } | null, hits: 0, inserted: false }
  mAdmin.mockReturnValue({
    from: () => {
      state.hits++
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row }) }) }),
        insert: async (r: { value: string }) => {
          if (insertError) return { error: insertError }
          state.row = { value: r.value }; state.inserted = true; return { error: null }
        },
      }
    },
  })
  return state
}

beforeEach(() => { vi.clearAllMocks(); __resetKeyCacheForTests(); delete process.env.CONNECTOR_ENC_KEY })

describe('ensureEncryptionKey', () => {
  it('env key takes precedence and never touches the DB', async () => {
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    expect(await ensureEncryptionKey()).toBe(true)
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('generates + stores a DB key when no env key, then encrypt/decrypt works', async () => {
    const state = storeMock()
    expect(await ensureEncryptionKey()).toBe(true)
    expect(state.inserted).toBe(true)
    const blob = encryptSecret('super-secret')
    expect(blob).not.toContain('super-secret')
    expect(decryptSecret(blob)).toBe('super-secret')
  })

  it('CONCURRENCY: a 23505 conflict (insert resolves with an error) → caches the WINNING key', async () => {
    const keyA = crypto.randomBytes(32).toString('base64')
    const blobSealedWithA = sealWith(keyA, 'credential')
    let selectCount = 0
    mAdmin.mockReturnValue({
      from: () => ({
        // first select: empty (we think we must create); read-back: the winner keyA
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: selectCount++ === 0 ? null : { value: keyA } }) }) }),
        // real supabase-js RESOLVES with an error object on a unique violation
        insert: async () => ({ error: { code: '23505', message: 'duplicate key value' } }),
      }),
    })
    expect(await ensureEncryptionKey()).toBe(true)
    // If the cached key were our discarded fresh key, this would throw (GCM auth fail).
    expect(decryptSecret(blobSealedWithA)).toBe('credential')
  })

  it('returns false (no key cached) on a NON-conflict insert error — failure is not masked', async () => {
    storeMock({ insertError: { code: '42501', message: 'permission denied' } })
    expect(await ensureEncryptionKey()).toBe(false)
    // cache stayed empty: with no env key, encrypt now has no key to use
    expect(() => encryptSecret('x')).toThrow()
  })

  it('env key overrides an already-cached DB key (upgrade without a restart)', async () => {
    storeMock()
    expect(await ensureEncryptionKey()).toBe(true)
    const dbBlob = encryptSecret('sealed-with-db-key')
    // an operator now sets the env key to harden off the DB key
    const envKey = crypto.randomBytes(32).toString('base64')
    process.env.CONNECTOR_ENC_KEY = envKey
    expect(decryptSecret(sealWith(envKey, 'ok'))).toBe('ok') // env key is now in force
    expect(() => decryptSecret(dbBlob)).toThrow() // old DB-key ciphertext no longer matches
  })

  it('caches the key — a second call makes no further DB calls', async () => {
    const state = storeMock()
    expect(await ensureEncryptionKey()).toBe(true)
    const hitsAfterFirst = state.hits
    expect(await ensureEncryptionKey()).toBe(true)
    expect(state.hits).toBe(hitsAfterFirst) // fast path, no platform_secrets access
  })

  it('decryptSecret throws on ciphertext sealed with a different key', async () => {
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    await ensureEncryptionKey()
    const foreign = sealWith(crypto.randomBytes(32).toString('base64'), 'secret')
    expect(() => decryptSecret(foreign)).toThrow()
  })

  it('returns false from a cold cache when the DB is unreachable', async () => {
    mAdmin.mockReturnValue({ from: () => { throw new Error('db down') } })
    expect(await ensureEncryptionKey()).toBe(false)
  })
})

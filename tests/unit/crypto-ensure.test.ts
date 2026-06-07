import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))

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

beforeEach(() => { vi.clearAllMocks(); __resetKeyCacheForTests(); delete process.env.CONNECTOR_ENC_KEY })

describe('ensureEncryptionKey', () => {
  it('env key takes precedence and never touches the DB', async () => {
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    expect(await ensureEncryptionKey()).toBe(true)
    expect(mAdmin).not.toHaveBeenCalled()
  })

  it('generates + stores a DB key when no env key, then encrypt/decrypt works', async () => {
    let stored: { value: string } | null = null
    let inserted = false
    mAdmin.mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored }) }) }),
        insert: async (row: { value: string }) => { stored = { value: row.value }; inserted = true; return {} },
      }),
    })
    expect(await ensureEncryptionKey()).toBe(true)
    expect(inserted).toBe(true)
    const blob = encryptSecret('super-secret')
    expect(blob).not.toContain('super-secret')
    expect(decryptSecret(blob)).toBe('super-secret')
  })

  it('CONCURRENCY: when our insert loses the race, it caches the WINNING key (no orphaned ciphertext)', async () => {
    const keyA = crypto.randomBytes(32).toString('base64')
    const blobSealedWithA = sealWith(keyA, 'credential')
    let selectCount = 0
    mAdmin.mockReturnValue({
      from: () => ({
        // first select: empty (we think we must create); second select (read-back): the winner keyA
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: selectCount++ === 0 ? null : { value: keyA } }) }) }),
        insert: async () => ({}), // our insert "succeeds" in the mock, but read-back returns the winner keyA
      }),
    })
    expect(await ensureEncryptionKey()).toBe(true)
    // If the cached key were our discarded fresh key, this would throw (GCM auth fail).
    expect(decryptSecret(blobSealedWithA)).toBe('credential')
  })

  it('returns false from a cold cache when the DB is unreachable', async () => {
    mAdmin.mockReturnValue({ from: () => { throw new Error('db down') } })
    expect(await ensureEncryptionKey()).toBe(false)
  })
})

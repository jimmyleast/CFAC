import crypto from 'crypto'
import { getAdminClient } from '@/lib/admin'

// App-level envelope encryption for connector secrets (OAuth tokens / API keys).
// AES-256-GCM (authenticated). Ciphertext format: `v1.<iv>.<tag>.<ct>` (base64).
// Only ciphertext is persisted.
//
// Key resolution: CONNECTOR_ENC_KEY env (preferred) → else a get-or-create
// DB-stored key (ensureEncryptionKey), so connecting needs ZERO server config
// for a soft launch. PRODUCTION: set the env key / move to a KMS.

const ALG = 'aes-256-gcm'
let cachedKey: Buffer | null = null

function parseRaw(raw?: string | null): Buffer | null {
  if (!raw) return null
  let buf: Buffer
  try {
    buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  } catch {
    return null
  }
  return buf.length === 32 ? buf : null
}

function getKey(): Buffer | null {
  return cachedKey ?? parseRaw(process.env.CONNECTOR_ENC_KEY)
}

/**
 * Ensure an encryption key is available: env first, else get-or-create a
 * DB-stored key. Call once before encrypt/decrypt in a request. Idempotent +
 * cached. Returns false only if the DB is unreachable.
 */
export async function ensureEncryptionKey(): Promise<boolean> {
  if (getKey()) { cachedKey = getKey(); return true }
  try {
    const admin = getAdminClient()
    const { data } = await admin.from('platform_secrets').select('value').eq('key', 'connector_enc').maybeSingle()
    const existing = parseRaw(data?.value)
    if (existing) { cachedKey = existing; return true }
    // Create-if-absent (NOT overwrite): a duplicate-key error means a concurrent
    // writer/instance already created the key — we must NOT replace it (that would
    // orphan ciphertext already sealed with the winning key). Swallow the conflict
    // and read back the canonical value so every instance converges on one key.
    const fresh = crypto.randomBytes(32)
    await admin.from('platform_secrets').insert({ key: 'connector_enc', value: fresh.toString('base64') }).then(() => {}, () => {})
    const { data: winner } = await admin.from('platform_secrets').select('value').eq('key', 'connector_enc').maybeSingle()
    const key = parseRaw(winner?.value)
    if (!key) return false
    cachedKey = key
    return true
  } catch {
    return false
  }
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null
}

/** Test-only: clear the in-memory key cache so env/DB resolution can be re-exercised. */
export function __resetKeyCacheForTests(): void {
  cachedKey = null
}

export function encryptSecret(plaintext: string): string {
  const key = getKey()
  if (!key) throw new Error('CONNECTOR_ENC_KEY not configured (need a 32-byte base64 or hex key)')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const key = getKey()
  if (!key) throw new Error('CONNECTOR_ENC_KEY not configured')
  const parts = String(blob).split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('malformed ciphertext')
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const ct = Buffer.from(parts[3], 'base64')
  const decipher = crypto.createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

import crypto from 'crypto'
import { getAdminClient } from '@/lib/admin'
import { emitAppEvent } from '@/lib/telemetry/events'

// Re-exported so existing importers keep using '@/lib/connectors/crypto'. The check
// itself lives in the edge-safe key-env module (no node:crypto) so policy code like
// providers.ts can import it without dragging this node-only module into edge bundles.
export { isEnvKeyConfigured } from './key-env'

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
  // Env key ALWAYS wins over the cached DB key, so setting CONNECTOR_ENC_KEY (the
  // documented hardening upgrade) takes effect on the next call without needing a
  // process restart to clear the warm DB-key cache.
  return parseRaw(process.env.CONNECTOR_ENC_KEY) ?? cachedKey
}

/**
 * Ensure an encryption key is available: env first, else get-or-create a
 * DB-stored key. Call once before encrypt/decrypt in a request. Idempotent +
 * cached. Returns false only if the DB is unreachable.
 */
export async function ensureEncryptionKey(): Promise<boolean> {
  if (getKey()) return true
  try {
    const admin = getAdminClient()
    const { data } = await admin.from('platform_secrets').select('value').eq('key', 'connector_enc').maybeSingle()
    const existing = parseRaw(data?.value)
    if (existing) { cachedKey = existing; return true }
    // Create-if-absent (NOT overwrite): overwriting would orphan ciphertext already
    // sealed with the winning key. supabase-js RESOLVES (does not reject) on a unique
    // violation, so inspect the returned error: 23505 means a concurrent writer/
    // instance already created the key — benign, we read back the winner below. Any
    // OTHER error is a real failure and must not be masked.
    const fresh = crypto.randomBytes(32)
    const { error: insErr } = await admin.from('platform_secrets').insert({ key: 'connector_enc', value: fresh.toString('base64') })
    if (insErr && (insErr as { code?: string }).code !== '23505') {
      console.error('[crypto] platform_secrets key insert failed:', insErr)
      return false
    }
    // Read back the canonical value so every instance converges on one key.
    const { data: winner } = await admin.from('platform_secrets').select('value').eq('key', 'connector_enc').maybeSingle()
    const key = parseRaw(winner?.value)
    if (!key) return false
    cachedKey = key
    // One-time genesis signal: only when OUR insert won (no conflict). In a healthy
    // system this fires exactly once ever — any repeat is a high-signal alert.
    if (!insErr) {
      await emitAppEvent({ eventName: 'connector.enc_key.created', category: 'system', route: 'lib/connectors/crypto', status: 'created', metadata: { keyId: 'connector_enc', source: 'auto-db' } }).catch(() => {})
    }
    return true
  } catch (e) {
    console.error('[crypto] ensureEncryptionKey failed:', e)
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

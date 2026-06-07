import crypto from 'crypto'

// App-level envelope encryption for connector secrets (OAuth tokens / API keys).
// AES-256-GCM (authenticated) with a 32-byte key from CONNECTOR_ENC_KEY (base64
// or hex). Ciphertext format: `v1.<iv>.<tag>.<ct>` (all base64). Only ciphertext
// is ever persisted. PRODUCTION: move the master key to a KMS + rotation.

const ALG = 'aes-256-gcm'

function getKey(): Buffer | null {
  const raw = process.env.CONNECTOR_ENC_KEY
  if (!raw) return null
  let buf: Buffer
  try {
    buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  } catch {
    return null
  }
  return buf.length === 32 ? buf : null
}

export function isEncryptionConfigured(): boolean {
  return getKey() !== null
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

import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'crypto'
import { generateState, generatePkce, buildAuthUrl, isStateExpired } from '@/lib/connectors/oauth'
import { getProvider, isConfigured, blockedReason, PROVIDERS } from '@/lib/connectors/providers'

describe('connector oauth helpers', () => {
  it('generateState is unique and url-safe', () => {
    const a = generateState(), b = generateState()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generatePkce produces a valid S256 verifier/challenge pair', () => {
    const { verifier, challenge } = generatePkce()
    const expected = crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(challenge).toBe(expected)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('buildAuthUrl includes PKCE + state + exact params', () => {
    const url = new URL(buildAuthUrl({ authUrl: 'https://idp/authorize', clientId: 'cid', redirectUri: 'https://app/cb', scopes: ['a', 'b'], state: 'st', challenge: 'ch' }))
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/cb')
    expect(url.searchParams.get('scope')).toBe('a b')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('code_challenge')).toBe('ch')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('isStateExpired honors the ttl', () => {
    const now = Date.now()
    expect(isStateExpired(new Date(now - 5 * 60_000).toISOString(), now, 600)).toBe(false)
    expect(isStateExpired(new Date(now - 20 * 60_000).toISOString(), now, 600)).toBe(true)
    expect(isStateExpired('not-a-date', now)).toBe(true)
  })
})

describe('provider registry', () => {
  it('apikey providers are always connectable', () => {
    expect(isConfigured('bloomerang')).toBe(true)
    expect(isConfigured('qgiv')).toBe(true)
  })
  it('non-PHI oauth provider needs only env creds', () => {
    delete process.env.QBO_CLIENT_ID; delete process.env.QBO_CLIENT_SECRET
    expect(isConfigured('quickbooks')).toBe(false)
    process.env.QBO_CLIENT_ID = 'x'; process.env.QBO_CLIENT_SECRET = 'y'
    expect(isConfigured('quickbooks')).toBe(true)
  })
  it('PHI-gated Microsoft stays blocked until PHI_GATE_READY even with creds', () => {
    process.env.MS_CLIENT_ID = 'x'; process.env.MS_CLIENT_SECRET = 'y'
    delete process.env.PHI_GATE_READY
    expect(isConfigured('microsoft')).toBe(false)
    expect(blockedReason('microsoft')).toBe('phi_gate')
    process.env.PHI_GATE_READY = 'true'
    expect(isConfigured('microsoft')).toBe(true)
    delete process.env.PHI_GATE_READY
  })
  it('Microsoft no longer requests Mail.Read in the scaffolding scopes', () => {
    expect(getProvider('microsoft')!.scopes).not.toContain('Mail.Read')
  })
  it('marks PHI/BAA correctly (QuickBooks no BAA → non-PHI)', () => {
    expect(getProvider('quickbooks')!.phiAllowed).toBe(false)
    expect(getProvider('microsoft')!.phiAllowed).toBe(true)
    expect(Object.keys(PROVIDERS)).toContain('microsoft')
  })
})

describe('connector crypto (AES-256-GCM)', () => {
  beforeAll(() => { process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64') })

  it('roundtrips a secret', async () => {
    const { encryptSecret, decryptSecret, isEncryptionConfigured } = await import('@/lib/connectors/crypto')
    expect(isEncryptionConfigured()).toBe(true)
    const secret = 'super-secret-refresh-token-xyz'
    const blob = encryptSecret(secret)
    expect(blob).toMatch(/^v1\./)
    expect(blob).not.toContain(secret)
    expect(decryptSecret(blob)).toBe(secret)
  })

  it('rejects a tampered ciphertext (auth tag)', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/connectors/crypto')
    const blob = encryptSecret('abc')
    const parts = blob.split('.')
    parts[3] = Buffer.from('tampered').toString('base64')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })

  it('rejects malformed ciphertext format', async () => {
    const { decryptSecret } = await import('@/lib/connectors/crypto')
    expect(() => decryptSecret('not-a-blob')).toThrow(/malformed/)
    expect(() => decryptSecret('v2.a.b.c')).toThrow()
  })

  it('throws / reports not-configured when the key is absent or wrong size', async () => {
    const { encryptSecret, isEncryptionConfigured } = await import('@/lib/connectors/crypto')
    const saved = process.env.CONNECTOR_ENC_KEY
    delete process.env.CONNECTOR_ENC_KEY
    expect(isEncryptionConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(/not configured/)
    process.env.CONNECTOR_ENC_KEY = Buffer.from('tooshort').toString('base64') // <32 bytes
    expect(isEncryptionConfigured()).toBe(false)
    process.env.CONNECTOR_ENC_KEY = saved
  })
})

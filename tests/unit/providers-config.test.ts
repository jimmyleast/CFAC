import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isConfigured, blockedReason, getProvider, PROVIDERS } from '@/lib/connectors/providers'

// Locks the non-PHI enablement invariants: non-PHI connectors are connectable now,
// PHI connectors stay blocked regardless of authKind, and making Asana an API-key
// provider never makes a PHI provider submittable.
describe('connector enablement / gating', () => {
  const saved = { ...process.env }
  beforeEach(() => { delete process.env.PHI_GATE_READY; delete process.env.QBO_CLIENT_ID; delete process.env.QBO_CLIENT_SECRET })
  afterEach(() => { process.env = { ...saved } })

  it('Asana is a non-PHI API-key provider, connectable now', () => {
    const a = getProvider('asana')!
    expect(a.authKind).toBe('apikey')
    expect(a.phiAllowed).toBe(false)
    expect(a.phiGated).toBeFalsy()
    expect(isConfigured('asana')).toBe(true)
    expect(blockedReason('asana')).toBeNull()
  })

  it('Bloomerang and Qgiv (non-PHI API-key) are connectable now', () => {
    for (const id of ['bloomerang', 'qgiv']) {
      expect(isConfigured(id)).toBe(true)
      expect(blockedReason(id)).toBeNull()
    }
  })

  it('QuickBooks (OAuth, no creds) is needs_setup with an actionable hint, not a PHI block', () => {
    expect(blockedReason('quickbooks')).toBe('needs_setup')
    expect(getProvider('quickbooks')!.setupHint).toMatch(/intuit/i)
  })

  it('PHI providers stay gated regardless of authKind (gate closed)', () => {
    // qualtrics is apikey+phiGated; docusign/microsoft are oauth2+phiGated.
    for (const id of ['qualtrics', 'docusign', 'microsoft']) {
      expect(getProvider(id)!.phiGated).toBe(true)
      expect(isConfigured(id)).toBe(false)
      expect(blockedReason(id)).toBe('phi_gate')
    }
  })

  it('setupHint never embeds a secret value (static help text only)', () => {
    process.env.QBO_CLIENT_SECRET = 'super-secret-value-xyz'
    for (const p of Object.values(PROVIDERS)) {
      if (p.setupHint) expect(p.setupHint).not.toContain('super-secret-value-xyz')
    }
  })
})

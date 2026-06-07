import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'

// Exercises the register() WRAPPER branch logic for BOTH boot guards:
//   1. assertPhiKeyInvariant (real, from providers) — covered in detail in
//      phi-key-guard.test.ts; here we lock in WHEN it fires from the wrapper.
//   2. assertNoDbKeySealedPhiCiphertext (mocked) — the at-rest audit; here we lock
//      in WHEN the wrapper invokes it vs. skips/hard-fails.
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))
vi.mock('@/lib/connectors/phi-key-audit', () => ({ assertNoDbKeySealedPhiCiphertext: vi.fn(async () => {}) }))

import { register } from '@/instrumentation'
import { assertNoDbKeySealedPhiCiphertext } from '@/lib/connectors/phi-key-audit'

const mAudit = assertNoDbKeySealedPhiCiphertext as unknown as ReturnType<typeof vi.fn>
const ORIG_NODE_ENV = process.env.NODE_ENV

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_RUNTIME
  delete process.env.NEXT_PHASE
  delete process.env.PHI_GATE_READY
  delete process.env.CONNECTOR_ENC_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.NODE_ENV = 'test'
})
afterEach(() => { process.env.NODE_ENV = ORIG_NODE_ENV })

describe('instrumentation register() — boot guard #1: PHI key invariant', () => {
  it('THROWS at boot when nodejs runtime + PHI mode + no strong env key', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.PHI_GATE_READY = 'true' // no CONNECTOR_ENC_KEY → only the DB fallback
    await expect(register()).rejects.toThrow(/CONNECTOR_ENC_KEY/)
    expect(mAudit).not.toHaveBeenCalled() // invariant fails before the at-rest audit
  })

  it('proceeds past the invariant when nodejs + PHI mode + the strong env key is set', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    await expect(register()).resolves.toBeUndefined() // no service-role key → audit skipped (non-prod)
  })

  it('is a no-op in the edge runtime even when PHI mode lacks the key', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.PHI_GATE_READY = 'true' // no key — but edge must never assert
    await expect(register()).resolves.toBeUndefined()
    expect(mAudit).not.toHaveBeenCalled()
  })

  it('is a no-op during next build (phase-production-build) — runtime-only precondition', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-build'
    process.env.PHI_GATE_READY = 'true' // no key — but the build must not fail
    await expect(register()).resolves.toBeUndefined()
    expect(mAudit).not.toHaveBeenCalled()
  })

  it('is a no-op in the current soft launch (gate closed)', async () => {
    process.env.NEXT_RUNTIME = 'nodejs' // PHI_GATE_READY unset
    await expect(register()).resolves.toBeUndefined()
  })
})

describe('instrumentation register() — boot guard #2: at-rest ciphertext audit', () => {
  it('runs the at-rest audit on the node runtime when the service-role key is configured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
    await register()
    expect(mAudit).toHaveBeenCalledTimes(1)
  })

  it('propagates the audit rejection so a violation actually blocks boot (await is load-bearing)', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
    mAudit.mockRejectedValueOnce(new Error('FAIL CLOSED'))
    await expect(register()).rejects.toThrow(/FAIL CLOSED/)
  })

  it('THROWS (refuses boot) when the service-role key is missing in production — no silent skip', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NODE_ENV = 'production'
    await expect(register()).rejects.toThrow(/SECURITY CONTROL CANNOT RUN/)
    expect(mAudit).not.toHaveBeenCalled()
  })

  it('skips the audit (no throw) when the service-role key is missing outside production', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NODE_ENV = 'development'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(register()).resolves.toBeUndefined()
    expect(mAudit).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('instrumentation register() — both guards composed (the day the gate opens)', () => {
  it('FULL PHI CONFIG: invariant passes (gate open + env key) AND hands off to the at-rest audit', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
    await expect(register()).resolves.toBeUndefined()
    expect(mAudit).toHaveBeenCalledTimes(1) // both guards ran, in order
  })

  it('gate open WITHOUT the env key: invariant throws BEFORE the at-rest audit, even with the service key present', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.PHI_GATE_READY = 'true' // no CONNECTOR_ENC_KEY
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
    await expect(register()).rejects.toThrow(/CONNECTOR_ENC_KEY/)
    expect(mAudit).not.toHaveBeenCalled() // ordering: guard #1 fails closed first
  })
})

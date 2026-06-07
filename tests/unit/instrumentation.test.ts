import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// Exercises the register() WRAPPER branch logic (runtime guard + build-phase skip +
// throw). assertPhiKeyInvariant itself is covered in phi-key-guard.test.ts; this
// locks in WHEN the boot guard actually fires.
vi.mock('@/lib/admin', () => ({ getAdminClient: vi.fn() }))
vi.mock('@/lib/telemetry/events', () => ({ emitAppEvent: vi.fn(async () => {}) }))

import { register } from '@/instrumentation'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEXT_RUNTIME
  delete process.env.NEXT_PHASE
  delete process.env.PHI_GATE_READY
  delete process.env.CONNECTOR_ENC_KEY
})

describe('instrumentation register() — boot guard wiring', () => {
  it('THROWS at boot when nodejs runtime + PHI mode + no strong env key', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.PHI_GATE_READY = 'true' // no CONNECTOR_ENC_KEY → only the DB fallback
    await expect(register()).rejects.toThrow(/CONNECTOR_ENC_KEY/)
  })

  it('resolves (no throw) when nodejs + PHI mode + the strong env key is set', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.PHI_GATE_READY = 'true'
    process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64')
    await expect(register()).resolves.toBeUndefined()
  })

  it('is a no-op in the edge runtime even when PHI mode lacks the key', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.PHI_GATE_READY = 'true' // no key — but edge must never assert
    await expect(register()).resolves.toBeUndefined()
  })

  it('is a no-op during next build (phase-production-build) — runtime-only precondition', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-build'
    process.env.PHI_GATE_READY = 'true' // no key — but the build must not fail
    await expect(register()).resolves.toBeUndefined()
  })

  it('is a no-op in the current soft launch (gate closed)', async () => {
    process.env.NEXT_RUNTIME = 'nodejs' // PHI_GATE_READY unset
    await expect(register()).resolves.toBeUndefined()
  })
})

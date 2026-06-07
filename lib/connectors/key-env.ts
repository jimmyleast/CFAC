// Edge-safe check for the strong, operator-provisioned connector encryption key.
// Kept dependency-light ON PURPOSE: only `Buffer` + `process.env`, no node:crypto and
// no DB client. That lets providers.ts (and the startup instrumentation hook) ask
// "is the PHI-grade env key in force?" without dragging the node-only crypto module
// into the edge-runtime bundle. The full key resolution (env → DB fallback) lives in
// crypto.ts; this is only the env-key half, which the PHI gate depends on.

/**
 * True iff CONNECTOR_ENC_KEY is set to a valid 32-byte key (hex or base64).
 *
 * Narrower than crypto.isEncryptionConfigured(): the auto-provisioned DB fallback
 * key does NOT count. PHI sealing requires this env key — see crypto.ts and
 * docs/PHI-INFRA-CHECKLIST.md §3. Mirrors crypto.ts `parseRaw` validation exactly.
 */
export function isEnvKeyConfigured(): boolean {
  const raw = process.env.CONNECTOR_ENC_KEY
  if (!raw) return false
  let buf: Buffer
  try {
    buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  } catch {
    return false
  }
  return buf.length === 32
}

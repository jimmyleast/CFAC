// Next.js server-startup hook. Runs once when the server process boots.
// Two fail-closed PHI guards run here, in order:
//   1. assertPhiKeyInvariant() — PHI mode (PHI_GATE_READY=true) must never run with
//      the co-located DB-key fallback; refuse to start if the strong CONNECTOR_ENC_KEY
//      is missing while the gate is open. (Guards NEW seals.)
//   2. assertNoDbKeySealedPhiCiphertext() — audits ciphertext ALREADY AT REST: no
//      phiGated connector row may hold a secret sealed under the DB fallback key.
//      (Guards STALE seals the first guard can't see.)
// See docs/PHI-INFRA-CHECKLIST.md §3, lib/connectors/providers.ts, phi-key-audit.ts.
export async function register() {
  // Node runtime only — the providers/crypto chain pulls in node 'crypto' + the
  // service-role Supabase client, which don't belong in the edge runtime. Keeping
  // both dynamic imports lexically inside this block lets the bundler drop them
  // (and their node-only deps) from the edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Never assert during `next build`: these are RUNTIME boot guards, and build
    // envs may share env groups (PHI_GATE_READY present) without the runtime secret
    // store — we must not fail the build for a runtime-only precondition.
    if (process.env.NEXT_PHASE === 'phase-production-build') return

    // 1. Boot invariant: PHI mode + DB-key fallback must never coexist.
    const { assertPhiKeyInvariant } = await import('@/lib/connectors/providers')
    assertPhiKeyInvariant() // throws (and aborts boot) if PHI gate open without the env key

    // 2. At-rest audit (DB query). No service-role config ⟹ this instance cannot
    //    reach the connections store. In production that is a misconfiguration that
    //    would SILENTLY DISABLE a PHI custody control — fail closed. Outside
    //    production (local/preview, where running without a DB is normal), skip loud.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[phi-key-audit] SECURITY CONTROL CANNOT RUN: SUPABASE_SERVICE_ROLE_KEY is unset in ' +
            'production — refusing to boot rather than silently skipping the PHI connector-ciphertext audit.',
        )
      }
      console.warn('[phi-key-audit] SECURITY CONTROL SKIPPED — SUPABASE_SERVICE_ROLE_KEY not set (non-production); connector PHI ciphertext audit not run')
      return
    }
    const { assertNoDbKeySealedPhiCiphertext } = await import('@/lib/connectors/phi-key-audit')
    await assertNoDbKeySealedPhiCiphertext()
  }
}

// Next.js server-startup hook. Runs once when the server process boots.
// We use it as a fail-closed guard: PHI mode (PHI_GATE_READY=true) must never run
// with the co-located DB-key fallback. If the strong CONNECTOR_ENC_KEY is missing
// while the PHI gate is open, refuse to start rather than seal PHI connector secrets
// with a key that sits in the same database as the ciphertext.
// See docs/PHI-INFRA-CHECKLIST.md §3 and lib/connectors/providers.ts.
export async function register() {
  // Node runtime only — the providers/crypto chain pulls in node 'crypto' + the
  // service-role Supabase client, which don't belong in the edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Never assert during `next build`: the invariant is a RUNTIME boot guard, and
  // build envs may share env groups (PHI_GATE_READY present) without the runtime
  // secret store — we must not fail the build for a runtime-only precondition.
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  const { assertPhiKeyInvariant } = await import('@/lib/connectors/providers')
  assertPhiKeyInvariant() // throws (and aborts boot) if PHI mode + DB-key fallback coexist
}

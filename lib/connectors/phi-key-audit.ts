import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/admin'
import { PROVIDERS } from '@/lib/connectors/providers'
import { decryptSecret } from '@/lib/connectors/crypto'
import { isEnvKeyConfigured } from '@/lib/connectors/key-env'
import { emitAppEvent } from '@/lib/telemetry/events'

// ============================================================================
// Fail-closed PHI invariant: NO phiGated connector may hold ciphertext that was
// sealed under the co-located DB fallback key (`platform_secrets.connector_enc`).
//
// Why this can happen: before the PHI key-strength guard existed, the connect
// flow would seal an OAuth token / API key with whatever key ensureEncryptionKey
// resolved — and with no CONNECTOR_ENC_KEY set, that is the auto-provisioned DB
// key, which lives in the SAME database as the ciphertext. The newer guard
// refuses NEW PHI seals under the DB key, and runSync now refuses to even touch
// such a row — so a stale, DB-key-sealed PHI secret would sit in `connections`
// undetected. This audit is the detector: it runs at server startup (and its
// logic is exercised in CI via the unit tests) and fails closed if any such row
// exists.
//
// Detection rule: a phiGated row's ciphertext is acceptable ONLY if EVERY
// populated *_enc column is provably sealed under the STRONG env key
// (CONNECTOR_ENC_KEY decrypts it). Everything else — no env key set, or any
// column the env key can't open — is a violation, because it was necessarily
// sealed under the DB fallback key. (Today the PHI gate has never been opened, so
// there should be ZERO phiGated ciphertext at all; this rule also stays correct
// once the gate is legitimately opened with the env key in force, scrubbing/
// re-sealing per PHI-INFRA-CHECKLIST §3.)
//
// `connections` is the SOLE at-rest store for connector secrets: the OAuth
// callback, the API-key connect route, and the invite route all write ciphertext
// only here (and the invite route refuses phiAllowed providers entirely). If a
// new *_enc column or a second ciphertext store is ever added, extend ENC_COLUMNS
// / this query to match — the invariant is "no DB-key-sealed PHI ciphertext
// anywhere," not just in these three columns.
//
// DB-backed → NODE-ONLY. Call sites must keep this off the edge runtime.
// ============================================================================

const ENC_COLUMNS = ['access_token_enc', 'refresh_token_enc', 'api_key_enc'] as const
type EncColumn = (typeof ENC_COLUMNS)[number]

type ConnCipherRow = { provider: string } & Record<EncColumn, string | null>

/** Audit knobs (bounded retry around the connections query). Defaults suit boot. */
export type AuditOptions = {
  /** Total attempts for the connections query before failing closed. */
  attempts?: number
  /** Base backoff (ms); doubles each retry. */
  baseDelayMs?: number
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Ids of every registry provider whose data is PHI. We scope on `phiAllowed ||
 * phiGated` (not `phiGated` alone) so the audit cannot be narrowed by flag drift:
 * if a future provider is marked `phiAllowed` without `phiGated`, its ciphertext
 * still falls inside the audit. (A registry invariant test asserts the two stay
 * aligned today.)
 */
export function phiProviderIds(): string[] {
  return Object.values(PROVIDERS).filter((p) => p.phiAllowed || p.phiGated).map((p) => p.id)
}

export type PhiCiphertextFinding = {
  provider: string
  /** Which *_enc columns held ciphertext on this row. */
  columns: EncColumn[]
  /** True only if the strong env key (CONNECTOR_ENC_KEY) can decrypt EVERY column above. */
  envKeyDecryptable: boolean
}

/**
 * Query `connections` for phiGated providers, retrying a transient failure with
 * bounded backoff. Throws (fail closed) only after exhausting attempts — a query
 * that cannot complete must never be reported as "clean," but a momentary DB blip
 * at boot should not be treated as a custody violation either.
 */
async function queryPhiConnections(
  admin: SupabaseClient, ids: string[], opts: AuditOptions,
): Promise<ConnCipherRow[]> {
  const attempts = Math.max(1, opts.attempts ?? 3)
  const baseDelayMs = opts.baseDelayMs ?? 250
  const sleep = opts.sleep ?? defaultSleep
  let lastError = 'unknown error'
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Retry covers BOTH failure shapes: supabase-js resolving with an { error }
    // object, AND an underlying transport/fetch rejection (a thrown error). Either
    // is a transient inability to run the audit, not a custody violation.
    try {
      const { data, error } = await admin
        .from('connections')
        .select('provider, access_token_enc, refresh_token_enc, api_key_enc')
        .in('provider', ids)
      if (!error) {
        // Surface chronic-but-recovering boot DB instability that would otherwise be
        // invisible (the clean-run log fires whether or not we had to retry).
        if (attempt > 1) console.warn(`[phi-key-audit] connections query recovered on attempt ${attempt}/${attempts} (transient DB error)`)
        return (data || []) as ConnCipherRow[]
      }
      lastError = error.message
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'connections query threw'
    }
    if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1))
  }
  // Durable, best-effort record that the control could NOT run (distinct from a
  // confirmed violation) — never masks the fail-closed throw below.
  await emitAppEvent({
    eventName: 'connector.phi_audit.unavailable',
    category: 'error',
    route: 'lib/connectors/phi-key-audit',
    status: 'query_failed',
    metadata: { attempts, lastError },
  }).catch(() => {})
  throw new Error(`phi-key-audit: connections query failed after ${attempts} attempt(s): ${lastError}`)
}

/**
 * Return every phiGated connection that holds ciphertext, flagging whether the
 * strong env key can open ALL of it. Throws if the connections query cannot
 * complete (after bounded retry) — an audit that cannot run is never "clean."
 */
export async function findPhiConnectorCiphertext(
  admin: SupabaseClient = getAdminClient(), opts: AuditOptions = {},
): Promise<PhiCiphertextFinding[]> {
  const ids = phiProviderIds()
  if (!ids.length) return []

  const rows = await queryPhiConnections(admin, ids, opts)
  const envKeyInForce = isEnvKeyConfigured()
  const findings: PhiCiphertextFinding[] = []
  for (const row of rows) {
    const columns = ENC_COLUMNS.filter((c) => row[c] != null)
    if (!columns.length) continue
    // The ciphertext is acceptable only if the env key opens EVERY populated
    // column (a partial re-seal that left one column DB-sealed is a violation).
    // Only attempt when the env key is in force, otherwise decryptSecret would
    // fall back to the DB key and falsely "confirm" a DB-key-sealed blob.
    let envKeyDecryptable = false
    if (envKeyInForce) {
      envKeyDecryptable = columns.every((c) => {
        try { decryptSecret(row[c] as string); return true } catch { return false }
      })
    }
    findings.push({ provider: row.provider, columns, envKeyDecryptable })
  }
  return findings
}

/**
 * Fail-closed assertion for startup/CI: THROWS if any phiGated connection holds
 * ciphertext that is not provably env-key-sealed (i.e. was sealed under the
 * co-located DB fallback key). Emits a durable audit event on a violation (best
 * effort — never masks the throw). Remediation in docs/PHI-INFRA-CHECKLIST.md §3.
 */
export async function assertNoDbKeySealedPhiCiphertext(
  admin?: SupabaseClient, opts: AuditOptions = {},
): Promise<void> {
  const findings = await findPhiConnectorCiphertext(admin, opts)
  const violations = findings.filter((f) => !f.envKeyDecryptable)
  if (!violations.length) {
    // Positive signal: the control ran and passed. The console line aids local/
    // boot-log triage; the durable best-effort event records each clean run in
    // app_events so a silently-skipped/never-run audit is investigable after the
    // fact (and CAN drive absence-alerting if/when such a monitor is wired — none
    // exists in-repo today). Best-effort — never throws.
    console.info(`[phi-key-audit] passed — ${phiProviderIds().length} PHI provider(s) checked, no DB-key-sealed ciphertext`)
    await emitAppEvent({
      eventName: 'connector.phi_audit.passed',
      category: 'system',
      route: 'lib/connectors/phi-key-audit',
      status: 'passed',
      metadata: { providersChecked: phiProviderIds().length },
    }).catch(() => {})
    return
  }

  const detail = violations
    .map((v) => `${v.provider} (${v.columns.join(', ')})`)
    .join('; ')

  // Durable, compliance-relevant record (provider + column names only — never any
  // ciphertext/plaintext). Best-effort: a telemetry failure must not swallow the
  // fail-closed throw below.
  await emitAppEvent({
    eventName: 'connector.phi_audit.violation',
    category: 'error',
    route: 'lib/connectors/phi-key-audit',
    status: 'fail_closed',
    metadata: {
      providers: violations.map((v) => v.provider),
      findings: violations.map((v) => ({ provider: v.provider, columns: v.columns })),
    },
  }).catch(() => {})

  throw new Error(
    '[phi-key-audit] FAIL CLOSED: PHI-gated connector(s) hold ciphertext NOT sealed ' +
      'under the strong env key (CONNECTOR_ENC_KEY) — it was sealed with the co-located ' +
      `DB fallback key, which predates the PHI key-strength guard: ${detail}. ` +
      'This is a PHI custody violation. Remediate per docs/PHI-INFRA-CHECKLIST.md §3 ' +
      '(scrub + reconnect, or re-seal under the env key) before this server may boot.',
  )
}

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, ensureEncryptionKey } from '@/lib/connectors/crypto'
import { getProvider, providerEnv, phiKeyBlocked, type ProviderDef } from '@/lib/connectors/providers'
import { emitAppEvent } from '@/lib/telemetry/events'

// The sync engine: turns a stored connection into real data in the metrics layer.
// runSync: load connection → decrypt creds (refresh OAuth if stale) → connector
// pull() → normalize → upsert a data_source + replace its metrics → record health.
// Connector impls live in lib/connectors/impl and only describe HOW to pull +
// map a provider; the orchestration here is provider-agnostic + unit-tested.

export type Creds = { apiKey?: string; accessToken?: string }
export type PulledMetric = {
  metric_key: string
  label: string
  value: number
  unit?: string
  period_label?: string
  period_start?: string
}
export type PullCtx = { creds: Creds; nowMs: number; account?: string | null }
export type Connector = {
  id: string
  /** Call the provider API with creds and return normalized metrics. Throw on failure. */
  pull(ctx: PullCtx): Promise<PulledMetric[]>
}

// `skipped` is true ONLY for the benign "another run holds the lock" case — a
// no-op, not a failure. Callers must classify it distinctly from real errors so
// a routine cron/manual overlap doesn't surface as an alert-red sync failure.
export type SyncResult = { ok: boolean; rows?: number; error?: string; skipped?: boolean; empty?: boolean }

type ConnRow = {
  provider: string; status: string; auth_kind: string; external_label: string | null
  api_key_enc: string | null; access_token_enc: string | null; refresh_token_enc: string | null
  token_expires_at: string | null; sync_lock_until?: string | null; sync_lock_token?: string | null
}

// Lease length for the per-provider sync lock. A run that crashes without
// releasing self-heals once this window elapses; sized well above a normal sync
// (connector fetches time out at 20s) so it never expires under a healthy run.
const SYNC_LEASE_MS = 10 * 60_000

/** Decrypt creds for a connection, refreshing an expired OAuth token in place. */
export async function resolveCreds(
  admin: SupabaseClient, conn: ConnRow, provider: ProviderDef, nowMs: number,
): Promise<Creds> {
  if (conn.auth_kind === 'apikey') {
    if (!conn.api_key_enc) throw new Error('no api key stored')
    return { apiKey: decryptSecret(conn.api_key_enc) }
  }
  // OAuth: refresh if expired (with margin) and a refresh token exists.
  const expMs = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0
  const stale = !expMs || expMs - nowMs < 60_000
  if (stale && conn.refresh_token_enc) {
    const refreshed = await refreshOAuth(admin, conn, provider)
    return { accessToken: refreshed }
  }
  if (!conn.access_token_enc) throw new Error('no access token stored')
  return { accessToken: decryptSecret(conn.access_token_enc) }
}

async function refreshOAuth(admin: SupabaseClient, conn: ConnRow, provider: ProviderDef): Promise<string> {
  const { clientId, clientSecret } = providerEnv(provider.id)
  if (!clientId || !clientSecret || !provider.tokenUrl) throw new Error('provider not configured for refresh')
  const refreshToken = decryptSecret(conn.refresh_token_enc!)
  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`token refresh ${res.status}`)
  const t = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!t.access_token) throw new Error('refresh returned no access token')
  await admin.from('connections').update({
    access_token_enc: encryptSecret(t.access_token),
    refresh_token_enc: t.refresh_token ? encryptSecret(t.refresh_token) : conn.refresh_token_enc,
    token_expires_at: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  }).eq('provider', conn.provider)
  return t.access_token
}

/** Coerce a period_start to a strict ISO calendar date (YYYY-MM-DD) or null.
 * The metrics column is `date`; a free-form connector string (e.g. 'Q1 2026')
 * would otherwise throw inside the swap and wedge the whole source. */
function toIsoDate(v?: string): string | null {
  if (!v) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}

/** Map pulled metrics to metric rows for a source, deduped by (metric_key, period)
 * so one pull can't double-count. Pure. */
export function toMetricRows(pulled: PulledMetric[], sourceId: string) {
  const byKey = new Map<string, Record<string, unknown>>()
  for (const m of pulled) {
    if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value) || !m.metric_key) continue
    byKey.set(`${m.metric_key}|${m.period_label || ''}`, {
      source_id: sourceId,
      metric_key: m.metric_key,
      label: m.label || m.metric_key,
      value: m.value,
      unit: m.unit || 'count',
      period_label: m.period_label || null,
      period_start: toIsoDate(m.period_start),
      dimension: {},
    })
  }
  return [...byKey.values()]
}

/**
 * Run a sync for one provider. Returns a SyncResult; records last_sync_at/last_error
 * on the connection either way. Never throws.
 */
export async function runSync(
  admin: SupabaseClient, providerId: string, connectors: Record<string, Connector>, nowMs: number,
): Promise<SyncResult> {
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, error: 'unknown provider' }
  // A sync can re-seal rotated OAuth tokens (refreshOAuth). For a PHI provider that
  // must use the strong env key — refuse rather than re-seal PHI with the DB key.
  // This path is headless (cron/admin sync), so audit the refusal: it's the only
  // signal an operator gets that the PHI gate is open but misconfigured.
  if (phiKeyBlocked(providerId)) {
    void emitAppEvent({ eventName: 'connector.phi_key.blocked', category: 'error', route: 'lib/connectors/sync', status: 'blocked', metadata: { provider: providerId, surface: 'sync' } }).catch(() => {})
    return { ok: false, error: 'PHI connector requires CONNECTOR_ENC_KEY (the DB fallback key is not PHI-grade)' }
  }
  const connector = connectors[providerId]
  if (!connector) return { ok: false, error: 'no connector implemented yet' }

  const { data: conn } = await admin.from('connections').select('*').eq('provider', providerId).maybeSingle()
  if (!conn || conn.status !== 'connected') return { ok: false, error: 'not connected' }

  // Serialize per provider: claim the lock with a conditional UPDATE that only
  // matches when no live lease is held (null or expired). Postgres evaluates the
  // WHERE under a row lock, so of two concurrent claims exactly one updates a row
  // — the loser gets zero rows back and skips, making a cron/manual overlap a
  // no-op instead of a double metrics swap. A per-run token tags the lease so the
  // finally release can verify ownership (a run whose lease expired mid-flight
  // must not null a newer run's live lock). Released in the finally below.
  const nowIso = new Date(nowMs).toISOString()
  const token = crypto.randomUUID()
  const { data: claimed, error: claimErr } = await admin.from('connections')
    .update({ sync_lock_until: new Date(nowMs + SYNC_LEASE_MS).toISOString(), sync_lock_token: token })
    .eq('provider', providerId)
    .or(`sync_lock_until.is.null,sync_lock_until.lt."${nowIso}"`)
    .select('id')
  if (claimErr) {
    // A claim UPDATE error is a real DB fault (e.g. the sync_lock columns/migration
    // missing) — not a benign skip. Record it so a wedged provider is visible on the
    // connection badge instead of silently no-op'ing every sync.
    const msg = `could not acquire sync lock: ${(claimErr as { code?: string }).code || ''} ${(claimErr as { message?: string }).message || ''}`.trim()
    await admin.from('connections').update({ status: 'error', last_error: msg.slice(0, 300), updated_at: nowIso }).eq('provider', providerId).then(() => {}, () => {})
    return { ok: false, error: msg }
  }
  if (!claimed || claimed.length === 0) return { ok: false, skipped: true, error: 'sync already running' }

  try {
    if (!(await ensureEncryptionKey())) throw new Error('encryption key unavailable — retry')
    const creds = await resolveCreds(admin, conn as ConnRow, provider, nowMs)
    const pulled = await connector.pull({ creds, nowMs, account: (conn as ConnRow).external_label })

    // One data_source per connection. Do NOT stamp last_imported_at on the upsert —
    // it must reflect when data actually MOVED, not merely when a pull completed; an
    // empty pull that advanced it would mask a silently-broken connector from the
    // freshness alarm. Stamped below only after a real (non-empty) swap.
    const slug = `conn-${providerId}`
    const { data: src } = await admin.from('data_sources')
      .upsert({ name: provider.name, slug, kind: 'system' }, { onConflict: 'slug' })
      .select('id').maybeSingle()
    if (!src) throw new Error('could not resolve data source')

    const rows = toMetricRows(pulled, src.id)
    // Atomic swap: delete the source's old metrics and insert the fresh set in ONE
    // transaction (replace_source_metrics RPC). A failure rolls both back, so the
    // source is never two live sets (no double-count) and never momentarily empty
    // (no blank-dashboard window). An empty pull leaves data (and last_imported_at)
    // as-is.
    if (rows.length) {
      const { error: swapErr } = await admin.rpc('replace_source_metrics', { p_source_id: src.id, p_rows: rows })
      // Carry the DB SQLSTATE + message so last_error/telemetry can tell a retryable
      // timeout (57014) from a poison-pill data error (22xxx/23xxx) at 2am.
      if (swapErr) throw new Error(`metrics swap failed (${rows.length} rows): ${(swapErr as { code?: string }).code || ''} ${(swapErr as { message?: string }).message || swapErr}`.trim())
      await admin.from('data_sources').update({ last_imported_at: new Date(nowMs).toISOString() }).eq('id', src.id)
    }
    await admin.from('connections').update({ last_sync_at: new Date(nowMs).toISOString(), last_error: null, status: 'connected' }).eq('provider', providerId)
    // rows:0 is a successful-but-empty pull — a distinct, watchable signal (the
    // connector authenticated but returned nothing). Callers/telemetry surface it.
    return { ok: true, rows: rows.length, empty: rows.length === 0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed'
    // Mark the connection unhealthy so the UI badge reflects sync failure, not just connect state.
    await admin.from('connections').update({ status: 'error', last_error: msg.slice(0, 300), updated_at: new Date(nowMs).toISOString() }).eq('provider', providerId).then(() => {}, () => {})
    return { ok: false, error: msg }
  } finally {
    // Release the lock no matter the outcome so the next tick can run — but only
    // if we still own it (token match). If our lease already expired and another
    // run re-claimed, this matches zero rows and leaves their lock intact. Best-
    // effort: if this update fails the lease still expires on its own.
    await admin.from('connections').update({ sync_lock_until: null, sync_lock_token: null })
      .eq('provider', providerId).eq('sync_lock_token', token).then(() => {}, () => {})
  }
}

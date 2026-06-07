import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret } from '@/lib/connectors/crypto'
import { getProvider, providerEnv, type ProviderDef } from '@/lib/connectors/providers'

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

export type SyncResult = { ok: boolean; rows?: number; error?: string }

type ConnRow = {
  provider: string; status: string; auth_kind: string; external_label: string | null
  api_key_enc: string | null; access_token_enc: string | null; refresh_token_enc: string | null
  token_expires_at: string | null
}

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
      period_start: m.period_start || null,
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
  const connector = connectors[providerId]
  if (!connector) return { ok: false, error: 'no connector implemented yet' }

  const { data: conn } = await admin.from('connections').select('*').eq('provider', providerId).maybeSingle()
  if (!conn || conn.status !== 'connected') return { ok: false, error: 'not connected' }

  try {
    const creds = await resolveCreds(admin, conn as ConnRow, provider, nowMs)
    const pulled = await connector.pull({ creds, nowMs, account: (conn as ConnRow).external_label })

    // One data_source per connection; replace its metrics so the figures are current.
    const slug = `conn-${providerId}`
    const { data: src } = await admin.from('data_sources')
      .upsert({ name: provider.name, slug, kind: 'system', last_imported_at: new Date(nowMs).toISOString() }, { onConflict: 'slug' })
      .select('id').maybeSingle()
    if (!src) throw new Error('could not resolve data source')

    const rows = toMetricRows(pulled, src.id)
    // Non-destructive swap: capture the existing rows, insert the new set, and only
    // THEN prune the old ones. A failed pull/insert therefore never empties the
    // source's metrics (no blank-dashboard window). An empty pull leaves data as-is.
    if (rows.length) {
      const { data: old } = await admin.from('metrics').select('id').eq('source_id', src.id)
      const oldIds = (old || []).map((o: { id: string }) => o.id)
      const ins = await admin.from('metrics').insert(rows)
      if (ins.error) throw new Error('metrics insert failed')
      if (oldIds.length) await admin.from('metrics').delete().in('id', oldIds)
    }
    await admin.from('connections').update({ last_sync_at: new Date(nowMs).toISOString(), last_error: null, status: 'connected' }).eq('provider', providerId)
    return { ok: true, rows: rows.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed'
    // Mark the connection unhealthy so the UI badge reflects sync failure, not just connect state.
    await admin.from('connections').update({ status: 'error', last_error: msg.slice(0, 300), updated_at: new Date(nowMs).toISOString() }).eq('provider', providerId).then(() => {}, () => {})
    return { ok: false, error: msg }
  }
}

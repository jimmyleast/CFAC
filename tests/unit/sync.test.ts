import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { toMetricRows, runSync, type Connector } from '@/lib/connectors/sync'
import { encryptSecret } from '@/lib/connectors/crypto'
import { CONNECTORS } from '@/lib/connectors/impl'

beforeEach(() => { process.env.CONNECTOR_ENC_KEY = crypto.randomBytes(32).toString('base64') })

describe('toMetricRows', () => {
  it('maps + drops non-finite values', () => {
    const rows = toMetricRows([
      { metric_key: 'a', label: 'A', value: 5, unit: 'usd', period_label: '2026' },
      { metric_key: 'b', label: 'B', value: NaN },
      { metric_key: '', label: 'C', value: 1 },
    ], 'src1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_id: 'src1', metric_key: 'a', value: 5, unit: 'usd', period_label: '2026' })
  })
})

// Chainable admin mock for runSync. `track.pruned` flips true if old metrics were deleted.
function adminMock({ conn, srcId, insertError, track }: { conn: unknown; srcId?: string; insertError?: unknown; track?: { pruned?: boolean } }) {
  const thenableEq = { eq: () => ({ then: (r: (v: unknown) => void) => r({ data: null, error: null }) }) }
  return {
    from: (table: string) => {
      if (table === 'connections') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conn }) }) }),
        update: () => thenableEq,
      }
      if (table === 'data_sources') return {
        upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: srcId ? { id: srcId } : null }) }) }),
      }
      if (table === 'metrics') return {
        select: () => ({ eq: async () => ({ data: [{ id: 'old1' }, { id: 'old2' }] }) }), // existing rows
        insert: async () => ({ error: insertError || null }),
        delete: () => ({ in: async () => { if (track) track.pruned = true; return {} } }),
      }
      return {}
    },
  } as never
}

const okConnector: Connector = { id: 'bloomerang', pull: async () => [{ metric_key: 'x', label: 'X', value: 5, period_label: '2026' }] }

describe('runSync', () => {
  it('errors for an unknown provider', async () => {
    expect((await runSync(adminMock({ conn: null }), 'nope', { nope: okConnector }, Date.now())).error).toMatch(/unknown/)
  })

  it('errors when no connector is implemented yet', async () => {
    const r = await runSync(adminMock({ conn: { status: 'connected' } }), 'qgiv', {}, Date.now())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/no connector/)
  })

  it('errors when the connection is not connected', async () => {
    const r = await runSync(adminMock({ conn: { provider: 'bloomerang', status: 'disconnected' } }), 'bloomerang', { bloomerang: okConnector }, Date.now())
    expect(r.error).toMatch(/not connected/)
  })

  it('pulls, normalizes, inserts new THEN prunes old (non-destructive swap)', async () => {
    const track: { pruned?: boolean } = {}
    const conn = { provider: 'bloomerang', status: 'connected', auth_kind: 'apikey', api_key_enc: encryptSecret('secret-key'), access_token_enc: null, refresh_token_enc: null, token_expires_at: null }
    const r = await runSync(adminMock({ conn, srcId: 'src1', track }), 'bloomerang', { bloomerang: okConnector }, Date.now())
    expect(r.ok).toBe(true)
    expect(r.rows).toBe(1)
    expect(track.pruned).toBe(true) // old rows pruned only after a successful insert
  })

  it('BLOCKER-fix: a failed insert does NOT prune old metrics (no data loss)', async () => {
    const track: { pruned?: boolean } = {}
    const conn = { provider: 'bloomerang', status: 'connected', auth_kind: 'apikey', api_key_enc: encryptSecret('k'), token_expires_at: null }
    const r = await runSync(adminMock({ conn, srcId: 'src1', insertError: { message: 'db down' }, track }), 'bloomerang', { bloomerang: okConnector }, Date.now())
    expect(r.ok).toBe(false)
    expect(track.pruned).toBeUndefined() // old metrics preserved
  })

  it('records an error (never throws) when the connector pull fails', async () => {
    const conn = { provider: 'bloomerang', status: 'connected', auth_kind: 'apikey', api_key_enc: encryptSecret('k'), token_expires_at: null }
    const failing: Connector = { id: 'bloomerang', pull: async () => { throw new Error('api 500') } }
    const r = await runSync(adminMock({ conn, srcId: 'src1' }), 'bloomerang', { bloomerang: failing }, Date.now())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/api 500/)
  })
})

describe('resolveCreds — OAuth refresh', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.QBO_CLIENT_ID; delete process.env.QBO_CLIENT_SECRET })

  it('refreshes a stale OAuth token and re-encrypts the new one', async () => {
    process.env.QBO_CLIENT_ID = 'cid'; process.env.QBO_CLIENT_SECRET = 'sec'
    let stored: Record<string, unknown> | null = null
    const admin = {
      from: () => ({ update: (row: Record<string, unknown>) => ({ eq: async () => { stored = row; return {} } }) }),
    } as never
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'fresh-token', refresh_token: 'new-refresh', expires_in: 3600 }) })) as never
    const { resolveCreds } = await import('@/lib/connectors/sync')
    const { getProvider } = await import('@/lib/connectors/providers')
    const conn = { provider: 'quickbooks', status: 'connected', auth_kind: 'oauth2', api_key_enc: null, access_token_enc: null, refresh_token_enc: encryptSecret('old-refresh'), token_expires_at: new Date(Date.now() - 10_000).toISOString() }
    const creds = await resolveCreds(admin, conn as never, getProvider('quickbooks')!, Date.now())
    expect(creds.accessToken).toBe('fresh-token')
    expect(stored).not.toBeNull()
    expect(typeof (stored as Record<string, unknown>).access_token_enc).toBe('string') // re-encrypted, not plaintext
  })
})

describe('toMetricRows defaults + dedup', () => {
  it('defaults unit to count and dedups by key+period (last wins)', async () => {
    const rows = toMetricRows([
      { metric_key: 'd', label: 'D', value: 1, period_label: '2026' },
      { metric_key: 'd', label: 'D', value: 9, period_label: '2026' },
    ], 's')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ value: 9, unit: 'count', period_start: null })
  })
})

describe('Bloomerang connector', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('maps constituents + donations totals to metrics', async () => {
    globalThis.fetch = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => ({ Total: String(url).includes('constituents') ? 1200 : 87 }),
    })) as never
    const out = await CONNECTORS.bloomerang.pull({ creds: { apiKey: 'k' }, nowMs: new Date('2026-01-01').getTime() })
    expect(out.find((m) => m.metric_key === 'bloomerang_constituents')?.value).toBe(1200)
    expect(out.find((m) => m.metric_key === 'bloomerang_donations')?.value).toBe(87)
  })

  it('throws a clear error on auth rejection', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as never
    await expect(CONNECTORS.bloomerang.pull({ creds: { apiKey: 'bad' }, nowMs: Date.now() })).rejects.toThrow(/rejected the API key/)
  })
})

describe('additional provider connectors', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const now = new Date('2026-01-01').getTime()
  // Respond based on URL substring.
  const fetchBy = (map: Record<string, unknown>) => vi.fn(async (url: string) => {
    const key = Object.keys(map).find((k) => String(url).includes(k))
    return { ok: true, status: 200, json: async () => (key ? map[key] : {}) }
  }) as never

  it('qgiv maps a donations total', async () => {
    globalThis.fetch = fetchBy({ 'qgiv.com': { total: 500 } })
    const out = await CONNECTORS.qgiv.pull({ creds: { apiKey: 'k' }, nowMs: now })
    expect(out[0]).toMatchObject({ metric_key: 'qgiv_donations', value: 500 })
  })

  it('quickbooks requires a realm id, then maps invoice count', async () => {
    await expect(CONNECTORS.quickbooks.pull({ creds: { accessToken: 't' }, account: null, nowMs: now })).rejects.toThrow(/realm/)
    globalThis.fetch = fetchBy({ 'quickbooks.api.intuit.com': { QueryResponse: { totalCount: 42 } } })
    const out = await CONNECTORS.quickbooks.pull({ creds: { accessToken: 't' }, account: 'realm1', nowMs: now })
    expect(out[0]).toMatchObject({ metric_key: 'quickbooks_invoices', value: 42 })
  })

  it('asana maps workspaces + projects', async () => {
    globalThis.fetch = fetchBy({ 'users/me': { data: { workspaces: [{ gid: 'w1' }] } }, 'projects?workspace': { data: [{}, {}] } })
    const out = await CONNECTORS.asana.pull({ creds: { accessToken: 't' }, nowMs: now })
    expect(out.find((m) => m.metric_key === 'asana_workspaces')?.value).toBe(1)
    expect(out.find((m) => m.metric_key === 'asana_projects')?.value).toBe(2)
  })

  it('docusign resolves account then maps envelope total', async () => {
    globalThis.fetch = fetchBy({ 'oauth/userinfo': { accounts: [{ base_uri: 'https://na.docusign.net', account_id: 'acc1' }] }, 'envelopes': { totalSetSize: 12 } })
    const out = await CONNECTORS.docusign.pull({ creds: { accessToken: 't' }, nowMs: now })
    expect(out[0]).toMatchObject({ metric_key: 'docusign_envelopes', value: 12 })
  })

  it('qualtrics requires a datacenter, then maps survey count', async () => {
    await expect(CONNECTORS.qualtrics.pull({ creds: { apiKey: 'k' }, account: null, nowMs: now })).rejects.toThrow(/datacenter/)
    globalThis.fetch = fetchBy({ 'qualtrics.com': { result: { elements: [{}, {}, {}] } } })
    const out = await CONNECTORS.qualtrics.pull({ creds: { apiKey: 'k' }, account: 'iad1', nowMs: now })
    expect(out[0]).toMatchObject({ metric_key: 'qualtrics_surveys', value: 3 })
  })

  it('qualtrics rejects a malicious datacenter label (SSRF guard) without fetching', async () => {
    const spy = vi.fn()
    globalThis.fetch = spy as never
    await expect(CONNECTORS.qualtrics.pull({ creds: { apiKey: 'k' }, account: 'evil.com/x', nowMs: now })).rejects.toThrow(/invalid Qualtrics datacenter/)
    expect(spy).not.toHaveBeenCalled()
  })
})

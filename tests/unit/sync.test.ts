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

// Chainable admin mock for runSync. `track.pruned` flips true if old metrics were
// deleted. `claimHeld` simulates the per-provider sync lock already being held
// (claim returns zero rows). `claimErr` simulates a DB error on the claim UPDATE.
// Default: the claim succeeds.
function adminMock({ conn, srcId, insertError, track, claimHeld, claimErr }: { conn: unknown; srcId?: string; insertError?: unknown; track?: { pruned?: boolean }; claimHeld?: boolean; claimErr?: unknown }) {
  // update().eq() serves the claim (.or().select('id')), the plain status writes
  // (await / .then() after one .eq), and the ownership-checked release (a second
  // .eq('sync_lock_token') then .then()). The eq node is reusable + thenable.
  const eqNode: Record<string, unknown> = {
    or: () => ({ select: async () => ({ data: claimHeld ? [] : [{ id: 'conn1' }], error: claimErr || null }) }),
    eq: () => ({ then: (r: (v: unknown) => void) => r({ data: null, error: null }) }),
    then: (r: (v: unknown) => void) => r({ data: null, error: null }),
  }
  return {
    from: (table: string) => {
      if (table === 'connections') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: conn }) }) }),
        update: () => ({ eq: () => eqNode }),
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

  it('skips (skipped:true) with "sync already running" when the per-provider lock is held', async () => {
    const conn = { provider: 'bloomerang', status: 'connected', auth_kind: 'apikey', api_key_enc: encryptSecret('k'), token_expires_at: null }
    const r = await runSync(adminMock({ conn, srcId: 'src1', claimHeld: true }), 'bloomerang', { bloomerang: okConnector }, Date.now())
    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(true) // benign no-op, NOT a failure — callers must not alert on it
    expect(r.error).toMatch(/already running/)
  })

  it('returns a (non-skip) error when the lock claim UPDATE itself fails', async () => {
    const conn = { provider: 'bloomerang', status: 'connected', auth_kind: 'apikey', api_key_enc: encryptSecret('k'), token_expires_at: null }
    const r = await runSync(adminMock({ conn, srcId: 'src1', claimErr: { message: 'db down' } }), 'bloomerang', { bloomerang: okConnector }, Date.now())
    expect(r.ok).toBe(false)
    expect(r.skipped).toBeUndefined() // a real DB fault, not a benign skip
    expect(r.error).toMatch(/could not acquire sync lock/)
  })
})

// Shared in-memory store backing a single connections row + a metrics table,
// honoring the lock claim's conditional UPDATE atomically (read-check-set runs
// synchronously, so two concurrent runSync coroutines can't both claim) AND the
// ownership-checked release (.eq('sync_lock_token') gates the null-out). Used to
// prove overlapping runs don't double the metric set and the lock is released.
// `track.lastOr` captures the most recent claim filter string for format checks.
function sharedStoreAdmin(store: { conn: Record<string, unknown>; metrics: { id: string; source_id: string }[]; seq: number }, track?: { lastOr?: string }) {
  const claimable = (orStr: string) => {
    const lock = store.conn.sync_lock_until as string | null
    if (!lock) return true
    const m = /lt\."([^"]+)"/.exec(orStr) // threshold = caller's "now"
    return m ? Date.parse(lock) < Date.parse(m[1]) : false
  }
  return {
    from: (table: string) => {
      if (table === 'connections') return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: store.conn }) }) }),
        update: (payload: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {}
          const node = {
            eq: (col: string, val: unknown) => { filters[col] = val; return node },
            // Atomic claim: synchronously check the lease and set it if free.
            or: (orStr: string) => { if (track) track.lastOr = orStr; return { select: async () => {
              if (!claimable(orStr)) return { data: [], error: null }
              Object.assign(store.conn, payload) // sets sync_lock_until + sync_lock_token
              return { data: [{ id: 'conn1' }], error: null }
            } } },
            // status / release writes. The release carries an ownership filter on
            // sync_lock_token — apply the payload only if this run still owns the lock.
            then: (r: (v: unknown) => void) => {
              const owns = !('sync_lock_token' in filters) || store.conn.sync_lock_token === filters.sync_lock_token
              if (owns) Object.assign(store.conn, payload)
              r({ data: null, error: null })
            },
          }
          return { eq: node.eq }
        },
      }
      if (table === 'data_sources') return {
        upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'src1' } }) }) }),
      }
      if (table === 'metrics') return {
        select: () => ({ eq: async () => ({ data: store.metrics.filter((m) => m.source_id === 'src1').map((m) => ({ id: m.id })) }) }),
        insert: async (rows: { source_id: string }[]) => { for (const row of rows) store.metrics.push({ ...row, id: `m${store.seq++}` } as { id: string; source_id: string }); return { error: null } },
        delete: () => ({ in: async (_c: string, ids: string[]) => { store.metrics = store.metrics.filter((m) => !ids.includes(m.id)); return {} } }),
      }
      return {}
    },
  } as never
}

// One pull = 2 distinct metrics, so "one pull's worth" (2) is unmistakable from
// "two overlapping runs" (4).
const twoMetric: Connector = { id: 'bloomerang', pull: async () => [
  { metric_key: 'a', label: 'A', value: 1, period_label: '2026' },
  { metric_key: 'b', label: 'B', value: 2, period_label: '2026' },
] }
const makeStore = (lockUntil: string | null = null) => ({
  conn: { provider: 'bloomerang', status: 'connected', auth_kind: 'apikey', api_key_enc: encryptSecret('k'), token_expires_at: null, sync_lock_until: lockUntil, sync_lock_token: lockUntil ? 'held-by-other' : null } as Record<string, unknown>,
  metrics: [] as { id: string; source_id: string }[],
  seq: 1,
})

describe('runSync — concurrency guard', () => {
  it('two overlapping runs do not double the metric set; the loser skips', async () => {
    const store = makeStore()
    const admin = sharedStoreAdmin(store)
    const now = Date.now()

    // Fire both at the same simulated instant against the shared store.
    const [r1, r2] = await Promise.all([
      runSync(admin, 'bloomerang', { bloomerang: twoMetric }, now),
      runSync(admin, 'bloomerang', { bloomerang: twoMetric }, now),
    ])

    const winner = [r1, r2].filter((r) => r.ok)
    const skipped = [r1, r2].filter((r) => !r.ok)
    expect(winner).toHaveLength(1)          // exactly one run did the swap
    expect(winner[0].rows).toBe(2)
    expect(skipped).toHaveLength(1)          // the other observed the lock
    expect(skipped[0].skipped).toBe(true)
    expect(skipped[0].error).toMatch(/already running/)
    expect(store.metrics).toHaveLength(2)    // one pull's worth, NOT 4
    expect(store.conn.sync_lock_until).toBeNull()  // released in finally
    expect(store.conn.sync_lock_token).toBeNull()  // token cleared too
  })

  it('releases the lock even when the run fails (no wedged provider)', async () => {
    const store = makeStore()
    const failing: Connector = { id: 'bloomerang', pull: async () => { throw new Error('api 500') } }
    const r = await runSync(sharedStoreAdmin(store), 'bloomerang', { bloomerang: failing }, Date.now())
    expect(r.ok).toBe(false)
    expect(r.skipped).toBeUndefined()              // a real failure, not a skip
    expect(store.conn.sync_lock_until).toBeNull()  // finally released despite the throw
    expect(store.conn.sync_lock_token).toBeNull()
  })

  it('reclaims an expired lease (crashed prior run self-heals)', async () => {
    const past = new Date(Date.now() - 60_000).toISOString() // lease already elapsed
    const store = makeStore(past)
    const r = await runSync(sharedStoreAdmin(store), 'bloomerang', { bloomerang: twoMetric }, Date.now())
    expect(r.ok).toBe(true)                  // stale lock did not block the run
    expect(store.metrics).toHaveLength(2)
  })

  it('skips when a live (unexpired) lease is held', async () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString() // lease still valid
    const store = makeStore(future)
    const r = await runSync(sharedStoreAdmin(store), 'bloomerang', { bloomerang: twoMetric }, Date.now())
    expect(r.ok).toBe(false)
    expect(r.skipped).toBe(true)
    expect(store.metrics).toHaveLength(0)    // no swap happened
    expect(store.conn.sync_lock_token).toBe('held-by-other') // other run's lock untouched
  })

  it('claim filter quotes the timestamp so PostgREST parses it (is.null OR lt."<iso>")', async () => {
    const track: { lastOr?: string } = {}
    const store = makeStore()
    const now = Date.parse('2026-06-07T07:00:00.000Z')
    await runSync(sharedStoreAdmin(store, track), 'bloomerang', { bloomerang: twoMetric }, now)
    // Pin the exact format: the ISO value (containing '.' and ':') MUST be double-
    // quoted or PostgREST would mis-split it on the '.' in the milliseconds.
    expect(track.lastOr).toBe('sync_lock_until.is.null,sync_lock_until.lt."2026-06-07T07:00:00.000Z"')
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

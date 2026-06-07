import type { Connector, PulledMetric } from '@/lib/connectors/sync'

// Per-provider connector implementations. Each describes HOW to call the provider
// API and map the response to normalized metrics. Endpoints/shapes are written to
// the published API docs and verified live when the first real credential lands
// (the sync engine records a clear last_error if a shape/endpoint needs a tweak).
// Adding a provider = add a Connector here + register it in CONNECTORS.

const TIMEOUT = 20_000

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) })
  let body: any = null
  try { body = await res.json() } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, body }
}

// --- Bloomerang (donor CRM) — API key via X-API-KEY header. ---
const bloomerang: Connector = {
  id: 'bloomerang',
  async pull({ creds, nowMs }) {
    const key = creds.apiKey
    if (!key) throw new Error('missing API key')
    const headers = { 'X-API-KEY': key }
    const year = String(new Date(nowMs).getUTCFullYear())
    const out: PulledMetric[] = []

    const c = await getJson('https://api.bloomerang.co/v2/constituents?take=1', headers)
    if (c.status === 401 || c.status === 403) throw new Error('Bloomerang rejected the API key')
    if (c.ok && typeof c.body?.Total === 'number') {
      out.push({ metric_key: 'bloomerang_constituents', label: 'Constituents (Bloomerang)', value: c.body.Total, period_label: year })
    }

    const t = await getJson('https://api.bloomerang.co/v2/transactions?type=Donation&take=1', headers)
    if (t.ok && typeof t.body?.Total === 'number') {
      out.push({ metric_key: 'bloomerang_donations', label: 'Donations (Bloomerang)', value: t.body.Total, period_label: year })
    }

    if (!out.length) throw new Error('Bloomerang returned no usable data — endpoint/shape needs verification with a live key')
    return out
  },
}

export const CONNECTORS: Record<string, Connector> = {
  bloomerang,
  // qgiv, quickbooks, asana, … added + verified as each credential/BAA lands.
}

/** Providers that have a working data-pull connector today. */
export function hasConnector(providerId: string): boolean {
  return Boolean(CONNECTORS[providerId])
}

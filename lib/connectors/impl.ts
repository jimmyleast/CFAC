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

const VERIFY = (name: string, endpoint: string, status: number) =>
  new Error(`${name} connector reached but needs live verification (tried ${endpoint}, got HTTP ${status}). Adjust the endpoint/mapping once a real key is connected.`)

// --- Qgiv / Text2Give (donations) — API token. ---
const qgiv: Connector = {
  id: 'qgiv',
  async pull({ creds, nowMs }) {
    const token = creds.apiKey
    if (!token) throw new Error('missing API token')
    const year = String(new Date(nowMs).getUTCFullYear())
    const url = 'https://api.qgiv.com/v1/donations/'
    const r = await getJson(url, { Authorization: `Bearer ${token}` })
    if (r.status === 401 || r.status === 403) throw new Error('Qgiv rejected the API token')
    const total = r.body?.total ?? r.body?.count ?? (Array.isArray(r.body?.donations) ? r.body.donations.length : undefined)
    if (r.ok && typeof total === 'number') return [{ metric_key: 'qgiv_donations', label: 'Donations (Qgiv)', value: total, period_label: year }]
    throw VERIFY('Qgiv', url, r.status)
  },
}

// --- QuickBooks Online (finance) — OAuth bearer + realm/company id (stored as account). ---
const quickbooks: Connector = {
  id: 'quickbooks',
  async pull({ creds, account, nowMs }) {
    const token = creds.accessToken
    if (!token) throw new Error('missing access token')
    if (!account) throw new Error('QuickBooks company/realm id not captured — reconnect QuickBooks')
    const year = String(new Date(nowMs).getUTCFullYear())
    const url = `https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(account)}/query?query=${encodeURIComponent('SELECT COUNT(*) FROM Invoice')}&minorversion=70`
    const r = await getJson(url, { Authorization: `Bearer ${token}` })
    if (r.status === 401 || r.status === 403) throw new Error('QuickBooks rejected the token')
    const count = r.body?.QueryResponse?.totalCount
    if (r.ok && typeof count === 'number') return [{ metric_key: 'quickbooks_invoices', label: 'Invoices (QuickBooks)', value: count, period_label: year }]
    throw VERIFY('QuickBooks', url, r.status)
  },
}

// --- Asana (project management) — Personal Access Token (or OAuth bearer). ---
const asana: Connector = {
  id: 'asana',
  async pull({ creds, nowMs }) {
    const token = creds.apiKey || creds.accessToken
    if (!token) throw new Error('missing access token')
    const year = String(new Date(nowMs).getUTCFullYear())
    const url = 'https://app.asana.com/api/1.0/users/me'
    const r = await getJson(url, { Authorization: `Bearer ${token}` })
    if (r.status === 401 || r.status === 403) throw new Error('Asana rejected the token')
    const workspaces = r.body?.data?.workspaces
    if (r.ok && Array.isArray(workspaces)) {
      const out: PulledMetric[] = [{ metric_key: 'asana_workspaces', label: 'Workspaces (Asana)', value: workspaces.length, period_label: year }]
      const wid = workspaces[0]?.gid
      if (wid) {
        const p = await getJson(`https://app.asana.com/api/1.0/projects?workspace=${encodeURIComponent(wid)}&limit=100&opt_fields=gid`, { Authorization: `Bearer ${token}` })
        if (p.ok && Array.isArray(p.body?.data)) out.push({ metric_key: 'asana_projects', label: 'Projects (Asana)', value: p.body.data.length, period_label: year })
      }
      return out
    }
    throw VERIFY('Asana', url, r.status)
  },
}

// --- DocuSign (e-sign / intake) — OAuth bearer. PHI-gated. ---
const docusign: Connector = {
  id: 'docusign',
  async pull({ creds, nowMs }) {
    const token = creds.accessToken
    if (!token) throw new Error('missing access token')
    const year = String(new Date(nowMs).getUTCFullYear())
    const info = await getJson('https://account.docusign.com/oauth/userinfo', { Authorization: `Bearer ${token}` })
    if (info.status === 401 || info.status === 403) throw new Error('DocuSign rejected the token')
    const acct = info.body?.accounts?.[0]
    if (!info.ok || !acct?.base_uri || !acct?.account_id) throw VERIFY('DocuSign', 'oauth/userinfo', info.status)
    // The base_uri is response-controlled; only follow a genuine DocuSign host (SSRF guard).
    if (!/^https:\/\/[a-z0-9.-]+\.docusign\.(net|com)$/i.test(acct.base_uri)) throw new Error('unexpected DocuSign base_uri')
    const url = `${acct.base_uri}/restapi/v2.1/accounts/${acct.account_id}/envelopes?from_date=${year}-01-01&count=1`
    const e = await getJson(url, { Authorization: `Bearer ${token}` })
    const total = e.body?.totalSetSize ?? e.body?.resultSetSize
    if (e.ok && total !== undefined && Number.isFinite(Number(total))) return [{ metric_key: 'docusign_envelopes', label: 'Envelopes (DocuSign)', value: Number(total), period_label: year }]
    throw VERIFY('DocuSign', url, e.status)
  },
}

// --- Qualtrics (OMS) — API token + datacenter. PHI-gated. ---
const qualtrics: Connector = {
  id: 'qualtrics',
  async pull({ creds, account, nowMs }) {
    const token = creds.apiKey
    if (!token) throw new Error('missing API token')
    const dc = account || process.env.QUALTRICS_DATACENTER
    if (!dc) throw new Error('Qualtrics datacenter not set — store it as the account label (e.g. "iad1")')
    // Datacenters are short alphanumerics (iad1, fra1). Reject anything else so the
    // label can't redirect where the API token is sent (host injection / SSRF).
    if (!/^[a-z0-9]{2,20}$/i.test(dc)) throw new Error('invalid Qualtrics datacenter')
    const year = String(new Date(nowMs).getUTCFullYear())
    const url = `https://${encodeURIComponent(dc)}.qualtrics.com/API/v3/surveys`
    const r = await getJson(url, { 'X-API-TOKEN': token })
    if (r.status === 401 || r.status === 403) throw new Error('Qualtrics rejected the API token')
    const elements = r.body?.result?.elements
    if (r.ok && Array.isArray(elements)) return [{ metric_key: 'qualtrics_surveys', label: 'Surveys (Qualtrics)', value: elements.length, period_label: year }]
    throw VERIFY('Qualtrics', url, r.status)
  },
}

export const CONNECTORS: Record<string, Connector> = {
  bloomerang, qgiv, quickbooks, asana, docusign, qualtrics,
}

/** Providers that have a working data-pull connector today. */
export function hasConnector(providerId: string): boolean {
  return Boolean(CONNECTORS[providerId])
}

// Provider registry — drives the connect-button UI and the OAuth/API-key flows.
// Adding a provider = adding an entry here + its env vars (no route changes).

export type AuthKind = 'oauth2' | 'apikey'
export type BaaStatus = 'yes' | 'no' | 'unknown'

export type ProviderDef = {
  id: string
  name: string
  authKind: AuthKind
  phiAllowed: boolean
  baa: BaaStatus
  // phiGated: minting a long-lived token here would custody a standing KEY to PHI
  // (e.g. M365 offline_access → the intake mailbox / all files). Such providers
  // stay blocked until the PHI infra gate is satisfied (Supabase HIPAA add-on +
  // PHI workers off bare Railway + BAAs — see INTEGRATION-ARCHITECTURE.md §5).
  phiGated?: boolean
  description: string
  scopes: string[]
  // oauth2 endpoint builders (tenant interpolated for Microsoft)
  authUrl?: string
  tokenUrl?: string
  extraAuthParams?: Record<string, string>
}

/** PHI infra prerequisites met (Supabase HIPAA add-on + BAA + PHI worker host). */
export function isPhiGateReady(): boolean {
  return process.env.PHI_GATE_READY === 'true'
}

function msAuthority(): string {
  const tenant = process.env.MS_TENANT_ID || 'common'
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`
}

export const PROVIDERS: Record<string, ProviderDef> = {
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft 365',
    authKind: 'oauth2',
    phiAllowed: true,
    baa: 'yes',
    phiGated: true, // standing key to PHI — blocked until the §5 infra gate is met
    description: 'SharePoint reporting spreadsheets, Outlook intake mailbox, Forms.',
    // Aggregate-SharePoint read only for now. Mail.Read (the PHI intake mailbox)
    // is added with the email-intake increment, behind the PHI gate.
    scopes: ['offline_access', 'Files.Read.All', 'Sites.Read.All'],
    get authUrl() { return `${msAuthority()}/authorize` },
    get tokenUrl() { return `${msAuthority()}/token` },
  },
  quickbooks: {
    id: 'quickbooks',
    name: 'QuickBooks Online',
    authKind: 'oauth2',
    phiAllowed: false, // no BAA → finance data only
    baa: 'no',
    description: 'Budget & finance data (non-PHI).',
    scopes: ['com.intuit.quickbooks.accounting'],
    authUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  },
  bloomerang: {
    id: 'bloomerang',
    name: 'Bloomerang',
    authKind: 'apikey',
    phiAllowed: false,
    baa: 'unknown',
    description: 'Donor CRM — constituents & gifts.',
    scopes: [],
  },
  qgiv: {
    id: 'qgiv',
    name: 'Qgiv / Text2Give',
    authKind: 'apikey',
    phiAllowed: false,
    baa: 'unknown',
    description: 'Online & text donations, events.',
    scopes: [],
  },
}

export function getProvider(id: string): ProviderDef | null {
  return PROVIDERS[id] || null
}

/** Env var names per provider (server-side only). */
export function providerEnv(id: string): { clientId?: string; clientSecret?: string } {
  switch (id) {
    case 'microsoft': return { clientId: process.env.MS_CLIENT_ID, clientSecret: process.env.MS_CLIENT_SECRET }
    case 'quickbooks': return { clientId: process.env.QBO_CLIENT_ID, clientSecret: process.env.QBO_CLIENT_SECRET }
    default: return {}
  }
}

/** Is this provider ready to connect (OAuth creds present, or it's an API-key provider)? */
export function isConfigured(id: string): boolean {
  const p = getProvider(id)
  if (!p) return false
  // PHI-gated providers stay blocked until the infra prerequisites are met.
  if (p.phiGated && !isPhiGateReady()) return false
  if (p.authKind === 'apikey') return true // just needs the user to paste a key
  const { clientId, clientSecret } = providerEnv(id)
  return Boolean(clientId && clientSecret)
}

/** Reason a provider can't be connected yet (for clearer UI than "needs setup"). */
export function blockedReason(id: string): 'phi_gate' | 'needs_setup' | null {
  const p = getProvider(id)
  if (!p || isConfigured(id)) return null
  if (p.phiGated && !isPhiGateReady()) return 'phi_gate'
  return 'needs_setup'
}

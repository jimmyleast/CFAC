// Provider registry — drives the connect-button UI and the OAuth/API-key flows.
// Adding a provider = adding an entry here + its env vars (no route changes).

import { isEnvKeyConfigured } from './key-env'

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

/**
 * Once the PHI gate is open, a phiGated provider MUST be sealed with the strong
 * operator-provisioned env key (CONNECTOR_ENC_KEY), never the auto-provisioned DB
 * fallback that co-locates the key with its ciphertext. Returns true when a connect
 * (or token re-seal) MUST be refused because the env key is absent. Non-PHI
 * providers are never blocked by this — the DB key is an accepted soft-launch
 * tradeoff for them. See docs/PHI-INFRA-CHECKLIST.md §3.
 */
export function phiKeyBlocked(id: string): boolean {
  const p = getProvider(id)
  if (!p) return false
  return Boolean(p.phiGated) && isPhiGateReady() && !isEnvKeyConfigured()
}

/**
 * Hard cross-cutting invariant: PHI mode (gate ready) and the co-located DB-key
 * fallback must never coexist. With the gate open, the strong env key is mandatory
 * for every phiGated provider — so this throws if PHI_GATE_READY is set without
 * CONNECTOR_ENC_KEY. Fail-closed: called at server startup (instrumentation) and
 * usable as a CI/test assertion. This is the prerequisite to verify before flipping
 * PHI_GATE_READY.
 */
export function assertPhiKeyInvariant(): void {
  if (isPhiGateReady() && !isEnvKeyConfigured()) {
    throw new Error(
      'PHI_GATE_READY=true but CONNECTOR_ENC_KEY is not set — refusing to let PHI ' +
      'connector secrets be sealed with the co-located DB fallback key. Provision ' +
      'CONNECTOR_ENC_KEY (32-byte base64 or hex) in the host secret store before ' +
      'opening the PHI gate. See docs/PHI-INFRA-CHECKLIST.md §3.'
    )
  }
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
  asana: {
    id: 'asana',
    name: 'Asana',
    authKind: 'oauth2',
    phiAllowed: false, // project mgmt, no BAA → non-PHI
    baa: 'no',
    description: 'Project management — projects & tasks (non-PHI).',
    scopes: ['default'],
    authUrl: 'https://app.asana.com/-/oauth_authorize',
    tokenUrl: 'https://app.asana.com/-/oauth_token',
  },
  docusign: {
    id: 'docusign',
    name: 'DocuSign',
    authKind: 'oauth2',
    phiAllowed: true,   // mental-health intake forms → PHI
    baa: 'yes',
    phiGated: true,     // blocked until the §5 HIPAA infra
    description: 'E-signature / intake forms (PHI — gated).',
    scopes: ['signature'],
    authUrl: 'https://account.docusign.com/oauth/auth',
    tokenUrl: 'https://account.docusign.com/oauth/token',
  },
  qualtrics: {
    id: 'qualtrics',
    name: 'Qualtrics (OMS)',
    authKind: 'apikey',
    phiAllowed: true,   // outcome/feedback data tied to clients → PHI
    baa: 'yes',
    phiGated: true,     // blocked until the §5 HIPAA infra
    description: 'Outcome measurement / service feedback (PHI — gated).',
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
export function blockedReason(id: string): 'phi_gate' | 'phi_key' | 'needs_setup' | null {
  const p = getProvider(id)
  if (!p) return null
  // phi_gate (infra not ready) and phi_key (env key missing in PHI mode) are checked
  // before isConfigured: phi_key can apply even when creds + gate are otherwise present.
  if (p.phiGated && !isPhiGateReady()) return 'phi_gate'
  if (phiKeyBlocked(id)) return 'phi_key'
  if (isConfigured(id)) return null
  return 'needs_setup'
}

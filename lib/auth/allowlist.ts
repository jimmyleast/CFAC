import { isAdminEmail } from '@/lib/admin'

// Who may sign in. Built-in default: the CFAC org domain — so any @cfacbentonco.com
// staff member can self-serve a login without an env var being set. ALLOWED_EMAIL_DOMAINS
// (comma-separated) overrides the default domain list if provided. Admins (e.g. the
// off-domain owner account) are always allowed even if their domain isn't listed.
const DEFAULT_ALLOWED_DOMAINS = ['cfacbentonco.com']

export function allowedDomains(): string[] {
  const fromEnv = (process.env.ALLOWED_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED_DOMAINS
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || ''
}

/** True if this email is permitted to sign in (on an allowed domain, or an admin). */
export function isLoginAllowed(email: string): boolean {
  const e = String(email || '').trim().toLowerCase()
  if (!e.includes('@')) return false
  if (allowedDomains().includes(emailDomain(e))) return true
  if (isAdminEmail(e)) return true // off-domain admins (e.g. the owner) stay allowed
  return false
}

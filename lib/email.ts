import { Resend } from 'resend'
import type { CreateEmailOptions } from 'resend'
import { isEmailSendingEnabled } from '@/lib/email-control'

export const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'noreply@cfacbentonco.com'

/**
 * Encode a real email address for use in a + alias.
 * student@gmail.com → student_at_gmail_com
 */
function encodeRecipient(email: string): string {
  return email.replace('@', '_at_').replace(/\./g, '_')
}

/**
 * In development, redirect all outbound email to ADMIN_EMAIL using + addressing.
 * The real recipient is encoded in the local part so you can see who it was for.
 * e.g. student@gmail.com → joaquim+student_at_gmail_com@cfacbentonco.com
 */
function applyDevRedirect(
  to: string | string[],
  subject: string,
): { to: string; subject: string } | null {
  if (process.env.NODE_ENV !== 'development') return null
  const devEmail = process.env.ADMIN_EMAIL
  if (!devEmail) return null
  const atIdx = devEmail.lastIndexOf('@')
  const local = devEmail.slice(0, atIdx)
  const domain = devEmail.slice(atIdx + 1)
  const reals = Array.isArray(to) ? to : [to]
  const encoded = reals.map(encodeRecipient).join('_and_')
  return {
    to: `${local}+${encoded}@${domain}`,
    subject: `[DEV → ${reals.join(', ')}] ${subject}`,
  }
}

/**
 * Send a transactional email via Resend.
 *
 * - Silently returns null when ENABLE_EMAIL_SENDING !== 'true'
 * - In development (NODE_ENV=development), redirects to ADMIN_EMAIL with + addressing
 *   so you receive the email yourself without spamming real recipients
 * - Throws if enabled but RESEND_API_KEY is missing
 */
export async function sendEmail(
  opts: Omit<CreateEmailOptions, 'from'> & { from?: string; to: string | string[] },
) {
  if (!isEmailSendingEnabled()) return null
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY not configured')
  const subject = typeof opts.subject === 'string' ? opts.subject : ''
  const redirect = applyDevRedirect(opts.to, subject)
  return new Resend(key).emails.send({
    from: DEFAULT_FROM,
    ...opts,
    ...(redirect ? { to: redirect.to, subject: redirect.subject } : {}),
  } as CreateEmailOptions)
}

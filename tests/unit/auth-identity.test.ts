import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isAdminEmail } from '@/lib/admin'
import { isLoginAllowed } from '@/lib/auth/allowlist'
import { isEmailSendingEnabled } from '@/lib/email-control'

describe('admin identity', () => {
  const saved = { ...process.env }
  beforeEach(() => { delete process.env.ADMIN_EMAILS; delete process.env.ADMIN_EMAIL })
  afterEach(() => { process.env = { ...saved } })

  it('Melanie and the owner are built-in admins (no env needed)', () => {
    expect(isAdminEmail('melanie@cfacbentonco.com')).toBe(true)
    expect(isAdminEmail('MELANIE@CFACBENTONCO.COM')).toBe(true)
    expect(isAdminEmail('jimmyleast@gmail.com')).toBe(true)
  })
  it('a random staff email is not an admin', () => {
    expect(isAdminEmail('intern@cfacbentonco.com')).toBe(false)
  })
  it('ADMIN_EMAILS env adds on top of the defaults', () => {
    process.env.ADMIN_EMAILS = 'director@cfacbentonco.com'
    expect(isAdminEmail('director@cfacbentonco.com')).toBe(true)
    expect(isAdminEmail('melanie@cfacbentonco.com')).toBe(true) // default still admin
  })
})

describe('login allowlist', () => {
  const saved = { ...process.env }
  beforeEach(() => { delete process.env.ALLOWED_EMAIL_DOMAINS })
  afterEach(() => { process.env = { ...saved } })

  it('any @cfacbentonco.com address may sign in by default', () => {
    expect(isLoginAllowed('anyone@cfacbentonco.com')).toBe(true)
    expect(isLoginAllowed('melanie@cfacbentonco.com')).toBe(true)
  })
  it('the off-domain owner admin is still allowed', () => {
    expect(isLoginAllowed('jimmyleast@gmail.com')).toBe(true)
  })
  it('a non-org, non-admin email is blocked', () => {
    expect(isLoginAllowed('stranger@gmail.com')).toBe(false)
  })
  it('ALLOWED_EMAIL_DOMAINS overrides the default domain list', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'example.org'
    expect(isLoginAllowed('person@example.org')).toBe(true)
    expect(isLoginAllowed('person@cfacbentonco.com')).toBe(false) // no longer default
    expect(isLoginAllowed('jimmyleast@gmail.com')).toBe(true) // admin still allowed
  })
})

describe('email sending control', () => {
  const saved = { ...process.env }
  beforeEach(() => { delete process.env.ENABLE_EMAIL_SENDING; delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL })
  afterEach(() => { process.env = { ...saved } })

  it('enabled when Resend is configured and not explicitly disabled', () => {
    process.env.RESEND_API_KEY = 'x'; process.env.RESEND_FROM_EMAIL = 'a@b.co'
    expect(isEmailSendingEnabled()).toBe(true)
  })
  it('disabled when Resend is not configured', () => {
    expect(isEmailSendingEnabled()).toBe(false)
  })
  it('ENABLE_EMAIL_SENDING=false force-kills even with Resend set', () => {
    process.env.RESEND_API_KEY = 'x'; process.env.RESEND_FROM_EMAIL = 'a@b.co'; process.env.ENABLE_EMAIL_SENDING = 'false'
    expect(isEmailSendingEnabled()).toBe(false)
  })
  it('ENABLE_EMAIL_SENDING=true forces on without Resend check', () => {
    process.env.ENABLE_EMAIL_SENDING = 'true'
    expect(isEmailSendingEnabled()).toBe(true)
  })
})

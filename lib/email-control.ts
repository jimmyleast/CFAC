function hasResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
}

// Email sending is enabled when explicitly turned on, OR — to avoid a redundant
// second toggle in production — when Resend is configured and not explicitly killed.
// Set ENABLE_EMAIL_SENDING=false to force-disable (e.g. staging) even with Resend set.
export function isEmailSendingEnabled() {
  const v = (process.env.ENABLE_EMAIL_SENDING || '').toLowerCase()
  if (v === 'true') return true
  if (v === 'false') return false
  return hasResendConfigured()
}

export function isSmsSendingEnabled() {
  return process.env.ENABLE_SMS_SENDING === 'true'
}

export function isIntakeLinksEnabled() {
  return process.env.ENABLE_INTAKE_LINKS === 'true'
}

export function emailDisabledResponse() {
  return {
    disabled: true,
    reason: 'Email sending disabled. Set ENABLE_EMAIL_SENDING=true to re-enable.',
  }
}

export function emailDisabledJson(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    ...emailDisabledResponse(),
  }
}

export function assertEmailSendingEnabled() {
  if (!isEmailSendingEnabled()) {
    throw new Error('Email sending disabled. Set ENABLE_EMAIL_SENDING=true to re-enable.')
  }
}

export function assertSmsSendingEnabled() {
  if (!isSmsSendingEnabled()) {
    throw new Error('SMS sending disabled. Set ENABLE_SMS_SENDING=true to re-enable.')
  }
}

export function intakeLinksDisabledJson(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    disabled: true,
    reason: 'Intake links disabled. Set ENABLE_INTAKE_LINKS=true to re-enable.',
  }
}

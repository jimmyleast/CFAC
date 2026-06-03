export function isEmailSendingEnabled() {
  return process.env.ENABLE_EMAIL_SENDING === 'true'
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

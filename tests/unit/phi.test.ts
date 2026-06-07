import { describe, it, expect } from 'vitest'
import { redactPHI, containsPHI } from '@/lib/compliance/phi'

describe('redactPHI', () => {
  it('redacts emails, phones, SSNs, DOBs, and addresses', () => {
    expect(redactPHI('email jane.doe@example.com')).toContain('[redacted-email]')
    expect(redactPHI('call 479-621-0385')).toContain('[redacted-phone]')
    expect(redactPHI('ssn 123-45-6789')).toContain('[redacted-ssn]')
    expect(redactPHI('dob 03/14/2015')).toContain('[redacted-dob]')
    expect(redactPHI('lives at 2113 Little Flock Drive')).toContain('[redacted-address]')
  })

  it('redacts bare 10/11-digit phone numbers with no separators', () => {
    expect(redactPHI('call 4796210385 anytime')).toBe('call [redacted-phone] anytime')
    expect(redactPHI('14796210385')).toBe('[redacted-phone]')
  })

  it('preserves metric counts and years (not treated as phone numbers)', () => {
    const s = '895 children served in 2025, up from 21082 reach'
    expect(redactPHI(s)).toBe(s)
    expect(containsPHI(s)).toBe(false)
  })

  it('containsPHI detects structured PII', () => {
    expect(containsPHI('reach me at jane@x.com')).toBe(true)
    expect(containsPHI('just numbers 895 and 2025')).toBe(false)
  })
})

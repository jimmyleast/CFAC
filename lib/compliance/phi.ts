// PHI/PII redaction guardrail. Strips structured identifiers from text before it
// is sent to any non-BAA subprocessor (e.g. the cross-model critic). Metric
// counts/years are preserved (only structured PII patterns are removed).
//
// This is defense-in-depth: v1 reasons over aggregate metrics only, but a staffer
// could type a client name/phone/email into a question. Apply before critique.

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g
const DOB = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g
const STREET = /\b\d{1,5}\s+([A-Za-z0-9.'-]+\s){1,4}(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court|Cir|Circle|Pl|Place|Hwy|Highway)\b\.?/gi
// US phone: 10 digits with optional country code/format. Won't match metric
// counts (which aren't 10-digit grouped) or years.
const PHONE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g
// Bare 10/11-digit run with no separators (e.g. 4796210385) — almost certainly a
// phone number, not an aggregate metric (counts are not 10 digits long).
const BARE_PHONE = /\b1?\d{10}\b/g

export function redactPHI(text: string): string {
  return String(text || '')
    .replace(EMAIL, '[redacted-email]')
    .replace(SSN, '[redacted-ssn]')
    .replace(DOB, '[redacted-dob]')
    .replace(STREET, '[redacted-address]')
    .replace(PHONE, '[redacted-phone]')
    .replace(BARE_PHONE, '[redacted-phone]')
}

/** True if the text appears to contain structured PII. */
export function containsPHI(text: string): boolean {
  return redactPHI(text) !== String(text || '')
}

// Pure sanitizer for Operational Definition edits. Protects the §4 "one enforced
// definition per metric" contract: only governance PROSE fields are writable —
// structural fields (key, category, parent_key, is_dedup_rule, accepted_values,
// required_fields) can NEVER be changed via the API. `unit` is constrained to the
// known enum so downstream formatting stays consistent (Integrity principle).

const EDITABLE = new Set(['display_name', 'definition', 'calc_rule', 'owner', 'source_note', 'unit', 'program_area'])
export const ALLOWED_UNITS = ['count', 'usd', 'hours', 'percent'] as const
const MAX_LEN = 4000

export function sanitizeDefinitionPatch(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object') return out
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!EDITABLE.has(k) || typeof v !== 'string') continue
    if (k === 'unit') {
      if ((ALLOWED_UNITS as readonly string[]).includes(v)) out[k] = v
      continue
    }
    out[k] = v.slice(0, MAX_LEN)
  }
  return out
}

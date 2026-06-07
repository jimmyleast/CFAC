import { describe, it, expect } from 'vitest'
import { sanitizeDefinitionPatch } from '@/lib/definitions/sanitizePatch'

describe('sanitizeDefinitionPatch — protects the §4 enforced-definition contract', () => {
  it('keeps editable prose fields', () => {
    const out = sanitizeDefinitionPatch({ definition: 'new text', calc_rule: 'rule', owner: 'Dir of Programs' })
    expect(out).toEqual({ definition: 'new text', calc_rule: 'rule', owner: 'Dir of Programs' })
  })

  it('DROPS structural fields — they can never be written', () => {
    const out = sanitizeDefinitionPatch({
      definition: 'ok',
      is_dedup_rule: true,
      category: 'impact',
      parent_key: 'services_provided',
      key: 'hacked',
      id: 'x',
      accepted_values: ['a'],
      sort_order: 1,
    })
    expect(out).toEqual({ definition: 'ok' })
    expect('is_dedup_rule' in out).toBe(false)
    expect('category' in out).toBe(false)
    expect('parent_key' in out).toBe(false)
    expect('key' in out).toBe(false)
  })

  it('drops non-string values', () => {
    expect(sanitizeDefinitionPatch({ definition: 123, owner: null })).toEqual({})
  })

  it('slices over-long prose to 4000 chars', () => {
    const out = sanitizeDefinitionPatch({ definition: 'x'.repeat(5000) })
    expect(out.definition.length).toBe(4000)
  })

  it('constrains unit to the allowed enum', () => {
    expect(sanitizeDefinitionPatch({ unit: 'usd' })).toEqual({ unit: 'usd' })
    expect(sanitizeDefinitionPatch({ unit: 'dollars' })).toEqual({}) // invalid → dropped
  })

  it('returns {} for non-objects', () => {
    expect(sanitizeDefinitionPatch(null)).toEqual({})
    expect(sanitizeDefinitionPatch('nope')).toEqual({})
  })
})

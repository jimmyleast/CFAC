import { describe, it, expect } from 'vitest'
import { parseVerdict } from '@/lib/hope/critique'

describe('parseVerdict (cross-model critique gating)', () => {
  it('parses a well-formed verdict', () => {
    expect(parseVerdict('{"pass":true,"score":9,"issues":[]}')).toEqual({ pass: true, score: 9, issues: [] })
  })

  it('rejects pass:true with NO score (no synthesized pass — the safety fix)', () => {
    expect(parseVerdict('{"pass":true}')).toBeNull()
  })

  it('rejects a non-boolean pass', () => {
    expect(parseVerdict('{"pass":"yes","score":9}')).toBeNull()
  })

  it('rejects non-JSON / truncated output', () => {
    expect(parseVerdict('the model said it looks fine')).toBeNull()
    expect(parseVerdict('{"pass":true,"score":')).toBeNull()
  })

  it('clamps score to 1..10', () => {
    expect(parseVerdict('{"pass":false,"score":99,"issues":["x"]}')?.score).toBe(10)
    expect(parseVerdict('{"pass":false,"score":-3,"issues":[]}')?.score).toBe(1)
  })
})

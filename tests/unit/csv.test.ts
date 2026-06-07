import { describe, it, expect } from 'vitest'
import { toCsv } from '@/lib/export/csv'

describe('toCsv', () => {
  const cols = [
    { key: 'metric', header: 'Metric' },
    { key: 'value', header: 'Value' },
  ]

  it('writes header + CRLF rows', () => {
    const csv = toCsv([{ metric: 'reach', value: 21082 }], cols)
    expect(csv).toBe('Metric,Value\r\nreach,21082')
  })

  it('quotes fields with commas, quotes, or newlines and escapes quotes', () => {
    const csv = toCsv([
      { metric: 'a,b', value: 1 },
      { metric: 'say "hi"', value: 2 },
      { metric: 'line1\nline2', value: 3 },
    ], cols)
    expect(csv).toContain('"a,b",1')
    expect(csv).toContain('"say ""hi""",2')
    expect(csv).toContain('"line1\nline2",3')
  })

  it('neutralizes formula-injection in text cells (not numbers)', () => {
    const csv = toCsv([{ metric: '=cmd()', value: -5 }, { metric: '@SUM(A1)', value: 2 }], cols)
    expect(csv).toContain("'=cmd(),-5") // text prefixed with quote; numeric -5 untouched
    expect(csv).toContain("'@SUM(A1),2")
  })

  it('renders null/undefined as empty and handles an empty row set', () => {
    expect(toCsv([{ metric: null as unknown as string, value: undefined as unknown as number }], cols)).toBe('Metric,Value\r\n,')
    expect(toCsv([], cols)).toBe('Metric,Value')
  })
})

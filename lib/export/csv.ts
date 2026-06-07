// Minimal, correct CSV serialization. Pure + testable. Quotes fields containing
// comma/quote/newline and escapes embedded quotes per RFC 4180.

export type CsvColumn<T> = { key: keyof T | string; header: string }

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(v) // numbers pass through unmodified
  let s = String(v)
  // Defend against spreadsheet formula injection: a text cell starting with
  // = + - @ (or tab/CR) can execute in Excel/Sheets. Prefix with a quote.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(',')
  const body = rows.map((r) => columns.map((c) => cell(r[c.key as string])).join(',')).join('\r\n')
  return body ? `${head}\r\n${body}` : head
}

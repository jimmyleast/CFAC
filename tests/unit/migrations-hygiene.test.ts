import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Locks in the migration-hygiene fix: verification tests (*.test.sql) live under
// supabase/tests/, NEVER supabase/migrations/, and no two migrations share a
// timestamp prefix. A migration runner that globs *.sql must not pick up a test
// file or hit an ambiguous ordering. Cheap guard against silent re-breakage.
const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')

describe('supabase/migrations hygiene', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))

  it('contains no *.test.sql (tests live in supabase/tests/)', () => {
    expect(files.filter((f) => f.endsWith('.test.sql'))).toEqual([])
  })

  it('has no duplicate timestamp prefixes', () => {
    const prefixes = files.map((f) => f.slice(0, 14)).filter((p) => /^\d{14}$/.test(p))
    const dupes = prefixes.filter((p, i) => prefixes.indexOf(p) !== i)
    expect(dupes).toEqual([])
  })
})

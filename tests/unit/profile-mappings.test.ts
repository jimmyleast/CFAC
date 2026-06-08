import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '20260608100000_align_profile_metric_mappings.sql'),
  'utf8',
)

describe('profile metric mapping migration', () => {
  it('adds active mappings for canonical source-profile keys', () => {
    expect(migration).toContain("('clients_served', 'clients_served', 'latest', 'active'")
    expect(migration).toContain("('residential_client_served', 'residential_children', 'latest', 'active'")
    expect(migration).toContain("('residential_client_served', 'residential_women', 'latest', 'active'")
  })

  it('drafts superseded pre-profile keys instead of deleting lineage history', () => {
    expect(migration).toContain("source_metric_key = 'children_served'")
    expect(migration).toContain("source_metric_key = 'res_children'")
    expect(migration).toContain("source_metric_key = 'res_women'")
    expect(migration.match(/set status = 'draft'/g)).toHaveLength(3)
  })
})

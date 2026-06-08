import { describe, it, expect } from 'vitest'
import { getSourceProfile, profileForSourceSlug } from '@/lib/data/sourceProfiles'
import { importWithSourceProfile } from '@/lib/data/profileImport'

const base = {
  sourceId: 'src1',
  importedBy: 'user1',
  batchId: 'batch1',
}

describe('source profiles', () => {
  it('maps seeded CFAC source slugs to profiles', () => {
    expect(profileForSourceSlug('impact-history')?.key).toBe('impact_history')
    expect(profileForSourceSlug('maintenance-form')?.mode).toBe('aggregate_from_sensitive_rows')
    expect(profileForSourceSlug('fleet-form')?.mode).toBe('aggregate_from_sensitive_rows')
  })

  it('classifies sensitive operational row fields away from aggregate dashboards', () => {
    const maintenance = getSourceProfile('maintenance_request_2026')!
    expect(maintenance.fields.find((f) => f.canonical === 'email')?.classification).toBe('staff_pii')
    const fleet = getSourceProfile('fleet_management_2026')!
    expect(fleet.fields.find((f) => f.canonical === 'purpose')?.classification).toBe('client_adjacent')
  })
})

describe('profile imports', () => {
  it('imports the annual impact workbook as aggregate metric rows', () => {
    const out = importWithSourceProfile({
      ...base,
      profileKey: 'impact_history',
      header: ['Year', 'Reach', 'Children Served', 'Forensic Interviews'],
      dataRows: [[2025, 21082, 895, 859]],
    })
    expect(out.handled).toBe(true)
    expect(out.metrics.map((m) => [m.metric_key, m.value])).toEqual([
      ['reach', 21082],
      ['clients_served', 895],
      ['forensic_interviews', 859],
    ])
    expect(out.importRows[0].raw).toEqual({ Year: '2025', Reach: 21082, 'Children Served': 895, 'Forensic Interviews': 859 })
  })

  it('aggregates maintenance rows without storing names, emails, or descriptions', () => {
    const out = importWithSourceProfile({
      ...base,
      profileKey: 'maintenance_request_2026',
      header: ['Date', 'Email', 'Name', 'Description of Maintenance Request with Detail', 'Request Type', 'Priority', 'Status', 'On Time?', 'Actual Cost'],
      dataRows: [['2026-01-05', 'staff@cfac.org', 'Jane Staff', 'Fix sink near room 2', 'Plumbing', 'High', 'Complete', 'Yes', '$120.00']],
    })
    expect(out.metricKeys).toContain('maintenance_requests_total')
    expect(out.metricKeys).toContain('maintenance_actual_cost')
    const raw = JSON.stringify(out.importRows[0].raw)
    expect(raw).toContain('aggregate_only')
    expect(raw).not.toContain('staff@cfac.org')
    expect(raw).not.toContain('Jane Staff')
    expect(raw).not.toContain('Fix sink')
  })

  it('aggregates fleet rows without storing driver names or locations', () => {
    const out = importWithSourceProfile({
      ...base,
      profileKey: 'fleet_management_2026',
      header: ['Date of Vehicle Use', 'Name of Driver', 'Vehicle Type', 'Purpose of Travel', 'Location', 'Miles Driven', '1/2 Tank of Fuel?', 'List and describe any maintenance issues'],
      dataRows: [['2026-02-03', 'Driver One', 'Van', 'Residential Client', 'Court building', 42, 'No', 'Tire light']],
    })
    expect(out.metricKeys).toContain('fleet_trips_total')
    expect(out.metricKeys).toContain('fleet_miles_driven')
    expect(out.metricKeys).toContain('fleet_low_fuel_returns')
    const raw = JSON.stringify(out.importRows[0].raw)
    expect(raw).not.toContain('Driver One')
    expect(raw).not.toContain('Court building')
    expect(raw).not.toContain('Tire light')
  })
})

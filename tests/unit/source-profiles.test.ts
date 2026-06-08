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
    expect(profileForSourceSlug('education-sheet')?.key).toBe('education_training_aggregate')
    expect(profileForSourceSlug('community-engagement')?.key).toBe('community_engagement_aggregate')
    expect(profileForSourceSlug('volunteers-sheet')?.key).toBe('volunteers_aggregate')
    expect(profileForSourceSlug('development-bloomerang')?.key).toBe('development_aggregate')
    expect(profileForSourceSlug('finance-quickbooks')?.key).toBe('finance_aggregate')
    expect(profileForSourceSlug('hr-isolved')?.key).toBe('hr_aggregate')
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
      dataRows: [['2026-01-05', 'staff@example.test', 'Test Staff', 'Synthetic maintenance narrative', 'Plumbing', 'High', 'Complete', 'Yes', '$120.00']],
    })
    expect(out.metricKeys).toContain('maintenance_requests_total')
    expect(out.metricKeys).toContain('maintenance_actual_cost')
    expect(out.metrics.filter((m) => m.metric_key === 'maintenance_requests_by_type')).toHaveLength(1)
    expect(out.metrics.find((m) => m.metric_key === 'maintenance_requests_by_type')?.value).toBe(1)
    const raw = JSON.stringify(out.importRows[0].raw)
    expect(raw).toContain('aggregate_only')
    expect(raw).not.toContain('staff@example.test')
    expect(raw).not.toContain('Test Staff')
    expect(raw).not.toContain('Synthetic maintenance narrative')
  })

  it('rolls up repeated maintenance buckets instead of creating duplicate dimension rows', () => {
    const out = importWithSourceProfile({
      ...base,
      profileKey: 'maintenance_request_2026',
      header: ['Date', 'Request Type', 'Priority', 'Status'],
      dataRows: [
        ['2026-01-05', 'Plumbing', 'High', 'Open'],
        ['2026-01-06', 'Plumbing', 'High', 'Open'],
      ],
    })
    const byType = out.metrics.find((m) => m.metric_key === 'maintenance_requests_by_type')
    expect(byType?.value).toBe(2)
    expect(byType?.dimension).toEqual({ request_type: 'Plumbing' })
  })

  it('aggregates fleet rows without storing driver names or locations', () => {
    const out = importWithSourceProfile({
      ...base,
      profileKey: 'fleet_management_2026',
      header: ['Date of Vehicle Use', 'Name of Driver', 'Vehicle Type', 'Purpose of Travel', 'Location', 'Miles Driven', '1/2 Tank of Fuel?', 'List and describe any maintenance issues'],
      dataRows: [['2026-02-03', 'Synthetic Driver', 'Van', 'Residential Client', 'Synthetic destination', 42, 'No', 'Synthetic issue']],
    })
    expect(out.metricKeys).toContain('fleet_trips_total')
    expect(out.metricKeys).toContain('fleet_miles_driven')
    expect(out.metricKeys).toContain('fleet_low_fuel_returns')
    expect(out.metrics.find((m) => m.metric_key === 'fleet_trips_by_purpose')?.dimension).toEqual({ purpose: 'Residential Client' })
    const raw = JSON.stringify(out.importRows[0].raw)
    expect(raw).not.toContain('Synthetic Driver')
    expect(raw).not.toContain('Synthetic destination')
    expect(raw).not.toContain('Synthetic issue')
  })

  it('imports education training aggregates without storing speaker names', () => {
    const out = importWithSourceProfile({
      ...base,
      profileKey: 'education_training_aggregate',
      header: ['Training Date', 'Presenter', 'Training Type', 'Audience', 'Attendees'],
      dataRows: [['2026-03-01', 'Synthetic Presenter', 'Mandated Reporter', 'Teachers', 80]],
    })
    expect(out.metricKeys).toContain('education_trainings_total')
    expect(out.metricKeys).toContain('education_attendees')
    expect(out.metrics.find((m) => m.metric_key === 'education_trainings_by_audience')?.dimension).toEqual({ audience: 'Teachers' })
    expect(JSON.stringify(out.importRows[0].raw)).not.toContain('Synthetic Presenter')
  })

  it('imports community and volunteer aggregate rows', () => {
    const community = importWithSourceProfile({
      ...base,
      profileKey: 'community_engagement_aggregate',
      header: ['Event Date', 'Event Type', 'Attendance', 'Leads', 'Conversions'],
      dataRows: [['2026-04-02', 'Tour', 20, 3, 1]],
    })
    expect(community.metricKeys).toContain('community_event_attendance')
    expect(community.metricKeys).toContain('community_leads')
    const volunteers = importWithSourceProfile({
      ...base,
      profileKey: 'volunteers_aggregate',
      header: ['Volunteer Date', 'Volunteer Name', 'Volunteer Type', 'Volunteers', 'Hours'],
      dataRows: [['2026-04-03', 'Synthetic Volunteer', 'Group', 5, 12]],
    })
    expect(volunteers.metricKeys).toContain('volunteers_total')
    expect(volunteers.metricKeys).toContain('volunteer_hours')
    expect(JSON.stringify(volunteers.importRows[0].raw)).not.toContain('Synthetic Volunteer')
  })

  it('imports development, finance, and HR aggregate rows', () => {
    const development = importWithSourceProfile({
      ...base,
      profileKey: 'development_aggregate',
      header: ['Gift Date', 'Donor', 'Campaign', 'Gift Count', 'Amount', 'In-Kind Value'],
      dataRows: [['2026-05-01', 'Synthetic Donor', 'Spring', 2, '$100.00', '$25.00']],
    })
    expect(development.metricKeys).toContain('development_revenue')
    expect(development.metricKeys).toContain('development_in_kind_value')
    expect(JSON.stringify(development.importRows[0].raw)).not.toContain('Synthetic Donor')
    const finance = importWithSourceProfile({
      ...base,
      profileKey: 'finance_aggregate',
      header: ['Period', 'Income', 'Expenses', 'Payroll', 'Cash Balance'],
      dataRows: [['2026-05', '$1000', '$700', '$300', '$5000']],
    })
    expect(finance.metricKeys).toEqual(['finance_income', 'finance_expenses', 'finance_payroll', 'finance_cash_balance'])
    const hr = importWithSourceProfile({
      ...base,
      profileKey: 'hr_aggregate',
      header: ['Period', 'Applicants', 'Phone Screenings', 'Open Positions', 'Turnover', 'Retention Rate'],
      dataRows: [['2026-05', 10, 6, 2, 1, 95]],
    })
    expect(hr.metricKeys).toContain('hr_retention_rate')
  })
})

import { describe, expect, it } from 'vitest'
import { groupWorkbookReports } from '@/lib/reports/workbookTabs'

describe('groupWorkbookReports', () => {
  it('recreates workbook reports and tabs from aggregate metric rows', () => {
    const reports = groupWorkbookReports([
      {
        metric_key: 'cfac_dashboard_reach_total',
        label: 'Reach',
        value: 10,
        unit: 'count',
        period_label: '2026-01',
        period_start: '2026-01-01',
        dimension: { workbook_sheet: 'Reach', dashboard_section: 'Year to date', dashboard_row: 'Reach' },
        data_sources: { name: 'CFAC Dashboard 2026', slug: 'cfac-dashboard-2026' },
      },
      {
        metric_key: 'education_attendees',
        label: 'Education attendees',
        value: 32,
        unit: 'count',
        period_label: '2026-01',
        period_start: '2026-01-01',
        dimension: {},
        data_sources: { name: 'Education Spreadsheet', slug: 'education-sheet' },
      },
    ])
    expect(reports.map((r) => r.sourceSlug).sort()).toEqual(['cfac-dashboard-2026', 'education-sheet'])
    expect(reports.find((r) => r.sourceSlug === 'cfac-dashboard-2026')?.tabs[0].name).toBe('Reach')
    expect(reports.find((r) => r.sourceSlug === 'cfac-dashboard-2026')?.tabs[0].sections[0].name).toBe('Year to date')
    expect(reports.find((r) => r.sourceSlug === 'education-sheet')?.tabs[0].name).toBe('Metrics')
  })
})

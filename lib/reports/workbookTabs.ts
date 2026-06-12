export type WorkbookMetricRow = {
  metric_key: string
  label: string | null
  value: number | string | null
  unit: string | null
  period_label: string | null
  period_start: string | null
  dimension: Record<string, unknown> | null
  data_sources?: { name?: string | null; slug?: string | null } | null
}

export type WorkbookTabMetric = {
  metricKey: string
  label: string
  period: string | null
  value: number
  unit: string | null
  section: string | null
  order: number
}

export type WorkbookTabSection = {
  name: string
  metrics: WorkbookTabMetric[]
}

export type WorkbookTab = {
  name: string
  metrics: WorkbookTabMetric[]
  sections: WorkbookTabSection[]
}

export type WorkbookReport = {
  sourceName: string
  sourceSlug: string
  tabs: WorkbookTab[]
}

function numberValue(value: number | string | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function tabName(row: WorkbookMetricRow): string {
  const sheet = row.dimension?.workbook_sheet
  return typeof sheet === 'string' && sheet.trim() ? sheet.trim() : 'Metrics'
}

function rowOrder(row: WorkbookMetricRow): number {
  const value = row.dimension?.dashboard_order
  return typeof value === 'number' && Number.isFinite(value) ? value : 999_999
}

export function groupWorkbookReports(rows: WorkbookMetricRow[]): WorkbookReport[] {
  const reports = new Map<string, WorkbookReport>()
  for (const row of rows) {
    const sourceName = row.data_sources?.name || 'Workbook'
    const sourceSlug = row.data_sources?.slug || 'workbook'
    const reportKey = sourceSlug
    let report = reports.get(reportKey)
    if (!report) {
      report = { sourceName, sourceSlug, tabs: [] }
      reports.set(reportKey, report)
    }
    const name = tabName(row)
    let tab = report.tabs.find((t) => t.name === name)
    if (!tab) {
      tab = { name, metrics: [], sections: [] }
      report.tabs.push(tab)
    }
    const value = numberValue(row.value)
    if (value === null) continue
    tab.metrics.push({
      metricKey: row.metric_key,
      label: row.label || row.metric_key,
      period: row.period_label,
      value,
      unit: row.unit,
      section: typeof row.dimension?.dashboard_section === 'string' ? row.dimension.dashboard_section : null,
      order: rowOrder(row),
    })
  }

  return Array.from(reports.values())
    .map((report) => ({
      ...report,
      tabs: report.tabs
        .map((tab) => ({
          ...tab,
          metrics: tab.metrics.sort((a, b) => a.order - b.order || (a.period || '').localeCompare(b.period || '') || a.label.localeCompare(b.label)),
          sections: Array.from(
            tab.metrics.reduce((acc, metric) => {
              const section = metric.section || 'Metrics'
              const group = acc.get(section) || []
              group.push(metric)
              acc.set(section, group)
              return acc
            }, new Map<string, WorkbookTabMetric[]>()).entries(),
          ).map(([name, metrics]) => ({ name, metrics })).sort((a, b) => {
            const aOrder = Math.min(...a.metrics.map((metric) => metric.order))
            const bOrder = Math.min(...b.metrics.map((metric) => metric.order))
            return aOrder - bOrder || a.name.localeCompare(b.name)
          }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName))
}

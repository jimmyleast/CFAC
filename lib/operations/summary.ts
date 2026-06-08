export type OpsMetricRow = {
  metric_key: string
  label?: string | null
  value: number | string | null
  period_label: string | null
  period_start: string | null
  dimension?: unknown
}

export type OpsBreakdown = { label: string; value: number }
export type OpsSummary = {
  period: string | null
  totals: Record<string, number>
  maintenance: {
    byType: OpsBreakdown[]
    byPriority: OpsBreakdown[]
    byStatus: OpsBreakdown[]
  }
  fleet: {
    byVehicleType: OpsBreakdown[]
    byPurpose: OpsBreakdown[]
  }
}

const TOTAL_KEYS = [
  'maintenance_requests_total',
  'maintenance_on_time_yes',
  'maintenance_actual_cost',
  'fleet_trips_total',
  'fleet_miles_driven',
  'fleet_low_fuel_returns',
  'fleet_maintenance_issue_reports',
] as const

export const OPERATIONS_METRIC_KEYS = [
  ...TOTAL_KEYS,
  'maintenance_requests_by_type',
  'maintenance_requests_by_priority',
  'maintenance_requests_by_status',
  'fleet_trips_by_vehicle_type',
  'fleet_trips_by_purpose',
] as const

function dimValue(dimension: unknown, key: string): string {
  if (!dimension || typeof dimension !== 'object') return 'Unspecified'
  const value = (dimension as Record<string, unknown>)[key]
  const label = String(value ?? '').trim()
  return label || 'Unspecified'
}

function addBreakdown(target: Map<string, number>, label: string, value: number) {
  target.set(label, (target.get(label) || 0) + value)
}

function toBreakdown(map: Map<string, number>): OpsBreakdown[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

export function buildOperationsSummary(rows: OpsMetricRow[]): OpsSummary {
  const periods = rows
    .map((r) => r.period_start)
    .filter((p): p is string => Boolean(p))
    .sort()
  const latestStart = periods.length ? periods[periods.length - 1] : null
  const inPeriod = latestStart ? rows.filter((r) => r.period_start === latestStart) : rows
  const period = inPeriod.find((r) => r.period_label)?.period_label ?? latestStart
  const totals: Record<string, number> = {}
  const maintenanceType = new Map<string, number>()
  const maintenancePriority = new Map<string, number>()
  const maintenanceStatus = new Map<string, number>()
  const fleetVehicle = new Map<string, number>()
  const fleetPurpose = new Map<string, number>()

  for (const row of inPeriod) {
    const value = Number(row.value)
    if (!Number.isFinite(value)) continue
    if ((TOTAL_KEYS as readonly string[]).includes(row.metric_key)) {
      totals[row.metric_key] = (totals[row.metric_key] || 0) + value
    }
    if (row.metric_key === 'maintenance_requests_by_type') addBreakdown(maintenanceType, dimValue(row.dimension, 'request_type'), value)
    if (row.metric_key === 'maintenance_requests_by_priority') addBreakdown(maintenancePriority, dimValue(row.dimension, 'priority'), value)
    if (row.metric_key === 'maintenance_requests_by_status') addBreakdown(maintenanceStatus, dimValue(row.dimension, 'status'), value)
    if (row.metric_key === 'fleet_trips_by_vehicle_type') addBreakdown(fleetVehicle, dimValue(row.dimension, 'vehicle_type'), value)
    if (row.metric_key === 'fleet_trips_by_purpose') addBreakdown(fleetPurpose, dimValue(row.dimension, 'purpose'), value)
  }

  return {
    period,
    totals,
    maintenance: {
      byType: toBreakdown(maintenanceType),
      byPriority: toBreakdown(maintenancePriority),
      byStatus: toBreakdown(maintenanceStatus),
    },
    fleet: {
      byVehicleType: toBreakdown(fleetVehicle),
      byPurpose: toBreakdown(fleetPurpose),
    },
  }
}

// The "CFAC DASHBOARD" org-health snapshot, encoded from the org's own data-model
// spec (CFAC Data Points.docx): "insight in a moment of time [into] the health and
// active life cycle of the organization." Each tile either resolves a real metric
// from the aggregate layer or honestly states which source it still awaits — many
// require the PHI-gated Collaborate case data or a not-yet-connected connector.
// No PHI here: tile labels + metric_keys only.

export type AwaitSource = 'collaborate' | 'bloomerang' | 'quickbooks' | 'isolved' | 'marketing'

export const SOURCE_LABEL: Record<AwaitSource, string> = {
  collaborate: 'Collaborate case data',
  bloomerang: 'Bloomerang',
  quickbooks: 'QuickBooks',
  isolved: 'iSolved (HR)',
  marketing: 'marketing tools',
}

export type HealthTileSpec = {
  label: string
  metricKey?: string       // resolve latest value from the metrics layer
  awaiting?: AwaitSource   // when no metric: the source this tile still needs
  phiGated?: boolean       // that source is PHI-gated (case-level) — blocked until BAAs + HIPAA infra
  note?: string            // short honest caveat (e.g. annual vs the live count the spec wants)
  // How to combine the latest-period rows across sources: 'sum' for counts (default),
  // 'last' for rates/percentages (summing a % across sources is meaningless).
  aggregate?: 'sum' | 'last'
}

/** Metric keys whose latest-period rows must NOT be summed across sources (rates/%). */
export function aggregateModeByKey(): Map<string, 'sum' | 'last'> {
  const m = new Map<string, 'sum' | 'last'>()
  for (const s of ORG_HEALTH_SPEC) for (const t of s.tiles) if (t.metricKey) m.set(t.metricKey, t.aggregate ?? 'sum')
  return m
}

export type HealthSection = { title: string; blurb: string; tiles: HealthTileSpec[] }

// Grouped per the spec's intent. metricKeys map to what's loaded today (annual impact
// history + monthly operations); the spec's live "active client" counts need the
// gated Collaborate feed, surfaced as awaiting rather than hidden.
export const ORG_HEALTH_SPEC: HealthSection[] = [
  {
    title: 'Clients & Services',
    blurb: 'The active life cycle of who CFAC is serving. Live caseload/active-client counts come from Collaborate (PHI-gated); the served totals below are the annual aggregates loaded today.',
    tiles: [
      { label: 'Active Acute Clients (90-day)', awaiting: 'collaborate', phiGated: true },
      { label: 'Children Served', metricKey: 'clients_served', note: 'annual total' },
      { label: 'Forensic Interviews', metricKey: 'forensic_interviews', note: 'annual total' },
      { label: 'Medical Exams', metricKey: 'medical', note: 'annual total' },
      { label: 'Mental Health Services', metricKey: 'mental_health', note: 'annual total' },
      { label: 'Residential — Women Served', metricKey: 'residential_women', note: 'annual total' },
      { label: 'Residential — Children Served', metricKey: 'residential_children', note: 'annual total' },
      { label: 'Overdue Clients (no 90-day follow-up)', awaiting: 'collaborate', phiGated: true },
    ],
  },
  {
    title: 'People & Community',
    blurb: 'Reach into the community — volunteers, training, outreach, and giving.',
    tiles: [
      { label: 'Reach', metricKey: 'reach', note: 'annual total' },
      { label: 'Volunteers', metricKey: 'volunteers', note: 'annual total' },
      { label: 'People Trained', metricKey: 'education', note: 'annual (education)' },
      { label: 'Community Event Attendance', metricKey: 'community_events', note: 'annual total' },
      { label: 'Tours', metricKey: 'tours', note: 'annual total' },
      { label: 'Active Donors', awaiting: 'bloomerang' },
      { label: 'PR Responses', awaiting: 'marketing' },
    ],
  },
  {
    title: 'Operations',
    blurb: 'The environmental experience for clients and staff — facilities and fleet.',
    tiles: [
      { label: 'Maintenance Requests', metricKey: 'maintenance_requests_total', note: 'monthly' },
      { label: 'Maintenance Completed On Time', metricKey: 'maintenance_on_time_yes', note: 'monthly' },
      { label: 'Fleet Trips', metricKey: 'fleet_trips_total', note: 'monthly' },
      { label: 'Fleet Miles', metricKey: 'fleet_miles_driven', note: 'monthly' },
    ],
  },
  {
    title: 'Finance & HR',
    blurb: 'Financial health and workforce — awaiting their source connections.',
    tiles: [
      { label: 'Cash Flow', awaiting: 'quickbooks' },
      { label: 'Retention Rate', awaiting: 'isolved' },
      { label: 'Open Positions', awaiting: 'isolved' },
    ],
  },
]

export type ResolvedTile = {
  label: string
  state: 'live' | 'awaiting'
  value: number | null
  period: string | null
  metricKey: string | null
  note: string | null
  awaiting: AwaitSource | null
  awaitingLabel: string | null
  phiGated: boolean
}
export type ResolvedSection = { title: string; blurb: string; tiles: ResolvedTile[] }

/** Resolve each spec tile against the latest value per metric_key. Pure + testable. */
export function resolveHealthSections(
  spec: HealthSection[],
  latestByKey: Map<string, { value: number; period: string | null }>,
): ResolvedSection[] {
  return spec.map((section) => ({
    title: section.title,
    blurb: section.blurb,
    tiles: section.tiles.map((t): ResolvedTile => {
      // HARD PHI GATE (in code, not by convention): a phiGated tile must NEVER resolve
      // to a live value — even if a Collaborate-backed metric_key is later wired onto
      // it — until the gate work explicitly clears phiGated. Surfaces case-derived
      // counts through this aggregate route only over the compliance team's dead body.
      const hit = !t.phiGated && t.metricKey ? latestByKey.get(t.metricKey) : undefined
      if (hit) {
        return { label: t.label, state: 'live', value: hit.value, period: hit.period, metricKey: t.metricKey!, note: t.note ?? null, awaiting: null, awaitingLabel: null, phiGated: false }
      }
      return {
        label: t.label, state: 'awaiting', value: null, period: null, metricKey: t.metricKey ?? null,
        note: t.note ?? null,
        awaiting: t.awaiting ?? null,
        awaitingLabel: t.awaiting ? SOURCE_LABEL[t.awaiting] : null,
        phiGated: Boolean(t.phiGated),
      }
    }),
  }))
}

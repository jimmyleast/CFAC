// MDT agency accountability — the grant-reporting scorecards. Pure + testable.
// Computes per-agency case volume, status mix, and prosecution/closure rates from
// the case set. Aggregate counts only (no client PHI).

export type ScorecardCase = { assigned_agency_id: string | null; status: string }
export type ScorecardAgency = { id: string; name: string; type: string; active: boolean }

export type AgencyScorecard = {
  agencyId: string | null
  name: string
  type: string | null
  total: number
  open: number          // new + pending + criminal
  closed: number
  byStatus: { new: number; pending: number; criminal: number; closed: number }
  criminalRatePct: number | null   // % of the agency's cases in/through prosecution
  closedRatePct: number | null
}

function blank(): AgencyScorecard['byStatus'] { return { new: 0, pending: 0, criminal: 0, closed: 0 } }

export function computeAgencyScorecards(cases: ScorecardCase[], agencies: ScorecardAgency[]): AgencyScorecard[] {
  const byAgency = new Map<string, AgencyScorecard['byStatus']>()
  const unassigned = blank()

  for (const c of cases) {
    const bucket = c.assigned_agency_id ? (byAgency.get(c.assigned_agency_id) || blank()) : unassigned
    if (c.status === 'new' || c.status === 'pending' || c.status === 'criminal' || c.status === 'closed') bucket[c.status] += 1
    if (c.assigned_agency_id) byAgency.set(c.assigned_agency_id, bucket)
  }

  const nameById = new Map(agencies.map((a) => [a.id, a]))
  const cards: AgencyScorecard[] = []

  for (const [agencyId, s] of byAgency) {
    const a = nameById.get(agencyId)
    cards.push(card(agencyId, a?.name || 'Unknown agency', a?.type || null, s))
  }
  // Include agencies with zero cases so the scorecard shows full MDT coverage.
  for (const a of agencies) {
    if (!byAgency.has(a.id)) cards.push(card(a.id, a.name, a.type, blank()))
  }
  const unassignedTotal = unassigned.new + unassigned.pending + unassigned.criminal + unassigned.closed
  if (unassignedTotal > 0) cards.push(card(null, 'Unassigned', null, unassigned))

  return cards.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name))
}

function card(agencyId: string | null, name: string, type: string | null, s: AgencyScorecard['byStatus']): AgencyScorecard {
  const total = s.new + s.pending + s.criminal + s.closed
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : null)
  return {
    agencyId, name, type, total,
    open: s.new + s.pending + s.criminal,
    closed: s.closed,
    byStatus: s,
    criminalRatePct: pct(s.criminal),
    closedRatePct: pct(s.closed),
  }
}

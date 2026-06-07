import { describe, it, expect } from 'vitest'
import { computeAgencyScorecards } from '@/lib/casereview/accountability'

const agencies = [
  { id: 'a', name: 'Sheriff', type: 'law_enforcement', active: true },
  { id: 'b', name: 'DCFS', type: 'dhs', active: true },
  { id: 'c', name: 'Quiet Agency', type: 'other', active: true },
]

describe('computeAgencyScorecards', () => {
  it('aggregates per-agency status mix + rates', () => {
    const cases = [
      { assigned_agency_id: 'a', status: 'new' },
      { assigned_agency_id: 'a', status: 'criminal' },
      { assigned_agency_id: 'a', status: 'closed' },
      { assigned_agency_id: 'a', status: 'pending' },
      { assigned_agency_id: 'b', status: 'closed' },
    ]
    const cards = computeAgencyScorecards(cases, agencies)
    const sheriff = cards.find((c) => c.name === 'Sheriff')!
    expect(sheriff.total).toBe(4)
    expect(sheriff.open).toBe(3) // new + pending + criminal
    expect(sheriff.closed).toBe(1)
    expect(sheriff.byStatus.criminal).toBe(1)
    expect(sheriff.criminalRatePct).toBe(25) // 1/4
    expect(sheriff.closedRatePct).toBe(25)
    const dcfs = cards.find((c) => c.name === 'DCFS')!
    expect(dcfs.total).toBe(1)
    expect(dcfs.closedRatePct).toBe(100)
  })

  it('includes agencies with zero cases (full MDT coverage)', () => {
    const cards = computeAgencyScorecards([{ assigned_agency_id: 'a', status: 'new' }], agencies)
    const quiet = cards.find((c) => c.name === 'Quiet Agency')!
    expect(quiet.total).toBe(0)
    expect(quiet.criminalRatePct).toBeNull()
  })

  it('buckets unassigned cases', () => {
    const cards = computeAgencyScorecards([{ assigned_agency_id: null, status: 'new' }], agencies)
    expect(cards.find((c) => c.name === 'Unassigned')?.total).toBe(1)
  })

  it('sorts by total desc', () => {
    const cards = computeAgencyScorecards([
      { assigned_agency_id: 'b', status: 'new' },
      { assigned_agency_id: 'a', status: 'new' },
      { assigned_agency_id: 'a', status: 'closed' },
    ], agencies)
    expect(cards[0].name).toBe('Sheriff') // 2 > 1
  })
})

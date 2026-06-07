import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { isPhiGateReady } from '@/lib/connectors/providers'
import { computeAgencyScorecards, type ScorecardCase, type ScorecardAgency } from '@/lib/casereview/accountability'

export const dynamic = 'force-dynamic'

// MDT agency accountability scorecards (grant reporting). Aggregate counts only.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const SCAN_LIMIT = 20000
  const admin = getAdminClient()
  const [casesRes, countRes, agenciesRes] = await Promise.all([
    admin.from('cases').select('assigned_agency_id, status').limit(SCAN_LIMIT),
    admin.from('cases').select('id', { count: 'exact', head: true }),
    admin.from('agencies').select('id, name, type, active').order('name'),
  ])
  if (casesRes.error) return NextResponse.json({ error: casesRes.error.message }, { status: 500 })

  const scorecards = computeAgencyScorecards(
    (casesRes.data || []) as ScorecardCase[],
    (agenciesRes.data || []) as ScorecardAgency[],
  )
  // A grant report must never silently under-count: flag a truncated scan.
  const totalCases = typeof countRes.count === 'number' ? countRes.count : (casesRes.data?.length ?? 0)
  return NextResponse.json({ scorecards, phiGateReady: isPhiGateReady(), truncated: totalCases > SCAN_LIMIT, totalCases })
}

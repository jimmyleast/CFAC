import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { isPhiGateReady } from '@/lib/connectors/providers'
import { AGENDAS, type Agenda } from '@/lib/casereview/agenda'

export const dynamic = 'force-dynamic'

// Case Review list. Returns cases (real data only — empty until Collaborate data
// is ingested behind the PHI gate), MDT agencies, agenda counts, and the gate
// status so the UI can show an honest "awaiting data / HIPAA infra" state.
export async function GET(req: Request) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const agendaFilter = new URL(req.url).searchParams.get('agenda') as Agenda | null
  const admin = getAdminClient()

  let q = admin.from('cases')
    .select('id, case_number, status, agenda, priority, household_id, review_flag, last_update, summary, assigned_agency_id, agencies(name)')
    .order('last_update', { ascending: false, nullsFirst: false })
    .limit(500)
  if (agendaFilter && AGENDAS.some((a) => a.key === agendaFilter)) q = q.eq('agenda', agendaFilter)

  const [casesRes, agenciesRes] = await Promise.all([
    q,
    admin.from('agencies').select('id, name, type, active').order('name'),
  ])
  if (casesRes.error) return NextResponse.json({ error: casesRes.error.message }, { status: 500 })

  const cases = (casesRes.data || []).map((c) => ({
    id: c.id, caseNumber: c.case_number, status: c.status, agenda: c.agenda,
    priority: c.priority, householdId: c.household_id, reviewFlag: c.review_flag,
    lastUpdate: c.last_update, summary: c.summary,
    agency: (c as { agencies?: { name?: string } }).agencies?.name || null,
  }))

  // Agenda counts (computed over the unfiltered set when no filter is applied).
  const counts: Record<string, number> = { new: 0, pending: 0, criminal: 0 }
  for (const c of cases) if (c.agenda && counts[c.agenda] !== undefined) counts[c.agenda] += 1

  return NextResponse.json({
    cases, agencies: agenciesRes.data || [], counts,
    phiGateReady: isPhiGateReady(),
    agendas: AGENDAS,
  })
}

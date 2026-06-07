import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/admin'
import { requireUserMfa } from '@/lib/auth/aal'
import { emitAppEvent } from '@/lib/telemetry/events'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { isPhiGateReady } from '@/lib/connectors/providers'
import { canMove, deriveAgenda, isCaseStatus } from '@/lib/casereview/agenda'

export const dynamic = 'force-dynamic'

// One case + its event history (GET). Status move (PATCH) is human-in-the-loop:
// validated transition + append-only case_events audit. Aggregate/case metadata;
// real PHI only flows here behind the §5 gate.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUserMfa(req)
  if ('response' in auth) return auth.response

  const admin = getAdminClient()
  const [caseRes, eventsRes] = await Promise.all([
    admin.from('cases').select('*, agencies(name, type)').eq('id', params.id).maybeSingle(),
    admin.from('case_events').select('from_status, to_status, note, created_at').eq('case_id', params.id).order('created_at', { ascending: false }),
  ])
  if (caseRes.error) return NextResponse.json({ error: caseRes.error.message }, { status: 500 })
  if (!caseRes.data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ case: caseRes.data, events: eventsRes.data || [], phiGateReady: isPhiGateReady() })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  // Case data is PHI: the gate (not the table merely being empty) is the control.
  if (!isPhiGateReady()) return NextResponse.json({ error: 'Case workflow is locked until the HIPAA infrastructure is in place.' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { to?: string; note?: string }
  if (!isCaseStatus(body.to)) return NextResponse.json({ error: 'invalid target status' }, { status: 400 })

  const admin = getAdminClient()
  const { data: c } = await admin.from('cases').select('id, status, summary').eq('id', params.id).maybeSingle()
  if (!c) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isCaseStatus(c.status) || !canMove(c.status, body.to)) {
    return NextResponse.json({ error: `cannot move from ${c.status} to ${body.to}` }, { status: 409 })
  }

  const agenda = deriveAgenda(body.to, c.summary || '')
  // Conditional update guards against a concurrent move (only succeeds if the
  // status is still what we validated against).
  const upd = await admin.from('cases').update({ status: body.to, agenda, updated_at: new Date().toISOString() })
    .eq('id', params.id).eq('status', c.status).select('id').maybeSingle()
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 })
  if (!upd.data) return NextResponse.json({ error: 'case changed concurrently — reload' }, { status: 409 })

  await admin.from('case_events').insert({ case_id: params.id, from_status: c.status, to_status: body.to, note: String(body.note || '').slice(0, 1000) || null, actor_id: user.id })
  await emitAppEvent({ eventName: 'case.status_changed', category: 'system', userId: user.id, route: '/api/cases', status: 'ok', metadata: { from: c.status, to: body.to } }).catch(() => {})
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { getAdminClient, checkIsAdmin } from '@/lib/admin'
import { getRequestAuth } from '@/lib/auth/requestUser'
import { emitAppEvent } from '@/lib/telemetry/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * MFA recovery: an admin resets a locked-out user's 2FA by removing all of their
 * enrolled factors, so the user can sign in (AAL1) and re-enroll. There are no
 * self-service backup codes in v1 — this admin-mediated reset is the recovery path.
 *
 * Requires the acting admin's OWN session to be AAL2 (mfaRequired gate), so a
 * stolen AAL1 token can't strip another user's 2FA.
 */
export async function POST(req: Request) {
  const { user, mfaRequired } = await getRequestAuth(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (mfaRequired) return NextResponse.json({ error: 'mfa_required' }, { status: 403 })
  if (!(await checkIsAdmin(user.id, user.email || ''))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const targetId = String(body.id || '')
  if (!targetId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = getAdminClient()
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: targetId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const factors = data?.factors || []
  let removed = 0
  for (const f of factors) {
    const del = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: targetId })
    if (!del.error) removed += 1
  }

  await emitAppEvent({
    eventName: 'auth.mfa.admin_reset',
    category: 'auth',
    userId: user.id,
    status: 'ok',
    metadata: { targetUserId: targetId, factorsRemoved: removed },
  }).catch(() => {})

  return NextResponse.json({ ok: true, factorsRemoved: removed })
}
